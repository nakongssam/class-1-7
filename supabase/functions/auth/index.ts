// 로그인·비밀번호 서버 함수
// - login: 학번 + (4자리 비밀번호 | 처음/초기화 후에는 생년월일 6·8자리)
// - set_pin: 생년월일 확인 후 받은 설정 토큰으로 첫 비밀번호 저장
// - change_pin: 로그인한 본인이 비밀번호 변경
// - reset_pin: 교사가 학생 비밀번호 초기화(다음 로그인은 생년월일)
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const NO = /^107\d{2}$/;
const PIN = /^\d{4}$/;
const FAIL = "학번 또는 비밀번호가 맞지 않아요. 5번 틀리면 5분 뒤에 다시 시도할 수 있어요.";

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (n) => n.toString(16).padStart(2, "0")).join("");
async function hashToken(v: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
}
// 칭찬 릴레이 앱과 같은 방식(PBKDF2-SHA256, 10만 회)이라 기존 비밀번호가 그대로 맞는다
async function hashPin(pin: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
  return hex(bits);
}
const normalizeBirth = (v: string) => (v.length === 8 ? v.slice(2) : v);

async function issueSession(studentNo: string) {
  const { data: s, error } = await admin.from("students").select("id, user_id, active").eq("student_no", studentNo).single();
  if (error || !s || !s.active) throw new Error("계정을 찾지 못했어요.");
  const email = `s${studentNo}@class-1-7.app`;
  const password = crypto.randomUUID() + crypto.randomUUID();
  let userId = s.user_id as string | null;
  if (userId) {
    const { error: e } = await admin.auth.admin.updateUserById(userId, { password });
    if (e) userId = null; // 계정이 지워졌으면 새로 만든다
  }
  if (!userId) {
    const { data: created, error: e } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (e || !created.user) {
      // 이미 같은 이메일 계정이 있으면 찾아서 연결
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const found = list?.users.find((u) => u.email === email);
      if (!found) throw new Error("계정을 만들지 못했어요.");
      await admin.auth.admin.updateUserById(found.id, { password });
      userId = found.id;
    } else userId = created.user.id;
    await admin.from("students").update({ user_id: userId }).eq("student_no", studentNo);
  }
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2 || !data.session) throw new Error("로그인하지 못했어요.");
  return { ok: true, access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

async function caller(req: Request): Promise<{ client: SupabaseClient; userId: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const client = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await client.auth.getUser(auth.slice(7));
  return data.user ? { client, userId: data.user.id } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "login") {
      const studentNo = String(body.studentNo ?? "").trim();
      const credential = String(body.credential ?? "").trim();
      if (!NO.test(studentNo) || !/^(\d{4}|\d{6}|\d{8})$/.test(credential)) return json({ ok: false, error: FAIL });
      const { data: allowed } = await admin.rpc("reserve_login_attempt", { _student_no: studentNo });
      if (!allowed) return json({ ok: false, error: FAIL });
      const { data: code } = await admin.from("login_codes").select("*").eq("student_no", studentNo).maybeSingle();
      if (!code) return json({ ok: false, error: FAIL });
      if (code.pin_hash && code.pin_salt) {
        if (!PIN.test(credential) || (await hashPin(credential, code.pin_salt)) !== code.pin_hash) {
          return json({ ok: false, error: FAIL });
        }
        await admin.from("login_codes").update({ failed_attempts: 0, locked_until: null }).eq("student_no", studentNo);
        return json(await issueSession(studentNo));
      }
      // 아직 비밀번호가 없으면 생년월일로 확인하고 비밀번호 설정 단계로
      if (!/^(\d{6}|\d{8})$/.test(credential) || normalizeBirth(credential) !== code.birth) {
        return json({ ok: false, error: code.pin_hash ? FAIL : "처음이거나 초기화된 계정이에요. 생년월일 6자리(예: 100315)를 입력해 주세요." });
      }
      const token = crypto.randomUUID() + crypto.randomUUID();
      await admin.from("login_codes").update({
        setup_token_hash: await hashToken(token),
        setup_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        failed_attempts: 0, locked_until: null,
      }).eq("student_no", studentNo).is("pin_hash", null);
      return json({ ok: true, needsPin: true, setupToken: token });
    }

    if (action === "set_pin") {
      const studentNo = String(body.studentNo ?? "");
      const pin = String(body.pin ?? "");
      const token = String(body.setupToken ?? "");
      if (!NO.test(studentNo) || !PIN.test(pin) || token.length !== 72) return json({ ok: false, error: "숫자 4자리 비밀번호를 입력해 주세요." });
      const salt = crypto.randomUUID();
      const { data: saved } = await admin.from("login_codes").update({
        pin_hash: await hashPin(pin, salt), pin_salt: salt, setup_token_hash: null, setup_expires_at: null,
      }).eq("student_no", studentNo).eq("setup_token_hash", await hashToken(token))
        .gt("setup_expires_at", new Date().toISOString()).is("pin_hash", null).select("student_no").maybeSingle();
      if (!saved) return json({ ok: false, error: "설정 시간이 지났어요. 생년월일로 다시 로그인해 주세요." });
      return json(await issueSession(studentNo));
    }

    if (action === "change_pin") {
      const me = await caller(req);
      if (!me) return json({ ok: false, error: "다시 로그인해 주세요." }, 401);
      const current = String(body.current ?? "");
      const pin = String(body.pin ?? "");
      if (!PIN.test(pin)) return json({ ok: false, error: "새 비밀번호는 숫자 4자리예요." });
      const { data: s } = await admin.from("students").select("student_no").eq("user_id", me.userId).single();
      const { data: code } = await admin.from("login_codes").select("pin_hash, pin_salt").eq("student_no", s?.student_no ?? "").single();
      if (!code?.pin_hash || !code.pin_salt || (await hashPin(current, code.pin_salt)) !== code.pin_hash) {
        return json({ ok: false, error: "지금 비밀번호가 맞지 않아요." });
      }
      const salt = crypto.randomUUID();
      await admin.from("login_codes").update({ pin_hash: await hashPin(pin, salt), pin_salt: salt }).eq("student_no", s!.student_no);
      return json({ ok: true });
    }

    if (action === "reset_pin") {
      const me = await caller(req);
      if (!me) return json({ ok: false, error: "다시 로그인해 주세요." }, 401);
      const { data: isTeacher } = await me.client.rpc("is_teacher");
      if (!isTeacher) return json({ ok: false, error: "선생님만 초기화할 수 있어요." }, 403);
      const studentNo = String(body.studentNo ?? "");
      if (!NO.test(studentNo) || studentNo === "10700") return json({ ok: false, error: "초기화할 수 없는 학번이에요." });
      const { data: reset } = await admin.from("login_codes").update({
        pin_hash: null, pin_salt: null, setup_token_hash: null, setup_expires_at: null,
        failed_attempts: 0, locked_until: null, last_reset_at: new Date().toISOString(), last_reset_by: me.userId,
      }).eq("student_no", studentNo).select("student_no").maybeSingle();
      if (!reset) return json({ ok: false, error: "초기화하지 못했어요." });
      return json({ ok: true });
    }

    if (action === "unlock") {
      const me = await caller(req);
      if (!me) return json({ ok: false, error: "다시 로그인해 주세요." }, 401);
      const { data: isTeacher } = await me.client.rpc("is_teacher");
      if (!isTeacher) return json({ ok: false, error: "선생님만 할 수 있어요." }, 403);
      await admin.from("login_codes").update({ failed_attempts: 0, locked_until: null }).eq("student_no", String(body.studentNo ?? ""));
      return json({ ok: true });
    }

    return json({ ok: false, error: "알 수 없는 요청이에요." }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "서버 오류가 났어요." }, 500);
  }
});
