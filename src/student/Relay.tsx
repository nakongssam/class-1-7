import { useCallback, useEffect, useState } from "react";
import type { Me } from "../App";
import { callFn, supabase } from "../lib/supabase";
import { weekStart } from "../lib/util";
import { countStrengths, useStrengthMap } from "../lib/strengths";
import { Empty, Section, Tabs, useToast } from "../ui/kit";

type Activity = { day: string; student_id: string; students: { name: string } | null };

// raw: 학생이 적은 그대로 (학생 화면·인쇄용). 아니면 AI가 정리한 강점으로 묶어서 센다 (교사 집계용)
export function StrengthCloud({ letters, raw = true, onPick, picked }: { letters: { strengths: string[] }[]; raw?: boolean; onPick?: (w: string) => void; picked?: string }) {
  const map = useStrengthMap();
  const list = countStrengths(letters, raw ? EMPTY : map);
  const max = list[0]?.[1] ?? 1;
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-4">
      {list.map(([w, n], i) => (
        onPick ? (
          <button key={w} onClick={() => onPick(w)} title={`${n}명 · 눌러서 편지 보기`}
            className={`rounded-lg px-1 font-bold leading-tight hover:bg-bg ${picked === w ? "bg-warm ring-2 ring-amber-400" : ""}`}
            style={{ fontSize: `${0.85 + (n / max) * 1.1}rem`, color: ["#2f6b4f", "#b45309", "#be185d", "#1d4ed8", "#6d28d9"][i % 5] }}>
            {w}
          </button>
        ) : (
        <span key={w} className="font-bold leading-tight" title={`${n}명`}
          style={{ fontSize: `${0.85 + (n / max) * 1.1}rem`, color: ["#2f6b4f", "#b45309", "#be185d", "#1d4ed8", "#6d28d9"][i % 5] }}>
          {w}
        </span>
        )
      ))}
    </div>
  );
}

const EMPTY = new Map<string, string[]>();
const SUB = ["✉️ 편지 쓰기", "💌 내 결과"] as const;

export default function RelayStudent({ me }: { me: Me }) {
  const [sub, setSub] = useState<(typeof SUB)[number]>(SUB[0]);
  const [acts, setActs] = useState<Activity[] | null>(null);
  const [mine, setMine] = useState<{ day: string; target_student_id: string }[]>([]);
  const [sel, setSel] = useState("");
  const [inbox, setInbox] = useState<{ day: string; strengths: string[]; body: string }[]>([]);
  const ws = weekStart(me.today);

  const load = useCallback(async () => {
    await supabase.rpc("relay_auto_publish_today"); // 평일이면 이번 주 주인공을 자동으로 채움
    const [{ data: a }, { data: m }, { data: ib }] = await Promise.all([
      supabase.from("relay_hero_activities").select("day, student_id, students(name)").lte("day", me.today).order("day", { ascending: false }),
      supabase.from("relay_messages").select("day, target_student_id").eq("author_student_id", me.id),
      supabase.rpc("relay_my_inbox"),
    ]);
    setActs((a ?? []) as unknown as Activity[]);
    setMine(m ?? []);
    setInbox((ib ?? []) as typeof inbox);
  }, [me.id, me.today]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  if (!acts) return <p className="py-10 text-center text-sm text-muted">불러오는 중…</p>;
  const key = (a: Activity) => `${a.day}:${a.student_id}`;
  const done = (a: Activity) => mine.some((x) => x.day === a.day && x.target_student_id === a.student_id);
  const thisWeek = acts.filter((a) => a.day >= ws);
  const previous = acts.filter((a) => a.day < ws);
  const missedPrev = previous.filter((a) => !done(a));
  const star = acts.find((a) => key(a) === sel) ?? thisWeek.find((a) => !done(a)) ?? thisWeek[0];
  const written = !!star && done(star);

  const HeroButton = ({ a }: { a: Activity }) => (
    <button onClick={() => setSel(key(a))}
      className={`rounded-xl border px-3 py-2.5 text-left text-sm ${star && key(star) === key(a) ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>
      <span className="block font-bold">{a.students?.name}{a.student_id === me.id ? " (나)" : ""}</span>
      <span className={`text-xs ${star && key(star) === key(a) ? "text-white/80" : done(a) ? "text-brand" : "text-rose"}`}>{done(a) ? "✓ 보냈어요" : "아직 안 썼어요"}</span>
    </button>
  );

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-ink pb-4 pt-1">
        <div><span className="bubble text-xs">친구의 강점을 찾아 전해요</span><h1 className="mt-2 text-[34px] leading-none">칭찬 릴레이</h1></div>
        <span className="ill size-16 bg-pink"><i className="ti ti-heart-handshake text-4xl" aria-hidden="true" /></span>
      </div>
      <Tabs tabs={SUB} value={sub} onChange={setSub} />
      {sub === SUB[0] && (
        <>
          <Section title={`이번 주 주인공 ${thisWeek.length}명`} right={<span className="text-xs text-muted">{thisWeek.filter(done).length}/{thisWeek.length} 작성</span>}>
            {thisWeek.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{thisWeek.map((a) => <HeroButton key={key(a)} a={a} />)}</div>
            ) : <Empty>이번 주 주인공은 평일에 공개돼요 💌</Empty>}
            <p className="mt-3 text-xs text-muted">이번 주 안에 주인공 모두에게 편지를 써 주세요. 이름 없이 전달돼요.</p>
          </Section>
          {previous.length > 0 && (
            <details className="card" open={missedPrev.length > 0 && !thisWeek.some((a) => !done(a))}>
              <summary className="cursor-pointer text-sm font-bold">지난 주인공 {previous.length}명 {missedPrev.length > 0 && <span className="text-rose">· 아직 안 쓴 친구 {missedPrev.length}명</span>}</summary>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{previous.map((a) => <HeroButton key={key(a)} a={a} />)}</div>
            </details>
          )}
          {star && star.student_id === me.id && !written && (
            <Section className="bg-warm text-center">
              <p className="text-xl font-bold">🎉 {me.name}, 네가 주인공이야!</p>
              <p className="mt-1 text-sm text-muted">너도 자신에게 강점과 응원의 말을 적어 줘!</p>
            </Section>
          )}
          {star && (written ? (
            <Section className="text-center"><p className="text-lg font-bold">{star.students?.name}에게 편지를 보냈어요 💛</p>
              {thisWeek.some((a) => !done(a)) && <p className="mt-1 text-sm text-muted">위에서 아직 안 쓴 친구를 골라 주세요.</p>}</Section>
          ) : (
            <WriteForm key={key(star)} day={star.day} targetId={star.student_id} targetName={star.students?.name ?? ""} onDone={() => { setSel(""); load(); }} />
          ))}
        </>
      )}
      {sub === SUB[1] && (
        <Section title="📮 받은 편지함">
          {inbox.length ? (
            <>
              <StrengthCloud letters={inbox} />
              <ul className="mt-2 space-y-3 border-t border-line pt-4">
                {inbox.map((m, i) => (
                  <li key={i} className="rounded-xl border border-line bg-white p-4">
                    <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                  </li>
                ))}
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
