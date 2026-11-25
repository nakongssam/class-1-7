import { supabase } from "./supabase";

export const FIELDS = ["공학·IT", "자연·의약", "인문·사회", "경영·경제", "교육", "예술·디자인", "체육", "기타"] as const;
export const EMOJIS = ["👍", "💡", "🔥"] as const;
export const GOAL_TYPES = [
  { id: "job", label: "희망 진로" },
  { id: "major", label: "희망 학과" },
  { id: "explore", label: "아직 탐색 중" },
] as const;

export type CareerCard = {
  student_id: string; goal_type: "job" | "major" | "explore"; goal: string; field: string;
  past: string; present: string; subjects: string; future: string; answers: Record<string, string>; hidden: boolean; published: boolean; published_at: string | null; updated_at: string;
};
export type Reaction = { card_id: string; reactor_id: string; emoji: string };
export type Person = { id: string; name: string; student_no: string; is_test: boolean };

type Q = { key: string; q: string; ph: string; optional?: boolean; major?: string };
export const SECTIONS: { key: "past" | "present" | "future"; icon: string; title: string; q: string; items: Q[] }[] = [
  { key: "past", icon: "🌱", title: "시작", q: "왜 이 꿈을 갖게 됐나요?", items: [
    { key: "past_why", q: "언제, 어떤 계기로 관심을 갖게 됐나요?", ph: "예: 중학교 때 로봇 대회 영상을 보고…" },
    { key: "past_model", q: "닮고 싶은 롤모델이 있다면? 어떤 점을 닮고 싶나요?", ph: "가족, 선배, 선생님, 유명인 누구든 괜찮아요", optional: true },
  ] },
  { key: "present", icon: "🔍", title: "지금", q: "이 꿈을 위해 무엇을 하고 있나요?", items: [
    { key: "present_what", q: "이 일은 어떤 일을 하나요?", major: "이 학과에서는 무엇을 배우나요?", ph: "알아본 내용을 내 말로 정리해요" },
    { key: "present_skill", q: "이 꿈에 필요한 능력이나 자질은 무엇일까요?", ph: "예: 끈기, 수학 실력, 사람의 마음을 읽는 능력…" },
    { key: "present_do", q: "그래서 지금 나는 무엇을 하고 있나요?", ph: "공부, 독서, 활동, 작은 습관도 좋아요" },
  ] },
  { key: "future", icon: "🚀", title: "미래", q: "어떤 사람이 되고 싶나요?", items: [
    { key: "future_10y", q: "10년 뒤 나는 어떤 모습일까요?", ph: "구체적으로 상상해 봐요" },
    { key: "future_give", q: "이 일을 통해 사람들에게 어떤 도움을 주고 싶나요?", ph: "나의 포부", optional: true },
  ] },
];
export const qText = (it: Q, goalType: string) => (goalType === "major" && it.major ? it.major : it.q);
/** 세부 답을 모아 섹션 글로 만든다 (CSV·AI 초안용) */
export function composeSection(sec: (typeof SECTIONS)[number], answers: Record<string, string>, goalType: string) {
  return sec.items.filter((it) => answers[it.key]?.trim()).map((it) => `[${qText(it, goalType)}] ${answers[it.key].trim()}`).join("\n");
}

export async function loadCareer() {
  const [{ data: cards, error }, { data: reactions }, { data: people }, { data: cs }] = await Promise.all([
    supabase.from("career_cards").select("*"),
    supabase.from("career_reactions").select("card_id, reactor_id, emoji"),
    supabase.rpc("clean_roster"),
    supabase.from("class_settings").select("career_open").maybeSingle(),
  ]);
  if (error) throw error;
  return { open: !!cs?.career_open, cards: (cards ?? []) as CareerCard[], reactions: (reactions ?? []) as Reaction[], people: (people ?? []) as Person[] };
}

export const goalLabel = (c: Pick<CareerCard, "goal_type" | "goal">) =>
  c.goal_type === "explore" ? (c.goal ? `탐색 중 · ${c.goal}` : "아직 탐색 중") : c.goal;

export function CareerView({ c, name, children }: { c: CareerCard; name: string; children?: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm text-muted">{name}의 꿈</b>
        {c.field && <span className="chip-gray">{c.field}</span>}
      </div>
      <p className="mt-1 text-xl font-extrabold text-brand">🎯 {goalLabel(c) || "-"}</p>
      <p className="text-xs text-muted">{GOAL_TYPES.find((g) => g.id === c.goal_type)?.label}</p>
      <div className="mt-4 space-y-4">
        {SECTIONS.map((sec) => {
          const filled = sec.items.filter((it) => c.answers?.[it.key]?.trim());
          const legacy = !filled.length && c[sec.key].trim();
          if (!filled.length && !legacy) return null;
          return (
            <section key={sec.key}>
              <h4 className="text-sm font-bold">{sec.icon} {sec.title} <span className="font-normal text-muted">— {sec.q}</span></h4>
              {legacy ? <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{c[sec.key]}</p> : (
                <div className="mt-1.5 space-y-2 border-l-2 border-line pl-3">
                  {filled.map((it) => (
                    <div key={it.key}>
                      <p className="text-xs font-semibold text-muted">{qText(it, c.goal_type)}</p>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{c.answers[it.key]}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {children}
    </article>
  );
}
