import { useCallback, useEffect, useState } from "react";
import type { Me } from "../App";
import { callFn, supabase } from "../lib/supabase";
import { formatDay } from "../lib/util";
import { Empty, Section, Tabs, useToast } from "../ui/kit";

type Activity = { day: string; student_id: string; students: { name: string } | null };

export function StrengthCloud({ letters }: { letters: { strengths: string[] }[] }) {
  const counts = new Map<string, number>();
  letters.forEach((l) => l.strengths.forEach((w) => { const c = w.trim(); if (c) counts.set(c, (counts.get(c) ?? 0) + 1); }));
  const list = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  const max = list[0]?.[1] ?? 1;
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-4">
      {list.map(([w, n], i) => (
        <span key={w} className="font-bold leading-tight"
          style={{ fontSize: `${0.85 + (n / max) * 1.1}rem`, color: ["#2f6b4f", "#b45309", "#be185d", "#1d4ed8", "#6d28d9"][i % 5] }}>
          {w}
        </span>
      ))}
    </div>
  );
}

const SUB = ["✉️ 편지 쓰기", "💌 내 결과"] as const;

export default function RelayStudent({ me }: { me: Me }) {
  const [sub, setSub] = useState<(typeof SUB)[number]>(SUB[0]);
  const [todayHero, setTodayHero] = useState<Activity | null | undefined>(undefined);
  const [acts, setActs] = useState<Activity[]>([]);
  const [mine, setMine] = useState<{ day: string; target_student_id: string }[]>([]);
  const [sel, setSel] = useState("");
  const [inbox, setInbox] = useState<{ day: string; strengths: string[]; body: string }[]>([]);

  const load = useCallback(async () => {
    const [{ data: t }, { data: a }, { data: m }, { data: ib }] = await Promise.all([
      supabase.from("relay_schedule").select("day, student_id, students(name)").eq("day", me.today).eq("published", true).maybeSingle(),
      supabase.from("relay_hero_activities").select("day, student_id, students(name)").lte("day", me.today).order("day", { ascending: false }),
      supabase.from("relay_messages").select("day, target_student_id").eq("author_student_id", me.id),
      supabase.rpc("relay_my_inbox"),
    ]);
    setTodayHero((t as unknown as Activity) ?? null);
    setActs((a ?? []) as unknown as Activity[]);
    setMine(m ?? []);
    setInbox((ib ?? []) as typeof inbox);
  }, [me.id, me.today]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const star = sel ? acts.find((a) => `${a.day}:${a.student_id}` === sel) : todayHero;
  const day = star?.day ?? me.today;
  const written = !!star && mine.some((x) => x.day === day && x.target_student_id === star.student_id);
  const previous = acts.filter((a) => !(todayHero && a.day === todayHero.day && a.student_id === todayHero.student_id));
  const missed = previous.filter((a) => !mine.some((x) => x.day === a.day && x.target_student_id === a.student_id));

  return (
    <>
      <h1 className="text-xl font-extrabold">💌 칭찬 릴레이</h1>
      <Tabs tabs={SUB} value={sub} onChange={setSub} />
      {sub === SUB[0] && (
        <>
          {previous.length > 0 && (
            <div>
              <p className="mb-2 text-sm text-muted">이전 주인공 {missed.length > 0 && <span className="text-rose">· 아직 안 쓴 친구 {missed.length}명</span>}</p>
              <div className="flex flex-wrap gap-2">
                <button className={sel === "" ? "btn btn-sm" : "btn-outline btn-sm"} onClick={() => setSel("")}>오늘의 주인공</button>
                {previous.map((a) => {
                  const v = `${a.day}:${a.student_id}`;
                  const done = mine.some((x) => x.day === a.day && x.target_student_id === a.student_id);
                  return <button key={v} className={sel === v ? "btn btn-sm" : "btn-outline btn-sm"} onClick={() => setSel(v)}>
                    {formatDay(a.day)} · {a.students?.name}{done ? " ✓" : ""}
                  </button>;
                })}
              </div>
            </div>
          )}
          <Section>
            <div className="text-center">
              <p className="text-sm text-muted">{formatDay(day)} · {sel ? "선택한 주인공" : "오늘의 주인공"}</p>
              {todayHero === undefined ? <p className="mt-3">…</p> : star ? (
                <p className="mt-2 text-4xl font-extrabold text-brand">{star.students?.name}</p>
              ) : <p className="mt-2 text-xl font-bold">오늘의 주인공 공개를 기다려요 💌</p>}
            </div>
          </Section>
          {star && star.student_id === me.id && (
            <Section className="bg-warm text-center">
              <p className="text-xl font-bold">🎉 {day === me.today ? "오늘은" : "이날은"} {me.name}, 네가 주인공이야!</p>
              <p className="mt-1 text-sm text-muted">너도 자신에게 강점과 응원의 말을 적어 줘!</p>
            </Section>
          )}
          {star && (written ? (
            <Section className="text-center"><p className="text-xl font-bold">편지를 보냈어요 💛</p></Section>
          ) : (
            <WriteForm key={`${day}:${star.student_id}`} day={day} targetId={star.student_id} targetName={star.students?.name ?? ""} onDone={load} />
          ))}
        </>
      )}
      {sub === SUB[1] && (
        <Section title="📮 받은 편지함">
          {inbox.length ? (
            <>
              <StrengthCloud letters={inbox} />
              <ul className="mt-2 space-y-3 border-t border-line pt-4">
                {inbox.map((m, i) => <li key={i} className="rounded-xl border border-line bg-white p-4 whitespace-pre-wrap leading-relaxed">{m.body}</li>)}
              </ul>
            </>
          ) : <Empty>아직 열린 편지가 없어요. 선생님이 공개하면 여기에서 볼 수 있어요.</Empty>}
        </Section>
      )}
    </>
  );
}

function WriteForm({ day, targetId, targetName, onDone }: { day: string; targetId: string; targetName: string; onDone: () => void }) {
  const toast = useToast();
  const [tags, setTags] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<{ reason: string; suggestion: string } | null>(null);

  const add = () => {
    const v = custom.trim();
    if (v && !tags.includes(v) && tags.length < 3) setTags([...tags, v]);
    setCustom("");
  };
  const send = async (force: boolean) => {
    const pending = custom.trim();
    const strengths = pending && !tags.includes(pending) && tags.length < 3 ? [...tags, pending] : tags;
    if (!strengths.length) return toast("강점을 하나 이상 적어 주세요!", "err");
    if (body.trim().length < 5) return toast("조금 더 길게 써 줄래?", "err");
    setBusy(true);
    try {
      const r = await callFn("ai", { action: "submit_message", strengths, body, force, day, targetStudentId: targetId });
      if (r.ok) { toast("편지를 보냈어요!"); onDone(); }
      else if (r.flagged) setWarn({ reason: String(r.reason ?? ""), suggestion: String(r.suggestion ?? "") });
      else toast(r.error ?? "보내지 못했어요.", "err");
    } catch { toast("보내지 못했어요. 다시 시도해 주세요.", "err"); }
    finally { setBusy(false); }
  };

  return (
    <Section title={`${targetName}에게 편지 쓰기`}>
      <p className="-mt-2 mb-4 text-sm text-muted">이름 없이 전달돼요. 진심을 담아 써 주세요.</p>
      <label className="label" htmlFor="st">이 친구의 강점 (최대 3개)</label>
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {tags.map((t) => <span key={t} className="chip gap-1">{t}<button aria-label={`${t} 삭제`} onClick={() => setTags(tags.filter((x) => x !== t))}>✕</button></span>)}
        </div>
      )}
      <div className="flex gap-2">
        <input id="st" className="input" maxLength={40} placeholder="강점을 직접 적어 주세요" value={custom} disabled={tags.length >= 3}
          onChange={(e) => { setCustom(e.target.value); setWarn(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }} />
        <button className="btn-outline" onClick={add} disabled={!custom.trim() || tags.length >= 3}>추가</button>
      </div>
      <label className="label mt-4" htmlFor="bd">하고 싶은 말</label>
      <textarea id="bd" className="input min-h-40" maxLength={1000} value={body} onChange={(e) => { setBody(e.target.value); setWarn(null); }} />
      {warn && (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm">
          <p className="text-base font-bold">잠깐! 🤔</p>
          <p className="mt-1">{warn.reason}</p>
          {warn.suggestion && (
            <>
              <p className="mt-3 text-muted">이렇게 바꿔 보면 어때?</p>
              <p className="mt-1 rounded-lg bg-white p-3">{warn.suggestion}</p>
              <button className="btn btn-sm mt-2" onClick={() => { setBody(warn.suggestion); setWarn(null); }}>이 문장으로 바꾸기</button>
            </>
          )}
          <button className="mt-3 block text-xs underline" disabled={busy} onClick={() => send(true)}>그래도 이대로 보낼래요 (선생님이 확인해요)</button>
        </div>
      )}
      <button className="btn mt-4 w-full py-3.5 text-base" disabled={busy} onClick={() => send(false)}>{busy ? "AI가 읽어 보는 중…" : "편지 보내기"}</button>
    </Section>
  );
}
