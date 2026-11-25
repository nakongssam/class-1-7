import { useCallback, useEffect, useState } from "react";
import type { Me } from "../App";
import { CareerView, EMOJIS, FIELDS, GOAL_TYPES, loadCareer, SECTIONS, type CareerCard } from "../lib/career";
import { supabase } from "../lib/supabase";
import { errMsg } from "../lib/util";
import { Empty, Loading, Section, Tabs, useToast } from "../ui/kit";

type Data = Awaited<ReturnType<typeof loadCareer>>;
const SUB = ["내 진로 카드", "반 진로 갤러리"] as const;
const blank = (id: string): CareerCard => ({ student_id: id, goal_type: "job", goal: "", field: "", past: "", present: "", subjects: "", future: "", published: false, published_at: null, updated_at: "" });

export function Reactions({ d, cardId, me, onChange }: { d: Data; cardId: string; me?: string; onChange?: () => void }) {
  const toast = useToast();
  const toggle = async (emoji: string) => {
    if (!me || me === cardId) return;
    const has = d.reactions.some((r) => r.card_id === cardId && r.reactor_id === me && r.emoji === emoji);
    const { error } = has
      ? await supabase.from("career_reactions").delete().match({ card_id: cardId, reactor_id: me, emoji })
      : await supabase.from("career_reactions").insert({ card_id: cardId, reactor_id: me, emoji });
    if (error) return toast(errMsg(error), "err");
    onChange?.();
  };
  return (
    <div className="mt-4 flex gap-2 border-t border-line pt-3">
      {EMOJIS.map((e) => {
        const n = d.reactions.filter((r) => r.card_id === cardId && r.emoji === e).length;
        const mine = d.reactions.some((r) => r.card_id === cardId && r.reactor_id === me && r.emoji === e);
        return (
          <button key={e} onClick={() => toggle(e)} disabled={!me || me === cardId}
            className={`rounded-full border px-3 py-1 text-sm ${mine ? "border-brand bg-brand-soft font-bold" : "border-line bg-paper"} disabled:cursor-default`}>
            {e} {n || ""}
          </button>
        );
      })}
      <span className="ml-auto self-center text-[11px] text-muted">👍 응원해 · 💡 좋은 생각 · 🔥 멋져</span>
    </div>
  );
}

export default function CareerStudent({ me }: { me: Me }) {
  const toast = useToast();
  const [sub, setSub] = useState<(typeof SUB)[number]>("내 진로 카드");
  const [d, setD] = useState<Data | null>(null);
  const [f, setF] = useState<CareerCard | null>(null);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState("전체");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const x = await loadCareer();
      setD(x);
      setF((cur) => cur ?? (x.cards.find((c) => c.student_id === me.id) ?? blank(me.id)));
    } catch (e) { toast(errMsg(e), "err"); }
  }, [toast, me.id]);
  useEffect(() => { load(); }, [load]);
  if (!d || !f) return <Loading />;

  const saved = d.cards.find((c) => c.student_id === me.id);
  const showForm = editing || !saved;
  const nameOf = (id: string) => d.people.find((p) => p.id === id)?.name ?? "";

  const save = async (publish?: boolean) => {
    if (!f.goal.trim() && f.goal_type !== "explore") return toast("희망 진로나 학과를 적어 주세요.", "err");
    if (publish && !f.past.trim() && !f.present.trim() && !f.future.trim()) return toast("시작·지금·미래 중 하나는 써야 공개할 수 있어요.", "err");
    setBusy(true);
    const pub = publish ?? f.published;
    const row = { ...f, goal: f.goal.trim(), subjects: f.subjects.trim(), published: pub, published_at: pub ? (f.published_at ?? new Date().toISOString()) : null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("career_cards").upsert(row);
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    setF(row); setEditing(false);
    toast(publish ? "반 친구들에게 공개했어요! 🎉" : pub ? "저장했어요. (공개 중)" : "저장했어요. 아직 나만 볼 수 있어요.");
    load();
  };
  const unpublish = async () => {
    const { error } = await supabase.from("career_cards").update({ published: false, published_at: null }).eq("student_id", me.id);
    if (error) return toast(errMsg(error), "err");
    setF({ ...f, published: false, published_at: null }); toast("비공개로 바꿨어요."); load();
  };

  const published = d.cards.filter((c) => c.published && (c.student_id === me.id || !d.people.find((p) => p.id === c.student_id)?.is_test));
  const shown = published.filter((c) => filter === "전체" || c.field === filter || (filter === "탐색 중" && c.goal_type === "explore"))
    .sort((a, b) => (nameOf(a.student_id) > nameOf(b.student_id) ? 1 : -1));
  const counts = (k: string) => published.filter((c) => c.field === k || (k === "탐색 중" && c.goal_type === "explore")).length;

  return (
    <>
      <h1 className="text-xl font-extrabold">🎯 진로</h1>
      <Tabs tabs={SUB} value={sub} onChange={setSub} badges={{ "반 진로 갤러리": published.length }} />

      {sub === "내 진로 카드" && (showForm ? (
        <Section title={saved ? "진로 카드 고치기" : "나의 진로 카드 쓰기"}>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex flex-wrap gap-2">
                {GOAL_TYPES.map((g) => (
                  <button key={g.id} type="button" onClick={() => setF({ ...f, goal_type: g.id })} className={f.goal_type === g.id ? "btn btn-sm" : "btn-outline btn-sm"}>{g.label}</button>
                ))}
              </div>
              <input className="input text-lg font-bold" maxLength={60} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })}
                placeholder={f.goal_type === "major" ? "예: 기계공학과" : f.goal_type === "explore" ? "관심 있는 분야 (예: 사람을 돕는 일)" : "예: 로봇 공학자"} aria-label="희망 진로" />
            </div>
            <div>
              <p className="label">분야</p>
              <div className="flex flex-wrap gap-1.5">
                {FIELDS.map((x) => <button key={x} type="button" onClick={() => setF({ ...f, field: f.field === x ? "" : x })} className={f.field === x ? "btn btn-sm" : "btn-outline btn-sm"}>{x}</button>)}
              </div>
            </div>
            {SECTIONS.map((s) => (
              <div key={s.key}>
                <label className="label" htmlFor={`c-${s.key}`}>{s.icon} {s.title} — {s.q}</label>
                <p className="-mt-1 mb-1.5 text-xs text-muted">{s.hint}</p>
                <textarea id={`c-${s.key}`} className="input min-h-28" maxLength={2000} value={f[s.key]} onChange={(e) => setF({ ...f, [s.key]: e.target.value })} />
                {s.key === "present" && (
                  <input className="input mt-2 text-sm" maxLength={200} value={f.subjects} onChange={(e) => setF({ ...f, subjects: e.target.value })} placeholder="고2 때 듣고 싶은 선택과목 (선택) 예: 물리학, 정보, 기하" />
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button className="btn-outline" disabled={busy} onClick={() => save()}>저장 (나만 보기)</button>
              {!f.published && <button className="btn" disabled={busy} onClick={() => save(true)}>저장하고 반에 공개</button>}
              {f.published && <button className="btn" disabled={busy} onClick={() => save()}>저장 (공개 중)</button>}
              {saved && <button className="btn-outline" onClick={() => { setF(saved); setEditing(false); }}>취소</button>}
            </div>
          </div>
        </Section>
      ) : (
        <>
          <div className={`card flex flex-wrap items-center gap-2 ${saved.published ? "border-brand bg-brand-soft" : "border-amber-300 bg-amber-50"}`}>
            <span className="font-semibold">{saved.published ? "🌍 반 친구들에게 공개 중" : "🔒 아직 나만 볼 수 있어요"}</span>
            <div className="ml-auto flex gap-2">
              <button className="btn-outline btn-sm" onClick={() => setEditing(true)}>고치기</button>
              {saved.published ? <button className="btn-outline btn-sm" onClick={unpublish}>비공개로</button> : <button className="btn btn-sm" onClick={() => save(true)}>반에 공개</button>}
            </div>
          </div>
          <CareerView c={saved} name={me.name}>{saved.published && <Reactions d={d} cardId={me.id} />}</CareerView>
        </>
      ))}

      {sub === "반 진로 갤러리" && (
        <>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {["전체", ...FIELDS, "탐색 중"].map((x) => {
              const n = x === "전체" ? published.length : counts(x);
              if (x !== "전체" && !n) return null;
              return <button key={x} onClick={() => setFilter(x)} className={`shrink-0 ${filter === x ? "btn btn-sm" : "btn-outline btn-sm"}`}>{x} {n}</button>;
            })}
          </div>
          {!shown.length ? <Section><Empty>아직 공개한 친구가 없어요. 내 진로 카드를 먼저 공개해 볼까요?</Empty></Section> : (
            <div className="space-y-3">
              {shown.map((c) => (
                <CareerView key={c.student_id} c={c} name={nameOf(c.student_id)}>
                  {saved?.field && c.field === saved.field && c.student_id !== me.id && <p className="mt-3 text-xs font-semibold text-brand">✨ 나랑 같은 분야예요</p>}
                  <Reactions d={d} cardId={c.student_id} me={me.id} onChange={load} />
                </CareerView>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
