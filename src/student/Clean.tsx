import { useCallback, useEffect, useState } from "react";
import type { Me } from "../App";
import { CleanCalendar, CleanCountGrid, countIn, inPeriod, isWeekday, leftovers, loadClean, nameOf, ROLES, roleLabel, thisMonth, type CleanData, type CleanSlot } from "../lib/clean";
import { supabase } from "../lib/supabase";
import { errMsg, formatDay } from "../lib/util";
import { Empty, Loading, Section, useToast } from "../ui/kit";

export function RatingButtons({ slot, onDone }: { slot: CleanSlot; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pick = async (r: "상" | "중" | "하") => {
    setBusy(true);
    const { error } = await supabase.rpc("clean_check", { _day: slot.day, _rating: r });
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    toast("청소 완료 체크했어요. 수고했어요! 🧹"); onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">얼마나 열심히 했나요?</span>
      {(["상", "중", "하"] as const).map((r) => (
        <button key={r} disabled={busy} onClick={() => pick(r)} className={slot.self_rating === r ? "btn btn-sm" : "btn-outline btn-sm"}>{r}</button>
      ))}
    </div>
  );
}

export default function CleanStudent({ me }: { me: Me }) {
  const toast = useToast();
  const [d, setD] = useState<CleanData | null>(null);
  const [ym, setYm] = useState(thisMonth(me.today));
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setD(await loadClean()); } catch (e) { toast(errMsg(e), "err"); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;

  const mine = d.slots.filter((s) => s.student_id === me.id);
  const toCheck = mine.filter((s) => s.day <= me.today && !s.done_at);
  const upcoming = mine.filter((s) => s.day > me.today);
  const used = countIn(d, me.id);
  const left = leftovers(d);

  const signup = async (day: string, role: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("clean_signup", { _day: day, _role: role });
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    toast(`${formatDay(day)} ${roleLabel(role)} 신청했어요.`); load();
  };
  const cancel = async (day: string) => {
    if (!window.confirm(`${formatDay(day)} 청소 신청을 취소할까요?`)) return;
    const { error } = await supabase.rpc("clean_cancel", { _day: day });
    if (error) return toast(errMsg(error), "err");
    toast("취소했어요."); load();
  };

  const selSlots = sel ? d.slots.filter((s) => s.day === sel) : [];
  const selOff = sel ? d.off.get(sel) : undefined;
  const canSign = !!sel && inPeriod(d, sel) && isWeekday(sel) && selOff === undefined && sel >= me.today && used < d.perStudent && !selSlots.some((s) => s.student_id === me.id);

  return (
    <>
      <h1 className="text-xl font-extrabold">🧹 청소</h1>

      {toCheck.length > 0 && (
        <Section title="청소 다 했으면 체크!" className="border-amber-300 bg-amber-50">
          <div className="space-y-3">
            {toCheck.map((s) => (
              <div key={s.day}>
                <p className="mb-1.5 font-semibold">{formatDay(s.day)} · {roleLabel(s.role)}</p>
                <RatingButtons slot={s} onDone={load} />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="내 청소" right={<span className="chip">지금까지 {mine.filter((s) => s.done_at).length}회 청소</span>}>
        {!mine.length ? <p className="text-sm text-muted">아직 신청하지 않았어요. 아래 달력에서 같이 하고 싶은 친구와 같은 날을 골라 신청해요.</p> : (
          <ul className="space-y-1.5 text-sm">
            {[...upcoming, ...mine.filter((s) => s.day <= me.today).reverse()].map((s) => (
              <li key={s.day} className="flex flex-wrap items-center gap-2">
                <b>{formatDay(s.day)}</b><span className="chip-gray">{roleLabel(s.role)}</span>
                {s.done_at ? <span className="chip">완료 ✓ {s.self_rating}</span> : s.day > me.today ? <span className="text-xs text-muted">예정</span> : <span className="chip-warn">체크 전</span>}
                {s.day > me.today && !s.assigned_by_teacher && <button className="btn-danger ml-auto" onClick={() => cancel(s.day)}>취소</button>}
              </li>
            ))}
          </ul>
        )}
        {d.from && <p className="mt-3 text-xs text-muted">신청 기간 {formatDay(d.from)} ~ {formatDay(d.to!)} · 한 사람당 {d.perStudent}번 (나: {used}/{d.perStudent})</p>}
      </Section>

      <Section title="청소 달력">
        {!d.from && <p className="mb-3 text-sm text-amber-700">아직 선생님이 신청 기간을 열지 않았어요.</p>}
        <CleanCalendar d={d} ym={ym} setYm={setYm} selected={sel} onPick={setSel} today={me.today} me={me.id} />
      </Section>

      {sel && (
        <Section title={formatDay(sel)}>
          {selOff !== undefined ? <Empty>{selOff || "청소가 없는 날이에요."}</Empty> : !inPeriod(d, sel) ? <Empty>신청 기간이 아닌 날이에요.</Empty> : (
            <ul className="space-y-2">
              {ROLES.map((r) => {
                const s = selSlots.find((x) => x.role === r.id);
                return (
                  <li key={r.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
                    <span className="w-20 shrink-0 text-sm font-semibold">{r.label}</span>
                    {s ? (
                      <span className={`text-sm ${s.student_id === me.id ? "font-bold text-brand" : ""}`}>{nameOf(d, s.student_id)}{s.done_at && " ✓"}</span>
                    ) : canSign ? (
                      <button className="btn btn-sm ml-auto" disabled={busy} onClick={() => signup(sel, r.id)}>이 자리 신청</button>
                    ) : <span className="text-sm text-muted">빈자리</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {inPeriod(d, sel) && selOff === undefined && !canSign && sel >= me.today && used >= d.perStudent && !selSlots.some((s) => s.student_id === me.id) && (
            <p className="mt-2 text-xs text-muted">이번 기간 신청을 다 했어요. 날짜를 바꾸려면 '내 청소'에서 먼저 취소해요.</p>
          )}
        </Section>
      )}

      <Section title="개인별 청소 횟수"><CleanCountGrid d={d} today={me.today} me={me.id} /></Section>

      {d.from && (
        <Section title={`아직 신청 안 한 친구 (${left.length})`}>
          {!left.length ? <p className="text-sm">모두 신청했어요! 🎉</p> : <p className="text-sm leading-relaxed">{left.map((r) => r.name).join(", ")}</p>}
          <p className="mt-2 text-xs text-muted">신청하지 않은 친구는 선생님이 남은 자리에 정해 줘요.</p>
        </Section>
      )}
    </>
  );
}
