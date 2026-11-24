import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { callFn, supabase, type Student } from "./lib/supabase";
import { useToast } from "./ui/kit";
import StudentApp from "./student/StudentApp";
import TeacherApp from "./teacher/TeacherApp";

export type Me = Student & { today: string };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setMe(null); return; }
    (async () => {
      const [{ data: ready }, { data: today }, { data: row }] = await Promise.all([
        supabase.rpc("login_pin_ready"),
        supabase.rpc("today_kst"),
        supabase.from("students").select("*").eq("user_id", session.user.id).maybeSingle(),
      ]);
      if (!ready || !row) {
        // 교사가 비밀번호를 초기화했거나 계정이 끊긴 경우
        await supabase.auth.signOut();
        setMe(null);
        return;
      }
      setMe({ ...(row as Student), today: today as string });
    })();
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined || (session && me === undefined)) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted">불러오는 중…</div>;
  }
  if (!session || !me) return <Login />;
  return me.role === "teacher" ? <TeacherApp me={me} /> : <StudentApp me={me} />;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.hash = "";
}

function Login() {
  const toast = useToast();
  const [no, setNo] = useState(() => localStorage.getItem("class17-last-no") ?? "");
  const [cred, setCred] = useState("");
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ token: string } | null>(null);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");

  const finish = async (r: Record<string, unknown>) => {
    localStorage.setItem("class17-last-no", no);
    await supabase.auth.setSession({ access_token: String(r.access_token), refresh_token: String(r.refresh_token) });
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!/^107\d{2}$/.test(no)) return setErr("학번 5자리를 입력해 주세요. (예: 10715)");
    setBusy(true);
    try {
      const r = await callFn("auth", { action: "login", studentNo: no, credential: cred });
      if (!r.ok) return setErr(r.error ?? "로그인하지 못했어요.");
      if (r.needsPin) { setSetup({ token: String(r.setupToken) }); setCred(""); return; }
      await finish(r);
    } finally { setBusy(false); }
  };

  const savePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!/^\d{4}$/.test(pin1)) return setErr("숫자 4자리로 정해 주세요.");
    if (pin1 !== pin2) return setErr("두 번 입력한 비밀번호가 달라요.");
    setBusy(true);
    try {
      const r = await callFn("auth", { action: "set_pin", studentNo: no, setupToken: setup!.token, pin: pin1 });
      if (!r.ok) { setErr(r.error ?? "저장하지 못했어요."); setSetup(null); return; }
      toast("비밀번호를 정했어요. 다음부터는 이 비밀번호로 로그인해요.");
      await finish(r);
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid size-16 place-items-center rounded-2xl bg-brand text-xl font-extrabold text-white">1-7</div>
          <h1 className="text-2xl font-extrabold">우리반</h1>
          <p className="mt-1 text-sm text-muted">출결 보고 · 칭찬 릴레이 · 스터디그룹</p>
        </div>
        {!setup ? (
          <form onSubmit={login} className="card space-y-4">
            <div>
              <label className="label" htmlFor="no">학번</label>
              <input id="no" className="input text-lg tracking-widest" inputMode="numeric" autoComplete="username" maxLength={5}
                placeholder="10715" value={no} onChange={(e) => setNo(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div>
              <label className="label" htmlFor="cred">비밀번호</label>
              <input id="cred" className="input text-lg tracking-widest" type="password" inputMode="numeric" autoComplete="current-password" maxLength={8}
                placeholder="숫자 4자리" value={cred} onChange={(e) => setCred(e.target.value.replace(/\D/g, ""))} />
              <p className="mt-1.5 text-xs leading-relaxed text-muted">칭찬 릴레이에서 쓰던 비밀번호 그대로예요. 처음이거나 선생님이 초기화했다면 생년월일 6자리를 넣어요.</p>
            </div>
            {err && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose">{err}</p>}
            <button className="btn w-full py-3 text-base" disabled={busy || !no || !cred}>{busy ? "확인 중…" : "로그인"}</button>
          </form>
        ) : (
          <form onSubmit={savePin} className="card space-y-4">
            <div>
              <h2 className="text-lg font-bold">새 비밀번호 정하기</h2>
              <p className="mt-1 text-sm text-muted">앞으로 로그인할 때 쓸 숫자 4자리예요. 친구에게 알려 주지 마세요.</p>
            </div>
            <input className="input text-center text-2xl tracking-[0.5em]" type="password" inputMode="numeric" maxLength={4} autoFocus
              aria-label="새 비밀번호" value={pin1} onChange={(e) => setPin1(e.target.value.replace(/\D/g, ""))} />
            <input className="input text-center text-2xl tracking-[0.5em]" type="password" inputMode="numeric" maxLength={4}
              aria-label="새 비밀번호 확인" placeholder="한 번 더" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} />
            {err && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose">{err}</p>}
            <button className="btn w-full py-3 text-base" disabled={busy}>{busy ? "저장 중…" : "저장하고 시작하기"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function ChangePin({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await callFn("auth", { action: "change_pin", current: cur, pin });
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "바꾸지 못했어요.", "err");
    toast("비밀번호를 바꿨어요.");
    setCur(""); setPin(""); onDone?.();
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <input className="input" type="password" inputMode="numeric" maxLength={4} placeholder="지금 비밀번호" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, ""))} />
      <input className="input" type="password" inputMode="numeric" maxLength={4} placeholder="새 비밀번호 (숫자 4자리)" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      <button className="btn w-full" disabled={busy || cur.length !== 4 || pin.length !== 4}>비밀번호 바꾸기</button>
    </form>
  );
}
