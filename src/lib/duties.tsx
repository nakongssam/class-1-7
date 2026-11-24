export type DutyItem = { key: string; kind: string; label: string; raw: string };
/** 1인1역 + 학기별 봉사 항목을 하나씩 나눈다 ("A (5) · B (5)" → 두 항목) */
export function dutyItems(r: { duty: string; service1: string; service2: string }): DutyItem[] {
  const out: DutyItem[] = [];
  if (r.duty.trim()) out.push({ key: "duty", kind: "1인 1역", label: r.duty.trim(), raw: r.duty.trim() });
  ([["s1", "1학기 봉사", r.service1], ["s2", "2학기 봉사", r.service2]] as const).forEach(([k, kind, v]) =>
    v.split("·").map((x) => x.trim()).filter(Boolean)
      .forEach((raw) => { const label = raw.replace(/\s*\(\d+\)/g, "").trim(); out.push({ key: `${k}:${label}`, kind, label, raw }); }));
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
          const items = dutyItems(x);
          const color = (v?: string) => v === "상" ? "bg-brand-soft text-brand" : v === "중" ? "bg-amber-100 text-amber-800" : v === "하" ? "bg-rose-50 text-rose" : "bg-stone-100 text-stone-400";
          const kindLabel = (k: string) => (k === "1인 1역" ? "1인1역" : k.slice(0, 3));
          return (
            <li key={x.student_no} className={`rounded-xl border px-3 py-2.5 ${me ? "border-brand bg-brand-soft" : "border-line bg-white"}`}>
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[11px] text-muted">{Number(x.student_no.slice(-2))}</span>
                <b className={`text-sm ${me ? "text-brand" : ""}`}>{x.name}</b>
                {showHours && <span className={`ml-auto rounded px-1.5 text-[11px] font-bold ${x.hours ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-400"}`}>{x.hours}h</span>}
              </div>
              {!items.length ? <p className="text-xs text-muted">역할·봉사 없음</p> : (
                <ul className="space-y-1">
                  {items.map((it, k) => {
                    const first = k === 0 || items[k - 1].kind !== it.kind;
                    const v = checks?.get(`${x.student_no}|${it.key}`);
                    return (
                      <li key={it.key} className="flex items-start gap-2 text-xs leading-snug">
                        <span className={`w-9 shrink-0 pt-px text-[10px] font-semibold ${it.key === "duty" ? "text-brand" : "text-muted"}`}>{first ? kindLabel(it.kind) : ""}</span>
                        <span className={`min-w-0 flex-1 ${it.key === "duty" ? "text-sm font-semibold text-brand" : "text-stone-700"}`}>{showHours ? it.raw : it.label}</span>
                        {checks && <span className={`w-5 shrink-0 rounded text-center text-[10px] font-bold ${color(v)}`}>{v ?? "-"}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const stripServiceHours = stripHours;
