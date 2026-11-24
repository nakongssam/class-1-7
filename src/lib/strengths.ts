import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// AI가 정리한 강점 사전: 학생이 적은 표현 → 표준 강점 키워드들
export type StrengthMap = Map<string, string[]>;

let cache: StrengthMap | null = null;
const listeners = new Set<(m: StrengthMap) => void>();

export async function loadStrengthMap(force = false) {
  if (cache && !force) return cache;
  const { data } = await supabase.from("relay_strength_map").select("raw, tags");
  cache = new Map((data ?? []).map((r) => [r.raw as string, r.tags as string[]]));
  listeners.forEach((f) => f(cache!));
  return cache;
}

export function useStrengthMap() {
  const [map, setMap] = useState<StrengthMap>(cache ?? new Map());
  useEffect(() => {
    listeners.add(setMap);
    loadStrengthMap().then(setMap);
    return () => { listeners.delete(setMap); };
  }, []);
  return map;
}

// 사전에 없으면 띄어쓰기만 정리해서 그대로 센다
export function tagsOf(raw: string, map: StrengthMap) {
  const r = raw.trim();
  return map.get(r) ?? (r ? [r.replace(/\s+/g, " ")] : []);
}

export function countStrengths(letters: { strengths: string[] }[], map: StrengthMap) {
  const counts = new Map<string, number>();
  for (const l of letters) {
    const seen = new Set<string>();
    for (const raw of l.strengths) for (const t of tagsOf(raw, map)) seen.add(t); // 한 편지 안의 중복은 한 번만
    seen.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
}
