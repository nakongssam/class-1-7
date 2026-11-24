import { useCallback, useEffect, useMemo, useState } from "react";
import type { Me } from "../App";
import { callFn, supabase, type Student } from "../lib/supabase";
import { errMsg, formatDay, weekStart } from "../lib/util";
import { Empty, Loading, Progress, Section, Tabs, useToast } from "../ui/kit";
import { StrengthCloud } from "../student/Relay";

type Msg = {
  id: string; day: string; target_student_id: string; author_student_id: string; strengths: string[]; body: string;
  ai_flagged: boolean; ai_reason: string | null; status: string; teacher_edited: boolean; created_at: string;
};
type Sched = { day: string; student_id: string; published: boolean };
type D = { students: Student[]; schedule: Sched[]; activities: { day: string; student_id: string }[]; msgs: Msg[] };

const SUB = ["현황", "편지 검토", "이번 주 주인공", "결과 공개·인쇄"] as const;

export default function RelayTeacher({ me }: { me: Me }) {
  const toast = useToast();
  const [sub, setSub] = useState<(typeof SUB)[number]>("현황");
  const [d, setD] = useState<D | null>(null);
  const load = useCallback(async () => {
    await supabase.rpc("relay_auto_publish_today");
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
      {sub === "이번 주 주인공" && <Week d={d} today={me.today} refresh={load} />}
      {sub === "결과 공개·인쇄" && <Reveal d={d} refresh={load} />}
    </>
  );
}

function Dashboard({ d, today }: { d: D; today: string }) {
  const byId = new Map(d.students.map((s) => [s.id, s]));
  const writers = d.students.filter((s) => s.role === "student");
  const ws = weekStart(today);
  const [sel, setSel] = useState(() => { const a = d.activities.find((x) => x.day >= ws && x.day <= today); return a ? `${a.day}:${a.student_id}` : ""; });
  const hero = d.activities.find((a) => `${a.day}:${a.student_id}` === sel);
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
          {!d.activities.length && <option value="">주인공 없음</option>}
          {d.activities.filter((a) => a.day <= today).map((a) => <option key={`${a.day}:${a.student_id}`} value={`${a.day}:${a.student_id}`}>{a.day >= ws ? "이번 주" : `${formatDay(weekStart(a.day))} 주`} · {byId.get(a.student_id)?.name}</option>)}
        </select>
        {hero ? (
          <>
            <p className="text-sm text-muted">주인공 <b className="text-ink">{byId.get(hero.student_id)?.name}</b></p>
            <p className="mt-1 text-3xl font-extrabold text-brand">{done.length}<span className="text-base text-muted"> / {writers.length}명</span></p>
            <Progress value={(done.length / Math.max(writers.length, 1)) * 100} />
            <p className="mt-3 text-sm text-muted">아직 안 쓴 친구 ({notYet.length})</p>
            <div className="mt-1 flex flex-wrap gap-1">{notYet.map((s) => <span key={s.id} className="chip-gray">{s.name}</span>)}</div>
          </>
        ) : <Empty>공개된 주인공이 없어요.</Empty>}
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

function Week({ d, today, refresh }: { d: D; today: string; refresh: () => void }) {
  const toast = useToast();
  const byId = new Map(d.students.map((s) => [s.id, s]));
  const ws = weekStart(today);
  const writers = d.students.filter((s) => s.role === "student");
  const done = new Set(d.activities.map((a) => a.student_id));
  const left = writers.filter((s) => !done.has(s.id));
  const thisWeek = d.activities.filter((a) => a.day >= ws);
  const [perWeek, setPerWeek] = useState<number | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from("class_settings").select("relay_per_week").eq("id", 1).single().then(({ data }) => setPerWeek(data?.relay_per_week ?? 5)); }, []);
  const lettersFor = (a: { day: string; student_id: string }) => d.msgs.filter((m) => m.day === a.day && m.target_student_id === a.student_id).length;
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return toast(error.message.includes("no_candidate") ? "남은 후보가 없어요." : error.message.includes("has_letters") ? "이미 편지를 받은 주인공은 바꿀 수 없어요." : errMsg(error), "err");
    toast(ok); setPick(""); refresh();
  };
  const savePerWeek = async (n: number) => {
    setPerWeek(n);
    const { error } = await supabase.from("class_settings").update({ relay_per_week: n }).eq("id", 1);
    if (error) return toast(errMsg(error), "err");
    await supabase.rpc("relay_auto_publish_today");
    toast(`매주 ${n}명씩 공개돼요.`);
    refresh();
  };
  const weeks = [...new Set(d.activities.filter((a) => a.day < ws).map((a) => weekStart(a.day)))].sort().reverse();
  return (
    <div className="space-y-4">
      <Section title={`이번 주 주인공 (${formatDay(ws)} 주)`} right={<span className="text-sm text-muted">남은 후보 {left.length}명</span>}>
        <p className="-mt-1 mb-3 text-sm text-muted">매주 월요일 0시에 아직 주인공을 안 한 학생 중에서 랜덤으로 공개돼요. 학생들은 그 주 내내 편지를 쓸 수 있어요.</p>
        {!thisWeek.length ? <Empty>이번 주 주인공이 아직 없어요.</Empty> : (
          <ul className="divide-y divide-line">
            {thisWeek.map((a) => {
              const n = lettersFor(a);
              return (
                <li key={`${a.day}:${a.student_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><b>{byId.get(a.student_id)?.name}</b> <span className="text-sm text-muted">· 편지 {n}통</span></span>
                  <button className="btn-outline btn-sm" disabled={busy || n > 0} title={n > 0 ? "이미 편지를 받아서 바꿀 수 없어요" : ""}
                    onClick={() => confirm(`${byId.get(a.student_id)?.name} 대신 다른 학생을 랜덤으로 뽑을까요?`) && rpc("relay_swap_hero", { _day: a.day, _old: a.student_id }, "다른 학생으로 바꿨어요.")}>🎲 다른 학생으로</button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <button className="btn-outline btn-sm" disabled={busy || !left.length} onClick={() => rpc("relay_add_hero", {}, "한 명 더 뽑았어요.")}>🎲 이번 주에 한 명 더</button>
          <select className="input py-1.5 text-sm sm:w-56" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="학생 직접 추가">
            <option value="">학생 직접 추가</option>
            {d.students.filter((s) => !thisWeek.some((a) => a.student_id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.role === "teacher" ? "선생님" : `${s.student_no} ${s.name}`}{done.has(s.id) ? " · 했음" : ""}</option>)}
          </select>
          <button className="btn-outline btn-sm" disabled={busy || !pick} onClick={() => rpc("relay_add_hero", { _student_id: pick }, "추가했어요.")}>추가</button>
        </div>
      </Section>
      <Section title="한 주에 몇 명?">
        <div className="flex flex-wrap gap-2">
          {[3, 4, 5, 6, 7].map((n) => <button key={n} className={perWeek === n ? "btn btn-sm" : "btn-outline btn-sm"} onClick={() => savePerWeek(n)}>{n}명</button>)}
        </div>
        <p className="mt-2 text-xs text-muted">남은 {left.length}명 기준으로 약 {perWeek ? Math.ceil(left.length / perWeek) : "-"}주 더 진행돼요. 이번 주 인원을 늘리면 바로 채워져요.</p>
      </Section>
      <Section title="지난 주인공">
        {!weeks.length ? <Empty>아직 없어요.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {weeks.map((w) => <li key={w} className="flex flex-wrap justify-between gap-2 py-2"><span className="text-muted">{formatDay(w)} 주</span>
              <span>{d.activities.filter((a) => a.day >= w && a.day < (() => { const x = new Date(`${w}T12:00:00`); x.setDate(x.getDate() + 7); return x.toISOString().slice(0, 10); })()).map((a) => byId.get(a.student_id)?.name).join(", ")}</span></li>)}
          </ul>
        )}
      </Section>
    </div>
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
