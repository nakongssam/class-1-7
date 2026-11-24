import { supabase } from "./supabase";
import { toDateString } from "./util";

export const ROLES = [
  { id: "front_back", label: "교실 앞뒤", short: "앞뒤" },
  { id: "col1", label: "1분단", short: "1분단" },
  { id: "col2", label: "2분단", short: "2분단" },
  { id: "col3", label: "3분단", short: "3분단" },
  { id: "col4", label: "4분단", short: "4분단" },
] as const;
export type RoleId = (typeof ROLES)[number]["id"];
export const roleLabel = (r: string) => ROLES.find((x) => x.id === r)?.label ?? r;

export type CleanSlot = { day: string; role: RoleId; student_id: string; self_rating: "상" | "중" | "하" | null; done_at: string | null; assigned_by_teacher: boolean };
export type Roster = { id: string; name: string; student_no: string; is_test: boolean };
export type CleanData = {
  from: string | null; to: string | null; perStudent: number;
  off: Map<string, string>; slots: CleanSlot[]; roster: Roster[];
};

export async function loadClean(): Promise<CleanData> {
  const [{ data: cs }, { data: off }, { data: slots, error }, { data: roster }] = await Promise.all([
    supabase.from("class_settings").select("clean_from, clean_to, clean_per_student").maybeSingle(),
    supabase.from("clean_days_off").select("day, reason"),
    supabase.from("clean_slots").select("*").order("day"),
    supabase.rpc("clean_roster"),
  ]);
  if (error) throw error;
  return {
    from: cs?.clean_from ?? null, to: cs?.clean_to ?? null, perStudent: cs?.clean_per_student ?? 1,
    off: new Map((off ?? []).map((o) => [o.day as string, o.reason as string])),
    slots: (slots ?? []) as CleanSlot[],
    roster: (roster ?? []) as Roster[],
  };
}

export const inPeriod = (d: CleanData, day: string) => !!d.from && !!d.to && day >= d.from && day <= d.to;
export const isWeekday = (day: string) => { const w = new Date(`${day}T12:00:00`).getDay(); return w >= 1 && w <= 5; };
/** 기간 안에서 학생별 신청 횟수 */
export const countIn = (d: CleanData, id: string) => d.slots.filter((s) => s.student_id === id && inPeriod(d, s.day) && !d.off.has(s.day)).length;
/** 아직 한 번도 신청 안 된 학생 (테스트 계정 제외) */
export const leftovers = (d: CleanData) => d.roster.filter((r) => !r.is_test && countIn(d, r.id) === 0);
export const nameOf = (d: CleanData, id: string) => d.roster.find((r) => r.id === id)?.name ?? "";

/** 월요일 시작, 평일만 (주 단위 행) */
export function monthWeeks(ym: string): (string | null)[][] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1, 12);
  const last = new Date(y, m, 0, 12);
  const weeks: (string | null)[][] = [];
  const cur = new Date(first);
  cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
  while (cur <= last) {
    const row: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      const c = new Date(cur); c.setDate(cur.getDate() + i);
      row.push(c.getMonth() === m - 1 ? toDateString(c) : null);
    }
    if (row.some(Boolean)) weeks.push(row);
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}
export const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function CleanCalendar({ d, ym, setYm, selected, onPick, today, me }: {
  d: CleanData; ym: string; setYm: (v: string) => void; selected: string | null; onPick: (day: string) => void; today: string; me?: string;
}) {
  const [y, m] = ym.split("-");
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button className="btn-outline btn-sm" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="이전 달">◀</button>
        <b>{y}년 {Number(m)}월</b>
        <button className="btn-outline btn-sm" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="다음 달">▶</button>
      </div>
      <div className="grid grid-cols-5 gap-1 text-center text-xs font-semibold text-muted">{["월", "화", "수", "목", "금"].map((w) => <div key={w}>{w}</div>)}</div>
      <div className="mt-1 space-y-1">
        {monthWeeks(ym).map((row, i) => (
          <div key={i} className="grid grid-cols-5 gap-1">
            {row.map((day, j) => {
              if (!day) return <div key={j} />;
              const off = d.off.get(day);
              const active = inPeriod(d, day) && off === undefined;
              const slots = d.slots.filter((s) => s.day === day);
              const mine = me && slots.some((s) => s.student_id === me);
              const full = slots.length >= ROLES.length;
              return (
                <button key={j} onClick={() => onPick(day)}
                  className={`flex min-h-24 flex-col justify-start rounded-lg border p-1 text-left text-[11px] leading-tight transition ${selected === day ? "ring-2 ring-brand" : ""} ${
                    off !== undefined ? "border-line bg-stone-100 text-muted" : !active ? "border-line bg-paper text-stone-300" : mine ? "border-brand bg-brand-soft" : full ? "border-line bg-white" : "border-amber-300 bg-amber-50/60"}`}>
                  <div className="flex w-full items-center justify-between">
                    <span className={`text-xs font-bold ${day === today ? "rounded bg-ink px-1 text-white" : ""}`}>{Number(day.slice(8))}</span>
                    {active && <span className={full ? "text-brand" : "text-amber-700"}>{slots.length}/5</span>}
                  </div>
                  {off !== undefined ? <div className="mt-1 truncate">{off || "쉬는 날"}</div> : active && (
                    <ul className="mt-0.5 w-full space-y-px">
                      {ROLES.map((r) => {
                        const x = slots.find((s) => s.role === r.id);
                        if (!x) return (
                          <li key={r.id} className="flex items-center gap-1 whitespace-nowrap">
                            <span className="w-5 shrink-0 text-[9px] text-muted">{r.id === "front_back" ? "앞뒤" : r.id.slice(3) + "분"}</span>
                            <span className="text-stone-300">-</span>
                          </li>
                        );
                        return (
                          <li key={r.id} className={`flex items-center gap-1 whitespace-nowrap ${x.student_id === me ? "font-bold text-brand" : ""}`}>
                            <span className="w-5 shrink-0 text-[9px] text-muted">{r.id === "front_back" ? "앞뒤" : r.id.slice(3) + "분"}</span>
                            <span className="truncate">{nameOf(d, x.student_id)}{x.done_at ? "✓" : ""}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {mine && <div className="mt-0.5 font-bold text-brand">내 청소</div>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">노란 칸: 빈자리 있음 · 파란 칸: 내 청소 · 회색: 쉬는 날/기간 밖</p>
    </div>
  );
}

/** 학생별 청소 횟수: 완료(체크함) / 지난 날인데 체크 안 함 / 예정 */
export function cleanCounts(d: CleanData, today: string) {
  return d.roster.filter((r) => !r.is_test).map((r) => {
    const mine = d.slots.filter((s) => s.student_id === r.id && !d.off.has(s.day)); // 쉬는 날로 바뀐 신청은 세지 않음
    return {
      ...r,
      done: mine.filter((s) => s.done_at).length,
      missed: mine.filter((s) => !s.done_at && s.day < today).length,
      planned: mine.filter((s) => !s.done_at && s.day >= today).length,
    };
  });
}

export function CleanCountGrid({ d, today, me }: { d: CleanData; today: string; me?: string }) {
  const rows = cleanCounts(d, today);
  const half = Math.ceil(rows.length / 2);
  const pill = (n: number, cls: string) => n ? <span className={`inline-block min-w-9 rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>{n}회</span> : <span className="text-stone-300">-</span>;
  const table = (list: typeof rows) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-xs">
          <th className="py-1.5 text-left font-semibold text-muted">이름</th>
          <th className="py-1.5 font-semibold text-sky-700">예약</th>
          <th className="py-1.5 font-semibold text-brand">청소함</th>
          <th className="py-1.5 font-semibold text-rose">안 함</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.id} className={`border-b border-line/60 ${r.id === me ? "bg-brand-soft" : r.missed ? "bg-rose-50/50" : ""}`}>
            <td className={`py-1.5 pl-1 ${r.id === me ? "font-bold text-brand" : ""}`}>{r.name}</td>
            <td className="py-1.5 text-center">{pill(r.planned, "bg-sky-100 text-sky-800")}</td>
            <td className="py-1.5 text-center">{pill(r.done, "bg-brand-soft text-brand")}</td>
            <td className="py-1.5 text-center">{pill(r.missed, "bg-rose-100 text-rose")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div>
      <div className="grid gap-x-6 sm:grid-cols-2">{table(rows.slice(0, half))}{table(rows.slice(half))}</div>
      <p className="mt-2 text-[11px] text-muted"><span className="text-sky-700">예약</span> 앞으로 할 청소 · <span className="text-brand">청소함</span> 청소하고 체크까지 함 · <span className="text-rose">안 함</span> 지난 날인데 체크 안 함</p>
    </div>
  );
}

export const thisMonth = (today: string) => today.slice(0, 7);
