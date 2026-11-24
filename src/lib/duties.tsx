export type DutyRow = { student_no: string; name: string; duty: string; service1: string; service2: string; hours: number };

/** 학생 화면에서는 "(5)" 같은 봉사시간 숫자를 지운다 */
const stripHours = (s: string) => s.replace(/\s*\(\d+\)/g, "").trim();

export function DutyBoard({ rows, showHours, highlight }: { rows: DutyRow[]; showHours: boolean; highlight?: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <b>1-7 역할 분담표</b>
        {showHours && <span className="text-[11px] text-muted">( ) 안 숫자 = 봉사시간</span>}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {rows.map((x) => {
          const me = x.name === highlight;
          const s1 = showHours ? x.service1 : stripHours(x.service1);
          const s2 = showHours ? x.service2 : stripHours(x.service2);
          return (
            <li key={x.student_no} className={`rounded-xl border px-3 py-2 ${me ? "border-brand bg-brand-soft" : "border-line bg-white"}`}>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted">{Number(x.student_no.slice(-2))}</span>
                <b className={`text-sm ${me ? "text-brand" : ""}`}>{x.name}</b>
                {showHours && <span className={`ml-auto rounded px-1.5 text-[11px] font-bold ${x.hours ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-400"}`}>{x.hours}h</span>}
              </div>
              <p className={`mt-0.5 text-sm font-semibold ${x.duty ? "text-brand" : "text-muted"}`}>{x.duty || "-"}</p>
              {(s1 || s2) && (
                <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-stone-600">
                  {s1 && <p><span className="mr-1 font-semibold text-muted">1학기</span>{s1}</p>}
                  {s2 && <p><span className="mr-1 font-semibold text-muted">2학기</span>{s2}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const stripServiceHours = stripHours;
