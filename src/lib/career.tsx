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
  past: string; present: string; subjects: string; future: string; published: boolean; published_at: string | null; updated_at: string;
};
export type Reaction = { card_id: string; reactor_id: string; emoji: string };
export type Person = { id: string; name: string; student_no: string; is_test: boolean };

export const SECTIONS = [
  { key: "past", icon: "🌱", title: "시작", q: "왜 이 꿈을 갖게 됐나요?", hint: "계기가 된 경험, 책, 영상, 사람… 롤모델이 있다면 함께 써요." },
  { key: "present", icon: "🔍", title: "지금", q: "이 꿈을 위해 무엇을 하고 있나요?", hint: "이 진로에 대해 알게 된 것, 지금 하고 있는 노력을 써요." },
  { key: "future", icon: "🚀", title: "미래", q: "어떤 사람이 되고 싶나요?", hint: "나의 포부를 자유롭게 써요." },
] as const;

export async function loadCareer() {
  const [{ data: cards, error }, { data: reactions }, { data: people }] = await Promise.all([
    supabase.from("career_cards").select("*"),
    supabase.from("career_reactions").select("card_id, reactor_id, emoji"),
    supabase.rpc("clean_roster"),
  ]);
  if (error) throw error;
  return { cards: (cards ?? []) as CareerCard[], reactions: (reactions ?? []) as Reaction[], people: (people ?? []) as Person[] };
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
        {SECTIONS.map((s) => {
          const v = c[s.key];
          if (!v.trim() && !(s.key === "present" && c.subjects)) return null;
          return (
            <section key={s.key}>
              <h4 className="text-sm font-bold">{s.icon} {s.title} <span className="font-normal text-muted">— {s.q}</span></h4>
              {v.trim() && <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{v}</p>}
              {s.key === "present" && c.subjects && <p className="mt-1.5 text-sm"><span className="chip">고2 선택과목</span> {c.subjects}</p>}
            </section>
          );
        })}
      </div>
      {children}
    </article>
  );
}
