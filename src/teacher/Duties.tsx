import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { downloadCsv, errMsg } from "../lib/util";
import { Loading, Section, Tabs, useToast } from "../ui/kit";
import { DutyBoard, type DutyRow } from "../lib/duties";

type Row = { id: string; student_no: string; name: string; duty: string; service1: string; service2: string; hours: number };
const FIELDS = ["duty", "service1", "service2", "hours"] as const;

export default function DutiesTeacher() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const dirty = useRef(new Set<string>());
  const [checks, setChecks] = useState<Map<string, string>>(new Map());
  const [view, setView] = useState<"분담표 보기" | "편집">("분담표 보기");
  const load = useCallback(async () => {
    const [{ data: st }, { data: du }] = await Promise.all([
      supabase.from("students").select("id, student_no, name, role").in("role", ["student", "test"]).eq("active", true).order("student_no"),
      supabase.from("class_duties").select("*"),
    ]);
    const { data: ck } = await supabase.from("duty_checks").select("student_id, item_key, rating");
    const noOf = new Map((st ?? []).map((x) => [x.id, x.student_no]));
    setChecks(new Map((ck ?? []).map((c) => [`${noOf.get(c.student_id)}|${c.item_key}`, c.rating])));
    const m = new Map((du ?? []).map((d) => [d.student_id, d]));
    setRows((st ?? []).map((s) => ({ id: s.id, student_no: s.student_no, name: s.name, duty: m.get(s.id)?.duty ?? "", service1: m.get(s.id)?.service1 ?? "", service2: m.get(s.id)?.service2 ?? "", hours: m.get(s.id)?.hours ?? 0 })));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <Loading />;

  const save = async (r: Row) => {
    if (!dirty.current.has(r.id)) return;
    dirty.current.delete(r.id);
    const { error } = await supabase.from("class_duties").upsert({ student_id: r.id, duty: r.duty.trim(), service1: r.service1.trim(), service2: r.service2.trim(), hours: r.hours || 0, updated_at: new Date().toISOString() });
    if (error) return toast(errMsg(error), "err");
    toast(`${r.name} 저장했어요.`);
  };
  const set = (i: number, k: (typeof FIELDS)[number], v: string) => {
    dirty.current.add(rows[i].id);
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: k === "hours" ? Number(v) || 0 : v } : r)));
  };

  const board: DutyRow[] = rows.map((r) => ({ student_no: r.student_no, name: r.name, duty: r.duty, service1: r.service1, service2: r.service2, hours: r.hours }));
  return (
    <>
    <Tabs tabs={["분담표 보기", "편집"] as const} value={view} onChange={(v) => { setView(v); if (v === "분담표 보기") load(); }} />
    {view === "분담표 보기" ? <Section><DutyBoard rows={board} showHours checks={checks} /><p className="mt-3 text-[11px] text-muted">각 칸 아래: 학생이 항목별로 스스로 체크한 상·중·하 (- = 아직 안 함)</p></Section> :
    <Section title="🙋 1인 1역 · 봉사" right={
      <button className="btn-outline btn-sm" onClick={() => downloadCsv("1-7_역할분담표.csv", [["학번", "이름", "1인1역", "1학기 봉사", "2학기 봉사", "합계"], ...rows.map((r) => [r.student_no, r.name, r.duty, r.service1, r.service2, r.hours])])}>CSV</button>}>
      <p className="mb-3 text-xs text-muted">칸을 고치고 다른 곳을 누르면 저장돼요. 학생들은 우리 반 1인1역 목록과 자기 봉사 내역만 볼 수 있어요.</p>
      <div className="overflow-x-auto">
        <table className="table min-w-[900px]">
          <thead><tr><th>번호</th><th>이름</th><th>1인 1역</th><th>1학기 봉사</th><th>2학기 봉사</th><th>합계(시간)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="text-muted">{Number(r.student_no.slice(-2))}</td><td className="font-semibold">{r.name}</td>
                {FIELDS.map((k) => (
                  <td key={k}>
                    <input className={`input py-1.5 text-sm ${k === "hours" ? "w-20" : ""}`} type={k === "hours" ? "number" : "text"} value={r[k]}
                      onChange={(e) => set(i, k, e.target.value)} onBlur={() => save(rows[i])} aria-label={`${r.name} ${k}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>}
    </>
  );
}
