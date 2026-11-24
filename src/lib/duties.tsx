export type DutyItem = { key: string; kind: string; label: string };
/** 1인1역 + 학기별 봉사 항목을 하나씩 나눈다 ("A (5) · B (5)" → 두 항목) */
export function dutyItems(r: { duty: string; service1: string; service2: string }): DutyItem[] {
  const out: DutyItem[] = [];
  if (r.duty.trim()) out.push({ key: "duty", kind: "1인 1역", label: r.duty.trim() });
  ([["s1", "1학기 봉사", r.service1], ["s2", "2학기 봉사", r.service2]] as const).forEach(([k, kind, v]) =>
    v.split("·").map((x) => x.replace(/\s*\(\d+\)/g, "").trim()).filter(Boolean)
      .forEach((label) => out.push({ key: `${k}:${label}`, kind, label })));
  return out;
}
export type DutyChecks = Map<string, string>; // `${student_no}|${item_key}` → 상/중/하

export type DutyRow = { student_no: string; name: string; duty: string; service1: string; service2: string; hours: number };

/** 학생 화면에서는 "(5)" 같은 봉사시간 숫자를 지운다 */
const stripHours = (s: string) => s.replace(/\s*\(\d+\)/g, "").trim();

export function DutyBoard({ rows, showHours, highlight, checks }: { rows: DutyRow[]; showHours: boolean; highlight?: string; checks?: DutyChecks }) {
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
              {checks && (() => {
                const items = dutyItems(x);
                if (!items.length) return null;
                return (
                  <div className="mt-1.5 flex flex-wrap gap-1 border-t border-line pt-1.5">
                    {items.map((it) => {
                      const r = checks.get(`${x.student_no}|${it.key}`);
                      return <span key={it.key} title={`${it.kind}: ${it.label}`} className={`rounded px-1.5 text-[10px] font-semibold ${r === "상" ? "bg-brand-soft text-brand" : r === "중" ? "bg-amber-100 text-amber-800" : r === "하" ? "bg-rose-50 text-rose" : "bg-stone-100 text-stone-400"}`}>{it.key === "duty" ? "1인1역" : it.label.slice(0, 6)} {r ?? "-"}</span>;
                    })}
                  </div>
                );
              })()}
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
