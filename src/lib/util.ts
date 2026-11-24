export function todayStr(d = new Date()) {
  const kst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60000);
  return toDateString(kst);
}
export function toDateString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function formatDay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}
export function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}
export function nextWeekdays(from: string, count: number) {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00`);
  while (out.length < count) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    out.push(toDateString(d));
  }
  return out;
}

// 엑셀·구글시트에서 한글이 깨지지 않는 CSV (BOM 포함)
export function downloadCsv(filename: string, rows: (string | number | boolean | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errMsg(e: unknown, fallback = "문제가 생겼어요. 다시 시도해 주세요.") {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    const m = (e as { message: string }).message;
    if (/row-level security|permission denied/i.test(m)) return "권한이 없어요. 다시 로그인해 주세요.";
    return m;
  }
  return fallback;
}

/** 그 주 월요일 (yyyy-mm-dd) */
export function weekStart(day: string) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateString(d);
}
