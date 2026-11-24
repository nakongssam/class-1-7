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
export const countIn = (d: CleanData, id: string) => d.slots.filter((s) => s.student_id === id && inPeriod(d, s.day)).length;
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
              const past = day < today;
              const done = slots.filter((s) => s.done_at).length;
              return (
                <button key={j} onClick={() => onPick(day)}
                  className={`min-h-16 rounded-lg border p-1 text-left text-[11px] leading-tight transition ${selected === day ? "ring-2 ring-brand" : ""} ${
                    off !== undefined ? "border-line bg-stone-100 text-muted" : !active ? "border-line bg-paper text-stone-300" : mine ? "border-brand bg-brand-soft" : full ? "border-line bg-white" : "border-amber-300 bg-amber-50/60"}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${day === today ? "rounded bg-ink px-1 text-white" : ""}`}>{Number(day.slice(8))}</span>
                    {active && <span className={full ? "text-brand" : "text-amber-700"}>{slots.length}/5</span>}
                  </div>
                  {off !== undefined ? <div className="mt-1 truncate">{off || "쉬는 날"}</div> : active && (
                    <div className="mt-0.5 hidden truncate sm:block">{slots.map((s) => nameOf(d, s.student_id)).join(" ")}</div>
                  )}
                  {active && past && slots.length > 0 && <div className="mt-0.5">✓{done}/{slots.length}</div>}
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
    const mine = d.slots.filter((s) => s.student_id === r.id);
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
  const stat = (label: string, n: number, color: string) => (
    <div className="flex-1 text-center">
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`text-sm font-bold ${n ? color : "text-stone-300"}`}>{n}회</p>
    </div>
  );
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {rows.map((r) => (
        <li key={r.id} className={`rounded-xl border px-2.5 py-2 ${r.id === me ? "border-brand bg-brand-soft" : "border-line bg-white"}`}>
          <p className={`text-sm font-semibold ${r.id === me ? "text-brand" : ""}`}>{r.name}</p>
          <div className="mt-1 flex divide-x divide-line">
            {stat("예약", r.planned, "text-stone-700")}
            {stat("청소함", r.done, "text-brand")}
            {stat("안 함", r.missed, "text-rose")}
          </div>
        </li>
      ))}
    </ul>
  );
}

export const thisMonth = (today: string) => today.slice(0, 7);
