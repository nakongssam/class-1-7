import { useCallback, useEffect, useMemo, useState } from "react";
import type { Me } from "../App";
import { callFn, supabase, type Student } from "../lib/supabase";
import { errMsg, formatDay, weekStart } from "../lib/util";
import { Empty, Loading, Progress, Section, Tabs, useToast } from "../ui/kit";
import { StrengthCloud } from "../student/Relay";
import { countStrengths, loadStrengthMap, useStrengthMap } from "../lib/strengths";

type Msg = {
  id: string; day: string; target_student_id: string; author_student_id: string; strengths: string[]; body: string;
  ai_flagged: boolean; ai_reason: string | null; status: string; teacher_edited: boolean; created_at: string;
};
type Sched = { day: string; student_id: string; published: boolean };
type D = { students: Student[]; schedule: Sched[]; activities: { day: string; student_id: string }[]; msgs: Msg[] };

const SUB = ["현황", "편지 검토", "이번 주 주인공", "결과 검토·공개"] as const;

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
  // 아직 정리 안 된 강점 표현이 있으면 조용히 AI 정리 (교사 화면을 열 때 한 번)
  useEffect(() => {
    if (!d) return;
    (async () => {
      const map = await loadStrengthMap();
      if (!d.msgs.some((m) => m.strengths.some((r) => r.trim() && !map.has(r.trim())))) return;
      for (let i = 0; i < 10; i++) {
        const r = await callFn("ai", { action: "normalize_strengths" });
        if (!r.ok || !Number(r.remaining)) break;
      }
      await loadStrengthMap(true);
    })();
  }, [!!d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Loading />;
  const pending = d.msgs.filter((m) => m.ai_flagged && m.status === "approved" && !m.teacher_edited).length;
  return (
    <>
      <Tabs tabs={SUB} value={sub} onChange={setSub} badges={{ "편지 검토": pending }} />
      {sub === "현황" && <Dashboard d={d} today={me.today} />}
      {sub === "편지 검토" && <Review d={d} refresh={load} />}
      {sub === "이번 주 주인공" && <Week d={d} today={me.today} refresh={load} />}
      {sub === "결과 검토·공개" && <Reveal d={d} refresh={load} />}
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
  const map = useStrengthMap();
  const rows = writers.map((s) => {
    const recv = d.msgs.filter((m) => m.target_student_id === s.id && m.status === "approved");
    return { s, received: recv.length, written: d.msgs.filter((m) => m.author_student_id === s.id).length, top: countStrengths(recv, map).slice(0, 3) };
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
                <td className="space-x-1">{r.top.map(([t, n]) => <span key={t} className="chip">{t} {n}</span>)}</td></tr>
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
  const remove = async () => {
    if (!confirm(`${from} → ${to} 편지를 완전히 삭제할까요? 되돌릴 수 없어요.`)) return;
    setBusy(true);
    const { error } = await supabase.from("relay_messages").delete().eq("id", m.id);
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    toast("삭제했어요."); refresh();
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
              : <button className="btn-outline btn-sm" onClick={() => confirm("이 편지를 학생 편지함과 인쇄 결과에서 제외할까요? (지우지는 않아요)") && update({ status: "hidden" })}>결과에서 제외</button>}
            <button className="btn-danger" disabled={busy} onClick={remove}>삭제</button>
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
      <Announcement names={thisWeek.map((a) => byId.get(a.student_id)?.name ?? "")} ws={ws} />
    </div>
  );
}

function Reveal({ d, refresh }: { d: D; refresh: () => void }) {
  const toast = useToast();
  const [printId, setPrintId] = useState<string | "all" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [norm, setNorm] = useState("");
  const people = d.students; // 교사·테스트 계정 포함
  const byId = new Map(d.students.map((s) => [s.id, s]));
  const recv = (id: string) => d.msgs.filter((m) => m.target_student_id === id);
  const withLetters = people.filter((s) => recv(s.id).length > 0);
  const reviewed = withLetters.filter((s) => s.relay_reviewed_at).length;
  const revealedN = people.filter((s) => s.revealed).length;

  const upd = async (ids: string[], patch: Partial<Student>, ok: string) => {
    const { error } = await supabase.from("students").update(patch).in("id", ids);
    if (error) return toast(errMsg(error), "err");
    toast(ok); refresh();
  };
  const revealAll = (v: boolean) => {
    if (v) {
      const notYet = withLetters.length - reviewed;
      if (!confirm(`모든 학생에게 받은 강점과 편지를 지금 공개할까요?${notYet ? `\n\n⚠ 아직 검토 완료하지 않은 학생이 ${notYet}명 있어요.` : ""}`)) return;
    } else if (!confirm("모두 비공개로 바꿀까요?")) return;
    upd(people.map((s) => s.id), { revealed: v }, v ? "전체 공개했어요." : "모두 비공개로 바꿨어요.");
  };
  const normalize = async (all: boolean) => {
    if (all && !confirm("강점 정리를 처음부터 다시 할까요? 1~2분 걸려요.")) return;
    let first = true;
    for (let guard = 0; guard < 20; guard++) {
      setNorm(guard ? `정리 중… (${guard * 100}개 완료)` : "정리 중…");
      const r = await callFn("ai", { action: "normalize_strengths", all: all && first });
      first = false;
      if (!r.ok) { setNorm(""); return toast(r.error ?? "정리하지 못했어요.", "err"); }
      if (!Number(r.remaining)) break;
    }
    await loadStrengthMap(true);
    setNorm("");
    toast("강점을 정리했어요.");
  };

  if (printId) return <PrintView d={d} only={printId === "all" ? null : printId} onClose={() => setPrintId(null)} />;
  const cur = open ? byId.get(open) : null;
  return (
    <div className="space-y-4">
      <Section title="결과 공개" right={<div className="flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={() => revealAll(true)}>전체 공개</button>
        <button className="btn-outline btn-sm" onClick={() => revealAll(false)}>전체 비공개</button>
        <button className="btn-outline btn-sm" onClick={() => setPrintId("all")}>🖨 전체 인쇄</button>
      </div>}>
        <p className="text-sm">검토 완료 <b>{reviewed}</b> / {withLetters.length}명 · 공개 중 <b>{revealedN}</b>명</p>
        <p className="mt-1 text-xs text-muted">선생님이 공개하기 전까지 학생들은 받은 편지를 볼 수 없어요. 학생 이름을 눌러 편지를 하나씩 검토·수정·삭제한 뒤 '검토 완료'를 표시하세요.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button className="btn-outline btn-sm" disabled={!!norm} onClick={() => normalize(false)}>✨ 새 강점 AI 정리</button>
          <button className="text-xs text-muted underline" disabled={!!norm} onClick={() => normalize(true)}>처음부터 다시 정리</button>
          {norm && <span className="text-xs text-muted">{norm}</span>}
          <span className="text-xs text-muted">비슷한 강점(착하다·착함·착하당)을 하나로 묶어 워드클라우드와 TOP 3에 반영해요.</span>
        </div>
      </Section>
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Section title="학생">
          <ul className="max-h-[70vh] space-y-1 overflow-auto">
            {people.map((s) => {
              const n = recv(s.id).length;
              const flagged = recv(s.id).filter((m) => m.ai_flagged && m.status === "approved" && !m.teacher_edited).length;
              return (
                <li key={s.id}>
                  <button onClick={() => setOpen(s.id)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${open === s.id ? "bg-brand-soft" : "hover:bg-bg"}`}>
                    <span>{s.role === "teacher" ? "선생님" : s.name}{s.role === "test" && <span className="chip-warn ml-1">테스트</span>}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs">
                      {n === 0 ? <span className="text-muted">편지 없음</span> : <>
                        <span className="text-muted">{n}통</span>
                        {flagged > 0 && <span className="chip-red">주의 {flagged}</span>}
                        {s.relay_reviewed_at ? <span className="chip">검토 ✓</span> : <span className="chip-gray">미검토</span>}
                        {s.revealed && <span className="chip-warn">공개</span>}
                      </>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
        {cur ? (
          <StudentReview key={cur.id} cur={cur} msgs={recv(cur.id)} byId={byId} refresh={refresh}
            onReviewed={() => upd([cur.id], { relay_reviewed_at: cur.relay_reviewed_at ? null : new Date().toISOString() }, cur.relay_reviewed_at ? "검토 완료를 해제했어요." : "검토 완료로 표시했어요.")}
            onReveal={() => confirm(cur.revealed ? "이 학생의 결과를 다시 비공개로 바꿀까요?" : "이 학생에게 결과를 지금 공개할까요?") && upd([cur.id], { revealed: !cur.revealed }, cur.revealed ? "비공개로 바꿨어요." : "공개했어요.")}
            onPrint={() => setPrintId(cur.id)} />
        ) : <Section><Empty>왼쪽에서 학생을 골라 받은 편지를 검토하세요.</Empty></Section>}
      </div>
    </div>
  );
}

function Announcement({ names, ws }: { names: string[]; ws: string }) {
  const toast = useToast();
  const end = (() => { const x = new Date(`${ws}T12:00:00`); x.setDate(x.getDate() + 4); return `${x.getMonth() + 1}/${x.getDate()}`; })();
  const start = `${Number(ws.slice(5, 7))}/${Number(ws.slice(8))}`;
  const make = () => [
    `📢 [1-7 칭찬 릴레이] 이번 주 주인공 (${start}~${end})`,
    "",
    `이번 주 주인공은 ${names.length ? names.join(", ") : "○○○"} 입니다! 🎉`,
    "",
    "✏️ 한 명도 빠짐없이 모두 참여해서, 주인공 한 명 한 명에게 강점과 응원의 말을 써 주세요.",
    "📮 지난 주인공 중에 아직 편지를 안 쓴 친구가 있다면 이번 주에 같이 써 주세요. (칭찬 탭 → '지난 주인공')",
    "🔒 받은 편지는 학기말에 한 번에 공개할 예정이에요. 진심을 담아 따뜻하게 써 주세요 💌",
    "",
    `👉 ${location.origin}${location.pathname}`,
  ].join("\n");
  const [text, setText] = useState(make);
  useEffect(() => setText(make()), [names.join(","), ws]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast("복사했어요. 단톡방이나 클래스룸에 붙여 넣으세요."); }
    catch { toast("복사하지 못했어요. 글을 직접 선택해서 복사해 주세요.", "err"); }
  };
  return (
    <Section title="📢 월요일 안내 문구" right={<div className="flex gap-2"><button className="btn-outline btn-sm" onClick={() => setText(make())}>처음 문구로</button><button className="btn btn-sm" onClick={copy}>📋 복사</button></div>}>
      <textarea className="input min-h-56 text-sm leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} aria-label="안내 문구" />
      <p className="mt-2 text-xs text-muted">이번 주 주인공 이름이 자동으로 들어가요. 고쳐서 복사해도 돼요.</p>
    </Section>
  );
}

const norm = (w: string) => w.trim().replace(/\s+/g, " ");

function StudentReview({ cur, msgs, byId, refresh, onReviewed, onReveal, onPrint }: {
  cur: Student; msgs: Msg[]; byId: Map<string, Student>; refresh: () => void; onReviewed: () => void; onReveal: () => void; onPrint: () => void;
}) {
  const [view, setView] = useState<"preview" | "list">("preview");
  const [word, setWord] = useState("");
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const shown = msgs.filter((m) => m.status === "approved");
  const hiddenN = msgs.length - shown.length;
  const name = cur.role === "teacher" ? "선생님" : cur.name;
  const author = (m: Msg) => byId.get(m.author_student_id)?.name ?? "";
  const withWord = word ? msgs.filter((m) => m.strengths.some((r) => norm(r) === word)) : [];
  const listSorted = [...msgs].sort((a, b) => author(a).localeCompare(author(b), "ko"));

  return (
    <div className="space-y-3">
      <Section title={`${name}이(가) 받은 편지 ${msgs.length}통`} right={<div className="flex flex-wrap gap-2">
        <button className={cur.relay_reviewed_at ? "btn btn-sm" : "btn-outline btn-sm"} onClick={onReviewed}>{cur.relay_reviewed_at ? "✓ 검토 완료" : "검토 완료 표시"}</button>
        <button className={cur.revealed ? "btn btn-sm" : "btn-outline btn-sm"} onClick={onReveal}>{cur.revealed ? "공개 중 · 닫기" : "이 학생만 공개"}</button>
        <button className="btn-outline btn-sm" onClick={onPrint}>🖨 인쇄</button>
      </div>}>
        <div className="flex gap-1 rounded-full bg-bg p-1 text-sm font-semibold">
          <button className={`flex-1 rounded-full py-1.5 ${view === "preview" ? "bg-ink text-white" : "text-muted"}`} onClick={() => setView("preview")}>📄 인쇄·학생 화면 미리보기</button>
          <button className={`flex-1 rounded-full py-1.5 ${view === "list" ? "bg-ink text-white" : "text-muted"}`} onClick={() => { setView("list"); setWord(""); }}>👥 누가 어떻게 썼는지 목록</button>
        </div>
      </Section>

      {view === "preview" && (
        <>
          <section className="card">
            <h3 className="text-center text-xl font-extrabold">💌 {name}에게</h3>
            <p className="mt-1 text-center text-xs text-muted">강점 단어나 편지를 누르면 쓴 사람과 수정·삭제 버튼이 보여요.{hiddenN > 0 && ` · 결과에서 제외한 편지 ${hiddenN}통은 빠져 있어요.`}</p>
            <StrengthCloud letters={shown} onPick={(w) => { setWord(word === w ? "" : w); setOpenMsg(null); }} picked={word} />
            {word && (
              <div className="mb-4 space-y-2 rounded-xl bg-warm/60 p-3">
                <div className="flex items-center justify-between text-sm"><b>‘{word}’를 적은 편지 {withWord.length}통</b><button className="text-xs underline" onClick={() => setWord("")}>닫기</button></div>
                {withWord.map((m) => <ReviewItem key={m.id} m={m} from={author(m)} to={name} refresh={refresh} />)}
              </div>
            )}
            <div className="columns-1 gap-3 sm:columns-2">
              {shown.map((m) => openMsg === m.id ? (
                <div key={m.id} className="mb-3 break-inside-avoid">
                  <ReviewItem m={m} from={author(m)} to={name} refresh={refresh} />
                  <button className="mt-1 text-xs text-muted underline" onClick={() => setOpenMsg(null)}>접기</button>
                </div>
              ) : (
                <button key={m.id} onClick={() => setOpenMsg(m.id)}
                  className={`mb-3 block w-full break-inside-avoid rounded-lg border p-3 text-left text-sm hover:border-brand ${m.ai_flagged && !m.teacher_edited ? "border-rose/50 bg-rose-50/40" : "border-line bg-white"}`}>
                  <span className="block whitespace-pre-wrap">{m.body}</span>
                  {m.ai_flagged && !m.teacher_edited && <span className="mt-1.5 block text-xs text-rose">⚠ AI 주의</span>}
                </button>
              ))}
            </div>
            {!shown.length && <Empty>학생에게 보일 편지가 없어요.</Empty>}
          </section>
        </>
      )}

      {view === "list" && (
        msgs.length === 0 ? <Section><Empty>받은 편지가 없어요.</Empty></Section> : (
          <>
            <Section>
              <div className="overflow-x-auto">
                <table className="table min-w-[560px]">
                  <thead><tr><th>쓴 사람</th><th>강점</th><th>편지</th><th>상태</th></tr></thead>
                  <tbody>{listSorted.map((m) => (
                    <tr key={m.id} className="cursor-pointer hover:bg-bg" onClick={() => document.getElementById(`msg-${m.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                      <td className="whitespace-nowrap font-semibold">{author(m)}</td>
                      <td className="text-xs">{m.strengths.join(" / ")}</td>
                      <td className="max-w-80 truncate">{m.body}</td>
                      <td className="whitespace-nowrap space-x-1">{m.ai_flagged && !m.teacher_edited && <span className="chip-red">주의</span>}{m.status === "hidden" && <span className="chip-gray">제외</span>}{m.teacher_edited && <span className="chip-gray">확인</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">줄을 누르면 아래 해당 편지로 이동해요.</p>
            </Section>
            {listSorted.map((m) => <div key={m.id} id={`msg-${m.id}`}><ReviewItem m={m} from={author(m)} to={name} refresh={refresh} /></div>)}
          </>
        )
      )}
    </div>
  );
}

function PrintView({ d, only, onClose }: { d: D; only: string | null; onClose: () => void }) {
  const people = useMemo(() => d.students.filter((s) => (only ? s.id === only : true)), [d.students, only]);
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
              {letters.map((m) => (
                <div key={m.id} className="mb-3 break-inside-avoid rounded-lg border border-line p-3 text-sm">
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
