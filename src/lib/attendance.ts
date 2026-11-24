import { toDateString } from "./util";

export const KINDS = ["지각", "조퇴", "결과", "결석"] as const;
export const CATEGORIES = ["질병", "인정", "미인정", "기타"] as const;
export type Kind = (typeof KINDS)[number];
export type Category = (typeof CATEGORIES)[number];

export type Report = {
  id: string;
  student_no: string;
  student_name: string;
  report_date: string;
  kind: string;
  category: string;
  reason: string;
  time_note: string;
  neis_registered: boolean;
  created_by_teacher: boolean;
  created_at: string;
};

export const KIND_HINT: Record<Kind, string> = {
  지각: "등교한 시각 (예: 09:15)",
  조퇴: "학교를 떠난 시각 (예: 14:00)",
  결과: "빠진 교시 (예: 3교시)",
  결석: "",
};
export const KIND_EMOJI: Record<string, string> = { 지각: "🌤️", 조퇴: "🍃", 결과: "🌿", 결석: "🍂" };
export const KIND_DOT: Record<string, string> = { 지각: "bg-amber-400", 조퇴: "bg-sky-400", 결과: "bg-orange-400", 결석: "bg-rose-400" };
export const CATEGORY_HELP: Record<Category, string> = {
  질병: "아파서 (감기, 장염 등 · 보건실 포함)",
  인정: "학교가 인정한 사유 (생리통, 경조사, 위클래스 상담 등)",
  미인정: "늦잠 등 개인 사유",
  기타: "기타 사유",
};

/** 평일 중 보고가 없던 날이 며칠 연속인지 (앱 시작일 이전은 세지 않음) */
export function calcStreak(dates: string[], today: Date, startDate?: string | null) {
  if (!startDate) return 0;
  const flagged = new Set(dates);
  let streak = 0;
  const cursor = new Date(today);
  for (let i = 0; i < 400; i++) {
    const ds = toDateString(cursor);
    if (ds < startDate) break;
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      if (flagged.has(ds)) break;
      streak++;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function countPerfectMonths(reports: Pick<Report, "kind" | "report_date">[]) {
  if (!reports.length) return 0;
  const bad = new Set(reports.filter((r) => r.kind === "결석" || r.kind === "지각").map((r) => r.report_date.slice(0, 7)));
  const cur = toDateString(new Date()).slice(0, 7);
  return [...new Set(reports.map((r) => r.report_date.slice(0, 7)))].filter((ym) => ym < cur && !bad.has(ym)).length;
}

export function buildBadges(reports: Report[], streak: number, monthCount: number) {
  const perfect = countPerfectMonths(reports);
  return [
    { id: "sprout", name: "새싹", desc: "연속 7일 출석", emoji: "🌱", earned: streak >= 7 },
    { id: "leaf", name: "잎사귀", desc: "연속 14일 출석", emoji: "🍃", earned: streak >= 14 },
    { id: "tree", name: "나무", desc: "연속 30일 출석", emoji: "🌳", earned: streak >= 30 },
    { id: "forest", name: "숲", desc: "연속 60일 출석", emoji: "🌲", earned: streak >= 60 },
    { id: "early", name: "아침햇살", desc: "지각 기록 0회", emoji: "🌤️", earned: !reports.some((r) => r.kind === "지각") },
    { id: "clean", name: "맑은 달", desc: "이번 달 기록 0건", emoji: "🌙", earned: monthCount === 0 },
    { id: "honest", name: "정직한 씨앗", desc: "보고 1회 이상 제출", emoji: "🫶", earned: reports.length >= 1 },
    { id: "perfect", name: "개근의 달", desc: "결석·지각 없이 한 달을 채운 적 있음", emoji: "🏅", earned: perfect >= 1 },
  ];
}

export const POT_OPTIONS = [
  { id: "terracotta", label: "테라코타", pot: "#c26f45", soil: "#8a5232" },
  { id: "cream", label: "크림", pot: "#e7dcc2", soil: "#b3a078" },
  { id: "sage", label: "세이지", pot: "#a3b98f", soil: "#7c9464" },
  { id: "charcoal", label: "차콜", pot: "#5d635d", soil: "#414741" },
] as const;
export const PROP_OPTIONS = [
  { id: "none", label: "없음", emoji: "" },
  { id: "stone", label: "돌", emoji: "🪨" },
  { id: "butterfly", label: "나비", emoji: "🦋" },
  { id: "snail", label: "달팽이", emoji: "🐌" },
] as const;

export const PLANT_STAGES = [
  { min: 0, emoji: "🌰", name: "씨앗" },
  { min: 7, emoji: "🌱", name: "새싹" },
  { min: 14, emoji: "🍃", name: "잎사귀" },
  { min: 30, emoji: "🌳", name: "나무" },
  { min: 60, emoji: "🌲", name: "숲" },
];
export function plantStage(streak: number) {
  let stage = PLANT_STAGES[0];
  for (const s of PLANT_STAGES) if (streak >= s.min) stage = s;
  return { stage, next: PLANT_STAGES.find((s) => s.min > streak) };
}
