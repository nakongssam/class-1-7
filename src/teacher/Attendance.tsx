import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Student } from "../lib/supabase";
import { downloadCsv, errMsg, monthLabel, todayStr } from "../lib/util";
import { CATEGORIES, KIND_HINT, KINDS, type Kind, type Report } from "../lib/attendance";
import { Empty, Loading, Section, useToast } from "../ui/kit";

export default function AttendanceTeacher() {
  const toast = useToast();
  const [rows, setRows] = useState<Report[] | null>(null);
  const [roster, setRoster] = useState<Student[]>([]);
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [kind, setKind] = useState("전체");
  const [cat, setCat] = useState("전체");
  const [neis, setNeis] = useState("전체");
  const [who, setWho] = useState("");
  const [sort, setSort] = useState<"출결일" | "학번" | "제출일">("출결일");
  const [editing, setEditing] = useState<Report | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [{ data, error }, { data: st }] = await Promise.all([
      supabase.from("attendance_reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("students").select("*").eq("role", "student").order("student_no"),
    ]);
    if (error) toast(errMsg(error), "err");
    setRows((data ?? []) as Report[]);
    setRoster((st ?? []) as Student[]);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const l = (rows ?? []).filter((r) =>
      (month === "전체" || r.report_date.startsWith(month)) && (kind === "전체" || r.kind === kind) && (cat === "전체" || r.category === cat)
      && (neis === "전체" || (neis === "처리" ? r.neis_registered : !r.neis_registered)) && (!who || r.student_no === who));
    return [...l].sort((a, b) => sort === "학번" ? a.student_no.localeCompare(b.student_no) || b.report_date.localeCompare(a.report_date)
      : sort === "제출일" ? b.created_at.localeCompare(a.created_at) : b.report_date.localeCompare(a.report_date));
  }, [rows, month, kind, cat, neis, who, sort]);

  const months = useMemo(() => [...new Set([todayStr().slice(0, 7), ...(rows ?? []).map((r) => r.report_date.slice(0, 7))])].sort().reverse(), [rows]);

  const toggleNeis = async (r: Report) => {
    setRows((p) => p?.map((x) => (x.id === r.id ? { ...x, neis_registered: !r.neis_registered } : x)) ?? null);
    const { error } = await supabase.from("attendance_reports").update({ neis_registered: !r.neis_registered }).eq("id", r.id);
    if (error) { toast(errMsg(error), "err"); load(); }
  };
  const remove = async (r: Report) => {
    if (!confirm(`${r.student_name} ${r.report_date} ${r.kind} 기록을 삭제할까요?`)) return;
    const { error } = await supabase.from("attendance_reports").delete().eq("id", r.id);
    if (error) return toast(errMsg(error), "err");
    toast("삭제했어요."); load();
  };

  if (!rows) return <Loading />;
  const pendingNeis = rows.filter((r) => !r.neis_registered).length;
  const thisMonth = rows.filter((r) => r.report_date.startsWith(todayStr().slice(0, 7))).length;

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="오늘 보고" value={rows.filter((r) => r.report_date === todayStr()).length} />
        <Stat label="이번 달" value={thisMonth} />
        <Stat label="나이스 미처리" value={pendingNeis} warn={pendingNeis > 0} />
      </div>

      <MonthCheck roster={roster} month={month === "전체" ? todayStr().slice(0, 7) : month} />

      <Section title={`제출 기록 (${list.length})`} right={
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setAdding(true)}>+ 수기 등록</button>
          <button className="btn-outline btn-sm" onClick={() => downloadCsv(`출결_${month}.csv`, [["출결일", "학번", "이름", "종류", "구분", "사유", "시간", "나이스"], ...list.map((r) => [r.report_date, r.student_no, r.student_name, r.kind, r.category, r.reason, r.time_note, r.neis_registered ? "O" : ""])])}>⬇ CSV</button>
        </div>
      }>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          <select className="input py-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="월">
            <option value="전체">전체 기간</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <select className="input py-2 text-sm" value={who} onChange={(e) => setWho(e.target.value)} aria-label="학생">
            <option value="">모든 학생</option>{roster.map((s) => <option key={s.id} value={s.student_no}>{s.student_no} {s.name}</option>)}
          </select>
          <select className="input py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류"><option>전체</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <select className="input py-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="구분"><option>전체</option>{CATEGORIES.map((k) => <option key={k}>{k}</option>)}</select>
          <select className="input py-2 text-sm" value={neis} onChange={(e) => setNeis(e.target.value)} aria-label="나이스"><option>전체</option><option>미처리</option><option>처리</option></select>
          <select className="input py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="정렬"><option>출결일</option><option>학번</option><option>제출일</option></select>
        </div>
        {!list.length ? <Empty>조건에 맞는 기록이 없어요.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead><tr><th>나이스</th><th>출결일</th><th>학생</th><th>종류</th><th>구분</th><th>사유</th><th>시간</th><th></th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={r.neis_registered ? "text-muted" : ""}>
                    <td><input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={r.neis_registered} onChange={() => toggleNeis(r)} aria-label="나이스 처리" /></td>
                    <td className="whitespace-nowrap">{r.report_date.slice(5).replace("-", "/")}</td>
                    <td className="whitespace-nowrap">{r.student_no.slice(3)} {r.student_name}{r.created_by_teacher && <span className="chip-gray ml-1">교사</span>}</td>
                    <td>{r.kind}</td><td>{r.category}</td><td className="max-w-64">{r.reason}</td><td className="whitespace-nowrap">{r.time_note}</td>
                    <td className="whitespace-nowrap text-right"><button className="btn-outline btn-sm" onClick={() => setEditing(r)}>수정</button> <button className="btn-danger" onClick={() => remove(r)}>삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {(editing || adding) && <EditDialog report={editing} roster={roster} onClose={() => { setEditing(null); setAdding(false); }} onSaved={() => { setEditing(null); setAdding(false); load(); }} />}
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return <div className="card py-4 text-center"><p className="text-xs text-muted">{label}</p><p className={`mt-1 text-2xl font-extrabold ${warn ? "text-rose" : ""}`}>{value}</p></div>;
}

function MonthCheck({ roster, month }: { roster: Student[]; month: string }) {
  const toast = useToast();
  const [opened, setOpened] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    const [{ data: c }, { data: d }] = await Promise.all([
      supabase.from("attendance_month_checks").select("month").eq("month", month).maybeSingle(),
      supabase.from("attendance_month_confirmations").select("student_no").eq("month", month),
    ]);
    setOpened(!!c); setDone(new Set((d ?? []).map((x) => x.student_no)));
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const toggle = async () => {
    const { error } = opened
      ? await supabase.from("attendance_month_checks").delete().eq("month", month)
      : await supabase.from("attendance_month_checks").insert({ month });
    if (error) return toast(errMsg(error), "err");
    toast(opened ? "확인 요청을 닫았어요." : `${monthLabel(month)} 확인 요청을 보냈어요.`); load();
  };
  const notYet = roster.filter((s) => !done.has(s.student_no));
  return (
    <Section title={`📋 ${monthLabel(month)} 월말 확인`} right={<button className={opened ? "btn-outline btn-sm" : "btn btn-sm"} onClick={toggle}>{opened ? "요청 닫기" : "학생에게 확인 요청"}</button>}>
      {opened ? (
        <>
          <p className="text-sm">확인 완료 <b>{done.size}</b> / {roster.length}명</p>
          {notYet.length > 0 && <p className="mt-2 text-xs text-muted">아직: {notYet.map((s) => s.name).join(", ")}</p>}
        </>
      ) : <p className="text-sm text-muted">요청을 보내면 학생 홈에 '출결 기록 확인' 알림이 떠요.</p>}
    </Section>
  );
}

function EditDialog({ report, roster, onClose, onSaved }: { report: Report | null; roster: Student[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    student_no: report?.student_no ?? "", report_date: report?.report_date ?? todayStr(), kind: (report?.kind ?? "지각") as Kind,
    category: report?.category ?? "질병", reason: report?.reason ?? "", time_note: report?.time_note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.student_no || !f.reason.trim()) return toast("학생과 사유를 입력해 주세요.", "err");
    setBusy(true);
    const payload = { report_date: f.report_date, kind: f.kind, category: f.category, reason: f.reason.trim(), time_note: f.kind === "결석" ? "" : f.time_note.trim() };
    const { error } = report
      ? await supabase.from("attendance_reports").update(payload).eq("id", report.id)
      : await supabase.from("attendance_reports").insert({ ...payload, student_no: f.student_no, student_name: "" });
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    toast("저장했어요."); onSaved();
  };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="출결 기록">
        <h3 className="text-lg font-bold">{report ? "기록 수정" : "수기 등록"}</h3>
        <select className="input" disabled={!!report} value={f.student_no} onChange={(e) => setF({ ...f, student_no: e.target.value })}>
          <option value="">학생 선택</option>{roster.map((s) => <option key={s.id} value={s.student_no}>{s.student_no} {s.name}</option>)}
        </select>
        <input type="date" className="input" value={f.report_date} onChange={(e) => setF({ ...f, report_date: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((k) => <option key={k}>{k}</option>)}</select>
        </div>
        {f.kind !== "결석" && <input className="input" placeholder={KIND_HINT[f.kind]} value={f.time_note} onChange={(e) => setF({ ...f, time_note: e.target.value })} />}
        <textarea className="input" rows={2} placeholder="사유" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <div className="flex justify-end gap-2"><button className="btn-outline" onClick={onClose}>취소</button><button className="btn" disabled={busy} onClick={save}>저장</button></div>
      </div>
    </div>
  );
}
