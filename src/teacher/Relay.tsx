import { useCallback, useEffect, useMemo, useState } from "react";
import type { Me } from "../App";
import { callFn, supabase, type Student } from "../lib/supabase";
import { errMsg, formatDay, nextWeekdays } from "../lib/util";
import { Empty, Loading, Progress, Section, Tabs, useToast } from "../ui/kit";
import { StrengthCloud } from "../student/Relay";

type Msg = {
  id: string; day: string; target_student_id: string; author_student_id: string; strengths: string[]; body: string;
  ai_flagged: boolean; ai_reason: string | null; status: string; teacher_edited: boolean; created_at: string;
};
type Sched = { day: string; student_id: string; published: boolean };
type D = { students: Student[]; schedule: Sched[]; activities: { day: string; student_id: string }[]; msgs: Msg[] };

const SUB = ["현황", "편지 검토", "주인공 정하기", "결과 공개·인쇄"] as const;

export default function RelayTeacher({ me }: { me: Me }) {
  const toast = useToast();
  const [sub, setSub] = useState<(typeof SUB)[number]>("현황");
  const [d, setD] = useState<D | null>(null);
  const load = useCallback(async () => {
    const msgs: Msg[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("relay_messages").select("*").order("created_at", { ascending: false }).range(from, from + 999);
      if (error) { toast(errMsg(error), "err"); break; }
      msgs.push(...((data ?? []) as Msg[]));
      if (!data || data.length < 1000) break;
    }
    const [{ data: students }, { data: schedule }, { data: activities }] = await Promise.all([
      supabase.from("students").select("*").order("student_no"),
      supabase.from("relay_schedule").select("*").order("day"),
      supabase.from("relay_hero_activities").select("day, student_id").order("day", { ascending: false }),
    ]);
    setD({ students: (students ?? []) as Student[], schedule: schedule ?? [], activities: activities ?? [], msgs });
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const pending = d.msgs.filter((m) => m.ai_flagged && m.status === "approved" && !m.teacher_edited).length;
  return (
    <>
      <Tabs tabs={SUB} value={sub} onChange={setSub} badges={{ "편지 검토": pending }} />
      {sub === "현황" && <Dashboard d={d} today={me.today} />}
      {sub === "편지 검토" && <Review d={d} refresh={load} />}
      {sub === "주인공 정하기" && <Schedule d={d} today={me.today} refresh={load} />}
      {sub === "결과 공개·인쇄" && <Reveal d={d} refresh={load} />}
    </>
  );
}

function Dashboard({ d, today }: { d: D; today: string }) {
  const byId = new Map(d.students.map((s) => [s.id, s]));
  const writers = d.students.filter((s) => s.role === "student");
  const todayStar = d.schedule.find((s) => s.day === today && s.published);
  const [sel, setSel] = useState("today");
  const hero = sel === "today" ? todayStar : d.activities.find((a) => `${a.day}:${a.student_id}` === sel);
  const wrote = new Set(hero ? d.msgs.filter((m) => m.day === hero.day && m.target_student_id === hero.student_id).map((m) => m.author_student_id) : []);
  const done = writers.filter((s) => wrote.has(s.id));
  const notYet = writers.filter((s) => !wrote.has(s.id));
  const heroCount = new Set(d.activities.filter((a) => byId.get(a.student_id)?.role === "student").map((a) => a.student_id)).size;
  const rows = writers.map((s) => {
    const recv = d.msgs.filter((m) => m.target_student_id === s.id && m.status === "approved");
    const c = new Map<string, number>();
    recv.forEach((m) => m.strengths.forEach((w) => c.set(w, (c.get(w) ?? 0) + 1)));
    return { s, received: recv.length, written: d.msgs.filter((m) => m.author_student_id === s.id).length, top: [...c].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k) };
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title="주인공별 참여" className="lg:col-span-2">
        <select className="input mb-3" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="주인공 선택">
          <option value="today">오늘의 주인공 · {todayStar ? byId.get(todayStar.student_id)?.name : "없음"}</option>
          {d.activities.filter((a) => a.day <= today).map((a) => <option key={`${a.day}:${a.student_id}`} value={`${a.day}:${a.student_id}`}>{formatDay(a.day)} · {byId.get(a.student_id)?.name}</option>)}
        </select>
        {hero ? (
          <>
            <p className="text-sm text-muted">{formatDay(hero.day)} · 주인공 <b className="text-ink">{byId.get(hero.student_id)?.name}</b></p>
            <p className="mt-1 text-3xl font-extrabold text-brand">{done.length}<span className="text-base text-muted"> / {writers.length}명</span></p>
            <Progress value={(done.length / Math.max(writers.length, 1)) * 100} />
            <p className="mt-3 text-sm text-muted">아직 안 쓴 친구 ({notYet.length})</p>
            <div className="mt-1 flex flex-wrap gap-1">{notYet.map((s) => <span key={s.id} className="chip-gray">{s.name}</span>)}</div>
          </>
        ) : <Empty>오늘 공개된 주인공이 없어요.</Empty>}
      </Section>
      <Section title="진행 현황">
        <p className="text-3xl font-extrabold text-brand">{heroCount}<span className="text-base text-muted"> / {writers.length}명</span></p>
        <Progress value={(heroCount / Math.max(writers.length, 1)) * 100} />
        <p className="mt-2 text-sm text-muted">남은 주인공 {writers.length - heroCount}명 · 전체 편지 {d.msgs.length}통</p>
      </Section>
      <Section title="학생별 현황" className="lg:col-span-3">
        <div className="overflow-x-auto">
          <table className="table min-w-[600px]">
            <thead><tr><th>학번</th><th>이름</th><th>받은 편지</th><th>쓴 편지</th><th>강점 TOP 3</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.s.id}><td className="text-muted">{r.s.student_no}</td><td>{r.s.name}</td><td>{r.received}</td>
                <td className={r.written === 0 && heroCount > 2 ? "text-rose" : ""}>{r.written}</td>
                <td className="space-x-1">{r.top.map((t) => <span key={t} className="chip">{t}</span>)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Review({ d, refresh }: { d: D; refresh: () => void }) {
  const [filter, setFilter] = useState<"전체" | "AI 주의" | "결과 제외">("AI 주의");
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const byId = new Map(d.students.map((s) => [s.id, s]));
  const list = d.msgs.filter((m) => (filter === "AI 주의" ? m.ai_flagged && m.status === "approved" : filter === "결과 제외" ? m.status === "hidden" : true)
    && (!to || m.target_student_id === to) && (!from || m.author_student_id === from));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{(["AI 주의", "전체", "결과 제외"] as const).map((f) => <button key={f} className={filter === f ? "btn btn-sm" : "btn-outline btn-sm"} onClick={() => setFilter(f)}>{f}</button>)}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="받는 사람"><option value="">모든 받는 사람</option>{d.students.map((s) => <option key={s.id} value={s.id}>{s.student_no} {s.name}</option>)}</select>
        <select className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="쓴 사람"><option value="">모든 작성자</option>{d.students.map((s) => <option key={s.id} value={s.id}>{s.student_no} {s.name}</option>)}</select>
      </div>
      {!list.length && <Section><Empty>검토할 편지가 없어요.</Empty></Section>}
      {list.map((m) => <ReviewItem key={m.id} m={m} from={byId.get(m.author_student_id)?.name ?? ""} to={byId.get(m.target_student_id)?.name ?? ""} refresh={refresh} />)}
    </div>
  );
}

function ReviewItem({ m, from, to, refresh }: { m: Msg; from: string; to: string; refresh: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const [str, setStr] = useState([...m.strengths, "", "", ""].slice(0, 3));
  const [busy, setBusy] = useState(false);
  const update = async (patch: Partial<Msg>) => {
    setBusy(true);
    const { error } = await supabase.from("relay_messages").update(patch).eq("id", m.id);
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    toast("반영했어요."); setEditing(false); refresh();
  };
  const soften = async () => {
    setBusy(true);
    const r = await callFn("ai", { action: "soften", body: m.body });
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "AI 순화에 실패했어요.", "err");
    setText(String(r.body)); setEditing(true);
  };
  return (
    <Section>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{formatDay(m.day)}</span><span><b className="text-ink">{from}</b> → <b className="text-ink">{to}</b></span>
        {m.ai_flagged && <span className="chip-red">AI 주의</span>}{m.teacher_edited && <span className="chip-gray">교사 확인</span>}
        <span className={m.status === "hidden" ? "chip-gray" : "chip"}>{m.status === "hidden" ? "결과 제외" : "결과 포함"}</span>
      </div>
      {m.ai_reason && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm">AI: {m.ai_reason}</p>}
      {editing ? (
        <div className="mt-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">{str.map((s, i) => <input key={i} className="input" maxLength={40} placeholder={`강점 ${i + 1}`} value={s} onChange={(e) => setStr(str.map((x, j) => (j === i ? e.target.value : x)))} />)}</div>
          <textarea className="input min-h-24" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1">{m.strengths.map((s) => <span key={s} className="chip">{s}</span>)}</div>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{m.body}</p>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button className="btn btn-sm" disabled={busy} onClick={() => update({ strengths: str.map((x) => x.trim()).filter(Boolean), body: text.trim(), teacher_edited: true })}>저장</button>
            <button className="btn-outline btn-sm" onClick={() => { setEditing(false); setText(m.body); }}>취소</button>
          </>
        ) : (
          <>
            {m.ai_flagged && !m.teacher_edited && <button className="btn btn-sm" disabled={busy} onClick={() => update({ teacher_edited: true })}>그대로 승인</button>}
            <button className="btn-outline btn-sm" disabled={busy} onClick={soften}>{busy ? "순화 중…" : "AI로 순화"}</button>
            <button className="btn-outline btn-sm" onClick={() => setEditing(true)}>직접 수정</button>
            {m.status === "hidden"
              ? <button className="btn-outline btn-sm" onClick={() => update({ status: "approved" })}>결과에 다시 포함</button>
              : <button className="btn-danger" onClick={() => confirm("이 편지를 학생 편지함과 인쇄 결과에서 제외할까요?") && update({ status: "hidden" })}>결과에서 제외</button>}
          </>
        )}
      </div>
    </Section>
  );
}

function Schedule({ d, today, refresh }: { d: D; today: string; refresh: () => void }) {
  const toast = useToast();
  const byId = new Map(d.students.map((s) => [s.id, s]));
  const current = d.schedule.find((s) => s.day === today);
  const done = new Set(d.activities.map((a) => a.student_id));
  const candidates = d.students.filter((s) => s.role === "student" && !done.has(s.id));
  const history = d.schedule.filter((s) => s.published).sort((a, b) => b.day.localeCompare(a.day));
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return toast(error.message.includes("no_candidate") ? "남은 후보가 없어요." : error.message.includes("already_published") ? "이미 공개했어요." : errMsg(error), "err");
    toast(ok); setPick(""); refresh();
  };
  const label = (s: Student) => (s.role === "teacher" ? "선생님" : `${s.student_no} ${s.name}`) + (done.has(s.id) ? " · 완료" : "");
  return (
    <div className="space-y-4">
      <Section title={`${formatDay(today)} 오늘의 주인공`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-3xl font-extrabold text-brand">{current ? byId.get(current.student_id)?.name : "아직 선택하지 않았어요"}</span>
          <span className={current?.published ? "chip" : "chip-gray"}>{current?.published ? "공개 중" : "미공개"}</span>
        </div>
        {!current?.published ? (
          <div className="mt-4 space-y-3">
            <button className="btn-outline" disabled={busy || !candidates.length} onClick={() => rpc("relay_choose_hero", { _day: today }, "골랐어요. 아직 학생에게는 안 보여요.")}>🎲 랜덤으로 뽑기 · 남은 {candidates.length}명</button>
            <div className="flex flex-wrap gap-2">
              <select className="input sm:w-64" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="학생 직접 선택"><option value="">학생 직접 선택</option>{d.students.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</select>
              <button className="btn-outline" disabled={busy || !pick} onClick={() => rpc("relay_choose_hero", { _day: today, _student_id: pick }, "선택했어요.")}>선택 확정</button>
            </div>
            <button className="btn" disabled={busy || !current} onClick={() => confirm(`${byId.get(current!.student_id)?.name} 학생을 오늘의 주인공으로 공개할까요?`) && rpc("relay_publish", { _day: today }, "오늘의 주인공을 공개했어요!")}>👀 오늘의 주인공 공개</button>
          </div>
        ) : (
          <div className="mt-4 space-y-2 rounded-xl border border-line p-4">
            <p className="text-sm text-muted">한 명 더 하거나 바꾸고 싶을 때 써요. 바꾸면 바로 공개되고, 이미 받은 편지는 그대로 남아요.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-outline btn-sm" disabled={busy} onClick={() => confirm("랜덤으로 새 주인공을 뽑아 바로 공개할까요?") && rpc("relay_replace_today", {}, "새 주인공을 공개했어요!")}>🎲 랜덤으로 바꾸기</button>
              <select className="input py-1.5 text-sm sm:w-56" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="바꿀 학생"><option value="">학생 직접 선택</option>{d.students.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</select>
              <button className="btn-outline btn-sm" disabled={busy || !pick} onClick={() => confirm(`${byId.get(pick)?.name}(으)로 바꿔 바로 공개할까요?`) && rpc("relay_replace_today", { _student_id: pick }, "바꿨어요!")}>이 학생으로 바꾸기</button>
            </div>
          </div>
        )}
      </Section>
      <Upcoming d={d} today={today} byId={byId} label={label} refresh={refresh} />
      <Section title={`지금까지의 주인공 · ${history.length}회`}>
        {!history.length ? <Empty>아직 없어요.</Empty> : <ul className="divide-y divide-line text-sm">{history.map((h) => <li key={h.day} className="flex justify-between py-2"><span className="text-muted">{formatDay(h.day)}</span><span>{byId.get(h.student_id)?.name}</span></li>)}</ul>}
      </Section>
    </div>
  );
}

function Upcoming({ d, today, byId, label, refresh }: { d: D; today: string; byId: Map<string, Student>; label: (s: Student) => string; refresh: () => void }) {
  const toast = useToast();
  const days = nextWeekdays(today, 5);
  const planned = new Map(d.schedule.filter((s) => s.day > today).map((s) => [s.day, s]));
  const [picks, setPicks] = useState<Record<string, string>>({});
  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) return toast(error.message.includes("no_candidate") ? "남은 후보가 없어요." : errMsg(error), "err");
    toast(ok); refresh();
  };
  return (
    <Section title="다음 주인공 미리 정하기">
      <p className="-mt-1 mb-3 text-sm text-muted">미리 뽑아 둘 수 있어요. 편지 쓰기는 그날이 되어야 열려요.</p>
      <ul className="space-y-2">
        {days.map((day) => {
          const p = planned.get(day);
          return (
            <li key={day} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
              <span className="w-28 text-sm text-muted">{formatDay(day)}</span>
              <span className="min-w-20 font-bold text-brand">{p ? byId.get(p.student_id)?.name : "—"}</span>
              {p?.published && <span className="chip">공개됨</span>}
              <span className="ml-auto flex flex-wrap gap-1.5">
                <button className="btn-outline btn-sm" onClick={() => run("relay_choose_hero", { _day: day }, `${formatDay(day)} 주인공을 골랐어요.`)}>🎲</button>
                <select className="input py-1 text-xs sm:w-44" value={picks[day] ?? ""} onChange={(e) => setPicks({ ...picks, [day]: e.target.value })} aria-label="학생 선택"><option value="">직접 선택</option>{d.students.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</select>
                <button className="btn-outline btn-sm" disabled={!picks[day]} onClick={() => run("relay_choose_hero", { _day: day, _student_id: picks[day] }, "선택했어요.")}>확정</button>
                <button className="btn-outline btn-sm" disabled={!p || p.published} onClick={() => confirm(`${formatDay(day)} 주인공을 미리 공개할까요?`) && run("relay_publish", { _day: day }, "미리 공개했어요.")}>공개</button>
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Reveal({ d, refresh }: { d: D; refresh: () => void }) {
  const toast = useToast();
  const [printId, setPrintId] = useState<string | "all" | null>(null);
  const upd = async (ids: string[], revealed: boolean) => {
    const { error } = await supabase.from("students").update({ revealed }).in("id", ids);
    if (error) return toast(errMsg(error), "err");
    toast(revealed ? "공개했어요." : "비공개로 바꿨어요."); refresh();
  };
  const people = d.students.filter((s) => s.role !== "test");
  const count = (id: string) => d.msgs.filter((m) => m.target_student_id === id && m.status === "approved").length;
  if (printId) return <PrintView d={d} only={printId === "all" ? null : printId} onClose={() => setPrintId(null)} />;
  return (
    <div className="space-y-4">
      <Section title="강점·편지 결과 공개" right={<div className="flex gap-2">
        <button className="btn btn-sm" onClick={() => confirm("모든 학생에게 받은 강점과 편지를 지금 공개할까요?") && upd(people.map((s) => s.id), true)}>전체 공개</button>
        <button className="btn-outline btn-sm" onClick={() => confirm("모두 비공개로 바꿀까요?") && upd(people.map((s) => s.id), false)}>전체 비공개</button>
        <button className="btn-outline btn-sm" onClick={() => setPrintId("all")}>🖨 전체 인쇄</button>
      </div>}>
        <div className="overflow-x-auto">
          <table className="table min-w-[520px]">
            <thead><tr><th>학번</th><th>이름</th><th>받은 편지</th><th>결과</th><th></th></tr></thead>
            <tbody>{people.map((s) => (
              <tr key={s.id}><td className="text-muted">{s.student_no}</td><td>{s.name}</td><td>{count(s.id)}</td>
                <td><button className={s.revealed ? "btn btn-sm" : "btn-outline btn-sm"} onClick={() => upd([s.id], !s.revealed)}>{s.revealed ? "공개 중 · 닫기" : "공개하기"}</button></td>
                <td><button className="text-xs underline" onClick={() => setPrintId(s.id)}>인쇄</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function PrintView({ d, only, onClose }: { d: D; only: string | null; onClose: () => void }) {
  const people = useMemo(() => d.students.filter((s) => (only ? s.id === only : s.role !== "test")), [d.students, only]);
  return (
    <div>
      <div className="no-print mb-4 flex gap-2"><button className="btn" onClick={() => print()}>🖨 인쇄하기</button><button className="btn-outline" onClick={onClose}>돌아가기</button></div>
      {people.map((s) => {
        const letters = d.msgs.filter((m) => m.target_student_id === s.id && m.status === "approved");
        if (!letters.length) return null;
        return (
          <article key={s.id} className="print-page card mb-6">
            <h2 className="text-center text-2xl font-extrabold">💌 {s.name}에게</h2>
            <StrengthCloud letters={letters} />
            <div className="columns-1 gap-3 sm:columns-2">
              {letters.map((m) => <p key={m.id} className="mb-3 break-inside-avoid rounded-lg border border-line p-3 text-sm whitespace-pre-wrap">{m.body}</p>)}
            </div>
          </article>
        );
      })}
    </div>
  );
}
