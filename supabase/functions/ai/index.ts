// AI 서버 함수 (Claude)
// - submit_message: 칭찬 편지 AI 검사 후 저장 (AI가 실패해도 편지는 저장하고 교사 검토로 넘김)
// - soften: 교사용 편지 순화
// - record_draft: 교사용 생기부 초안 (확정된 스터디 일지 + 교사 메모 기반, 500자)
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODELS = (Deno.env.get("CLAUDE_MODELS") ?? "claude-haiku-5-5,claude-sonnet-5-5,claude-haiku-4-5,claude-sonnet-4-5")
  .split(",").map((m) => m.trim()).filter(Boolean);
const DRAFT_MODELS = (Deno.env.get("CLAUDE_DRAFT_MODELS") ?? "claude-sonnet-5-5,claude-sonnet-4-5,claude-haiku-5-5,claude-haiku-4-5")
  .split(",").map((m) => m.trim()).filter(Boolean);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class AiError extends Error {}

async function claude(system: string, prompt: string, models = MODELS, maxTokens = 800): Promise<string> {
  if (!KEY) throw new AiError("AI 키가 설정되지 않았어요.");
  let last = "";
  for (const model of models) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
    });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      return (data.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim();
    }
    last = text;
    if (res.status === 404 || (res.status === 400 && text.includes("model"))) continue; // 다른 모델로 재시도
    if (text.includes("credit balance")) throw new AiError("AI 크레딧이 부족해요. Claude Console에서 크레딧을 충전해 주세요.");
    if (res.status === 401) throw new AiError("AI 키가 올바르지 않아요.");
    throw new AiError(`AI 요청이 실패했어요 (${res.status}).`);
  }
  throw new AiError(`사용할 수 있는 AI 모델을 찾지 못했어요. ${last.slice(0, 120)}`);
}

function parseJson<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new AiError("AI 응답을 읽지 못했어요.");
  return JSON.parse(m[0]) as T;
}

const REVIEW = `너는 고등학교 1학년 학급의 '칭찬 릴레이' 활동을 돕는 따뜻한 선생님 도우미야.
학생이 반 친구에게 쓴 강점과 하고 싶은 말을 검사해.
flagged=true로 판단하는 경우: 비꼼, 돌려까기, 외모·성적 비하, 놀림, 장난식 욕설/은어, 성의 없는 글(예: "ㅋㅋ", "몰라", 한 글자), 칭찬처럼 보이지만 상처가 될 수 있는 말, 개인정보 노출.
진심 어린 칭찬, 서툴지만 좋은 의도의 글, 가벼운 응원은 flagged=false.
reason: flagged일 때 학생에게 보여줄 부드럽고 짧은 이유(1문장, "~해 볼까?" 말투). 아니면 빈 문자열.
suggestion: flagged일 때 원래 뜻을 최대한 살린 따뜻한 대안 문장(학생 말투 유지). 아니면 빈 문자열.
반드시 JSON 한 개만 출력: {"flagged": boolean, "reason": string, "suggestion": string}`;

const DRAFT = `당신은 한국 고등학교 담임교사로서 학교생활기록부 '행동특성 및 종합의견' 또는 '세부능력 및 특기사항'에 들어갈 문장을 작성합니다.
규칙:
- 학생 이름이나 주어 없이 문장을 시작하고, 반드시 '~함', '~임', '~보임' 등 생활기록부 명사형 종결 문체로 씀.
- 공백 포함 500자 이내의 한 문단으로 작성.
- 교내 스터디그룹(멘토-멘티) 학습 활동에서 드러난 구체적 행동, 성장, 태도를 근거로 서술.
- 교외 활동, 대학명, 기관명, 부모(가족)의 직업·정보는 절대 언급하지 않음.
- 과장 없이 기록에 근거한 사실만 사용. 제목, 따옴표, 목록 기호 없이 본문만 출력.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "submit_message") {
      const strengths: string[] = (Array.isArray(body.strengths) ? body.strengths : [])
        .map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 3);
      const text = String(body.body ?? "").trim();
      if (!strengths.length) return json({ ok: false, error: "강점을 하나 이상 적어 주세요." });
      if (strengths.some((s) => s.length > 40)) return json({ ok: false, error: "강점은 40자 이내로 적어 주세요." });
      if (text.length < 5) return json({ ok: false, error: "조금 더 길게 써 줄래?" });
      if (text.length > 1000) return json({ ok: false, error: "1000자 이내로 써 주세요." });
      const { data: meId } = await sb.rpc("my_student_id");
      if (!meId) return json({ ok: false, error: "다시 로그인해 주세요." }, 401);
      const { data: today } = await sb.rpc("today_kst");
      const day = String(body.day ?? today);
      if (day > today) return json({ ok: false, error: "아직 활동 날짜가 되지 않았어요." });
      let targetId = body.targetStudentId ? String(body.targetStudentId) : "";
      if (!targetId) {
        const { data: cur } = await sb.from("relay_schedule").select("student_id").eq("day", day).eq("published", true).maybeSingle();
        targetId = cur?.student_id ?? "";
      }
      if (!targetId) return json({ ok: false, error: "선생님이 주인공을 공개하면 편지를 쓸 수 있어요." });
      const { data: hero } = await sb.from("relay_hero_activities").select("student_id").eq("day", day).eq("student_id", targetId).maybeSingle();
      if (!hero) return json({ ok: false, error: "공개된 주인공에게만 편지를 쓸 수 있어요." });
      const { data: existing } = await sb.from("relay_messages").select("id").eq("day", day).eq("target_student_id", targetId).eq("author_student_id", meId).maybeSingle();
      if (existing) return json({ ok: false, error: "이 주인공에게는 이미 편지를 보냈어요." });
      const { data: target } = await sb.from("students").select("name").eq("id", targetId).single();

      let flagged = false, reason = "", suggestion = "";
      try {
        const r = parseJson<{ flagged: boolean; reason: string; suggestion: string }>(
          await claude(REVIEW, `받는 친구: ${target?.name ?? ""}\n강점: ${strengths.join(", ")}\n하고 싶은 말: ${text}`));
        flagged = !!r.flagged; reason = r.reason ?? ""; suggestion = r.suggestion ?? "";
      } catch (_e) {
        // AI를 쓸 수 없으면 막지 않고 선생님 확인으로 넘긴다
        flagged = true; reason = "AI 검사를 하지 못해 선생님이 확인해요."; suggestion = "";
        const { error } = await sb.from("relay_messages").insert({
          day, target_student_id: targetId, author_student_id: meId, strengths, body: text, ai_flagged: true, ai_reason: reason,
        });
        if (error) return json({ ok: false, error: error.code === "23505" ? "이 주인공에게는 이미 편지를 보냈어요." : "저장하지 못했어요." });
        return json({ ok: true, aiSkipped: true });
      }
      if (flagged && !body.force) return json({ ok: false, flagged: true, reason, suggestion });
      const { error } = await sb.from("relay_messages").insert({
        day, target_student_id: targetId, author_student_id: meId, strengths, body: text,
        ai_flagged: flagged, ai_reason: flagged ? reason : null,
      });
      if (error) return json({ ok: false, error: error.code === "23505" ? "이 주인공에게는 이미 편지를 보냈어요." : "저장하지 못했어요." });
      return json({ ok: true });
    }

    const { data: isTeacher } = await sb.rpc("is_teacher");
    if (!isTeacher) return json({ ok: false, error: "선생님만 사용할 수 있어요." }, 403);

    if (action === "soften") {
      const text = String(body.body ?? "").slice(0, 1000);
      const out = await claude(
        "학생이 친구에게 쓴 편지를 교사가 순화하려고 해. 원래 뜻과 학생 말투는 최대한 살리되, 상처가 될 수 있는 표현·비꼼·비하는 따뜻한 칭찬으로 바꿔. 바꾼 편지 문장만 출력해.",
        text);
      return json({ ok: true, body: out });
    }

    if (action === "record_draft") {
      const studentId = String(body.studentId ?? "");
      const { data: groups } = await sb.rpc("list_study_groups");
      type Member = { id: string; role: string; status: string };
      const mine = ((groups ?? []) as { id: string; name: string; members: Member[] }[])
        .filter((g) => g.members?.some((m) => m.id === studentId && m.status === "accepted"));
      if (!mine.length) return json({ ok: false, error: "참여한 스터디그룹이 없어요." });
      const { data: logs } = await sb.from("study_logs").select("id, group_id, author_id, activity_date, minutes, subject, content, reflection")
        .in("group_id", mine.map((g) => g.id)).eq("status", "confirmed").order("activity_date");
      if (!logs?.length) return json({ ok: false, error: "확정된 활동 일지가 없어요." });
      const { data: notes } = await sb.from("study_log_notes").select("log_id, note").in("log_id", logs.map((l) => l.id));
      const noteMap = new Map((notes ?? []).map((n) => [n.log_id, n.note]));
      const roles = mine.map((g) => `${g.name}: ${g.members.find((m) => m.id === studentId)?.role === "mentor" ? "멘토" : "멘티"}`).join(", ");
      const lines = logs.map((l, i) => {
        const g = mine.find((x) => x.id === l.group_id);
        const note = noteMap.get(l.id);
        return `${i + 1}. [${l.activity_date}] ${g?.name} · 과목: ${l.subject} · ${l.minutes}분\n활동: ${l.content}\n느낀 점(${l.author_id === studentId ? "본인 작성" : "그룹원 작성"}): ${l.reflection}${note ? `\n교사 관찰: ${note}` : ""}`;
      }).join("\n\n");
      let content = await claude(DRAFT, `그룹 내 역할: ${roles}\n확정된 활동 기록:\n\n${lines}`, DRAFT_MODELS, 1200);
      if (content.length > 500) content = content.slice(0, 500);
      await sb.from("record_drafts").upsert({ student_id: studentId, content, updated_at: new Date().toISOString() });
      return json({ ok: true, content });
    }

    return json({ ok: false, error: "알 수 없는 요청이에요." }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "서버 오류가 났어요." }, e instanceof AiError ? 200 : 500);
  }
});
