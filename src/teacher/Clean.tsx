import { useCallback, useEffect, useState } from "react";
import { CleanCalendar, CleanCountGrid, countIn, inPeriod, isWeekday, leftovers, loadClean, nameOf, ROLES, roleLabel, thisMonth, type CleanData } from "../lib/clean";
import { supabase } from "../lib/supabase";
import { errMsg, formatDay, todayStr, toDateString } from "../lib/util";
import { Loading, Section, useToast } from "../ui/kit";

export default function CleanTeacher() {
  const toast = useToast();
  const today = todayStr();
  const [d, setD] = useState<CleanData | null>(null);
  const [ym, setYm] = useState(thisMonth(today));
  const [sel, setSel] = useState<string | null>(null);
  const [cfg, setCfg] = useState({ from: "", to: "", per: 1 });
  const [offReason, setOffReason] = useState("");
  const load = useCallback(async () => {
    try {
      const x = await loadClean();
      setD(x); setCfg({ from: x.from ?? "", to: x.to ?? "", per: x.perStudent });
    } catch (e) { toast(errMsg(e), "err"); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;

  const saveCfg = async () => {
    if (!cfg.from || !cfg.to || cfg.from > cfg.to) return toast("시작일과 끝나는 날을 확인해 주세요.", "err");
    const { error } = await supabase.from("class_settings").update({ clean_from: cfg.from, clean_to: cfg.to, clean_per_student: cfg.per }).eq("id", 1);
    if (error) return toast(errMsg(error), "err");
    toast("청소 신청 기간을 저장했어요."); load();
  };
  const assign = async (day: string, role: string, studentId: string) => {
    const cur = d.slots.find((s) => s.day === day && s.role === role);
    if (cur) {
      const { error } = await supabase.from("clean_slots").delete().eq("day", day).eq("role", role);
      if (error) return toast(errMsg(error), "err");
    }
    if (studentId) {
      await supabase.from("clean_slots").delete().eq("day", day).eq("student_id", studentId); // 같은 날 다른 자리에 있으면 옮김
      const { error } = await supabase.from("clean_slots").insert({ day, role, student_id: studentId, assigned_by_teacher: true });
      if (error) return toast(errMsg(error), "err");
    }
    load();
  };
  const removeSlotsOn = async (day: string) => {
    const { error } = await supabase.from("clean_slots").delete().eq("day", day);
    if (error) { toast(errMsg(error), "err"); return false; }
    return true;
  };
  const toggleOff = async (day: string) => {
    const onDay = d.slots.filter((s) => s.day === day);
    if (!d.off.has(day) && onDay.length) {
      if (!window.confirm(`이 날 신청한 ${onDay.map((s) => nameOf(d, s.student_id)).join(", ")}의 청소가 취소돼요. 학생들은 다른 날로 다시 신청할 수 있어요.\n쉬는 날로 지정할까요?`)) return;
      if (!(await removeSlotsOn(day))) return;
    }
    const { error } = d.off.has(day)
      ? await supabase.from("clean_days_off").delete().eq("day", day)
      : await supabase.from("clean_days_off").insert({ day, reason: offReason.trim() });
    if (error) return toast(errMsg(error), "err");
    setOffReason(""); load();
  };
  const autoFill = async () => {
    if (!d.from || !d.to) return;
    const start = d.from > today ? d.from : (() => { const x = new Date(`${today}T12:00:00`); x.setDate(x.getDate() + 1); return toDateString(x); })();
    const empty: { day: string; role: string }[] = [];
    for (const x = new Date(`${start}T12:00:00`); toDateString(x) <= d.to; x.setDate(x.getDate() + 1)) {
      const day = toDateString(x);
      if (!isWeekday(day) || d.off.has(day)) continue;
      for (const r of ROLES) if (!d.slots.some((s) => s.day === day && s.role === r.id)) empty.push({ day, role: r.id });
    }
    const people = [...leftovers(d)].sort(() => Math.random() - 0.5);
    if (!people.length) return toast("남은 학생이 없어요.");
    if (!empty.length) return toast("남은 빈자리가 없어요.", "err");
    // 빈자리가 많은 날부터 날짜 순으로 채움 (같은 날 두 번 안 들어가게)
    const rows: { day: string; role: string; student_id: string; assigned_by_teacher: boolean }[] = [];
    for (const p of people) {
      const slot = empty.find((e) => !rows.some((r) => r.day === e.day && (r.role === e.role || r.student_id === p.id)));
      if (!slot) break;
      rows.push({ ...slot, student_id: p.id, assigned_by_teacher: true });
      empty.splice(empty.indexOf(slot), 1);
    }
    if (!window.confirm(`남은 학생 ${rows.length}명을 빈자리에 배정할까요?${rows.length < people.length ? `\n(빈자리가 부족해 ${people.length - rows.length}명은 남아요)` : ""}`)) return;
    const { error } = await supabase.from("clean_slots").insert(rows);
    if (error) return toast(errMsg(error), "err");
    toast(`${rows.length}명을 배정했어요.`); load();
  };

  const left = leftovers(d);
  const unchecked = d.slots.filter((s) => s.day < today && !s.done_at);
  const selSlots = sel ? d.slots.filter((s) => s.day === sel) : [];
  const others = d.roster;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="space-y-4">
        <Section title="🧹 청소 달력">
          <CleanCalendar d={d} ym={ym} setYm={setYm} selected={sel} onPick={setSel} today={today} />
        </Section>
        {sel && (
          <Section title={formatDay(sel)} right={
            <div className="flex items-center gap-2">
              {!d.off.has(sel) && <input className="input w-36 py-1.5 text-sm" placeholder="사유 (예: 시험)" value={offReason} onChange={(e) => setOffReason(e.target.value)} />}
              <button className="btn-outline btn-sm" onClick={() => toggleOff(sel)}>{d.off.has(sel) ? "청소하는 날로 되돌리기" : "쉬는 날로 지정"}</button>
            </div>}>
            {d.off.has(sel) ? (
              <div className="text-sm">
                <p className="text-muted">쉬는 날: {d.off.get(sel) || "사유 없음"}</p>
                {selSlots.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2">
                    <span>쉬는 날로 바꾸기 전에 신청한 학생: <b>{selSlots.map((s) => nameOf(d, s.student_id)).join(", ")}</b> (횟수에는 안 들어가요)</span>
                    <button className="btn-danger" onClick={async () => { if (window.confirm("이 날 남아 있는 신청을 지울까요?") && (await removeSlotsOn(sel))) { toast("지웠어요."); load(); } }}>신청 지우기</button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {!inPeriod(d, sel) && <p className="mb-2 text-xs text-amber-700">신청 기간 밖이에요. 선생님은 그래도 배정할 수 있어요.</p>}
                <ul className="space-y-2">
                  {ROLES.map((r) => {
                    const s = selSlots.find((x) => x.role === r.id);
                    return (
                      <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
                        <span className="w-20 shrink-0 text-sm font-semibold">{r.label}</span>
                        <select className="input max-w-44 py-1.5 text-sm" value={s?.student_id ?? ""} onChange={(e) => assign(sel, r.id, e.target.value)} aria-label={`${r.label} 담당`}>
                          <option value="">— 비어 있음 —</option>
                          {others.map((p) => <option key={p.id} value={p.id}>{p.name} ({countIn(d, p.id)}회){p.is_test ? " 테스트" : ""}</option>)}
                        </select>
                        {s && (s.done_at ? <span className="chip">완료 · {s.self_rating}</span> : sel <= today ? <span className="chip-warn">체크 전</span> : null)}
                        {s?.assigned_by_teacher && <span className="text-[11px] text-muted">선생님 배정</span>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Section>
        )}
        <Section title="개인별 청소 횟수"><CleanCountGrid d={d} today={today} /></Section>
      </div>
      <div className="space-y-4">
        <Section title="신청 기간">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">시작</label><input type="date" className="input" value={cfg.from} onChange={(e) => setCfg({ ...cfg, from: e.target.value })} /></div>
            <div><label className="label">끝</label><input type="date" className="input" value={cfg.to} onChange={(e) => setCfg({ ...cfg, to: e.target.value })} /></div>
          </div>
          <div className="mt-2 flex items-end gap-2">
            <div><label className="label">한 사람당 횟수</label><input type="number" min={1} max={20} className="input w-24" value={cfg.per} onChange={(e) => setCfg({ ...cfg, per: Number(e.target.value) })} /></div>
            <button className="btn btn-sm" onClick={saveCfg}>저장</button>
          </div>
          {d.from && d.to && (() => {
            let days = 0;
            for (const x = new Date(`${d.from}T12:00:00`); toDateString(x) <= d.to; x.setDate(x.getDate() + 1)) { const s = toDateString(x); if (isWeekday(s) && !d.off.has(s)) days++; }
            const need = d.roster.filter((r) => !r.is_test).length * d.perStudent;
            return <p className="mt-2 text-xs text-muted">청소하는 날 {days}일 · 자리 {days * 5}개 / 필요한 자리 {need}개{days * 5 < need ? " ⚠ 자리가 모자라요" : ""}</p>;
          })()}
        </Section>
        <Section title={`남은 학생 (${left.length})`} right={left.length > 0 && <button className="btn btn-sm" onClick={autoFill}>빈자리에 자동 배정</button>}>
          {!left.length ? <p className="text-sm">모두 배정됐어요.</p> : <p className="text-sm leading-relaxed">{left.map((r) => r.name).join(", ")}</p>}
          <p className="mt-2 text-xs text-muted">자동 배정은 내일 이후 빈자리를 날짜 순으로 채워요. 배정 뒤 달력에서 바꿀 수 있어요.</p>
        </Section>
        <Section title={`체크 안 한 청소 (${unchecked.length})`}>
          {!unchecked.length ? <p className="text-sm">모두 체크했어요.</p> : (
            <ul className="space-y-1 text-sm">
              {unchecked.slice(-30).reverse().map((s) => <li key={s.day + s.role}>{formatDay(s.day)} · {roleLabel(s.role)} · <b>{nameOf(d, s.student_id)}</b></li>)}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
