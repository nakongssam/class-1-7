import { useCallback, useEffect, useState } from "react";
import type { Me } from "../App";
import { ChangePin, signOut } from "../App";
import { callFn, supabase, type Student } from "../lib/supabase";
import { downloadCsv, errMsg, formatDay } from "../lib/util";
import { Section, Tabs, useToast } from "../ui/kit";
import AttendanceTeacher from "./Attendance";
import RelayTeacher from "./Relay";
import StudyTeacher from "./Study";
import CleanTeacher from "./Clean";
import DutiesTeacher from "./Duties";

const TABS = ["출결", "칭찬 릴레이", "스터디", "청소", "1인1역", "학생·계정", "내보내기"] as const;
type Tab = (typeof TABS)[number];

export default function TeacherApp({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>(() => (TABS.find((t) => `#${encodeURIComponent(t)}` === location.hash) ?? "출결"));
  const go = (t: Tab) => { setTab(t); location.hash = encodeURIComponent(t); };
  return (
    <div className="min-h-dvh pb-16">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-xs font-extrabold text-white">1-7</span>
            <span className="font-bold">교사 화면</span>
            <span className="hidden text-sm text-muted sm:inline">· {formatDay(me.today)}</span>
          </div>
          <button className="text-sm text-muted hover:underline" onClick={signOut}>로그아웃</button>
        </div>
        <div className="mx-auto max-w-6xl px-5 pb-3"><Tabs tabs={TABS} value={tab} onChange={go} /></div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-5 py-5">
        {tab === "출결" && <AttendanceTeacher />}
        {tab === "칭찬 릴레이" && <RelayTeacher me={me} />}
        {tab === "스터디" && <StudyTeacher />}
        {tab === "청소" && <CleanTeacher />}
        {tab === "1인1역" && <DutiesTeacher />}
        {tab === "학생·계정" && <Accounts />}
        {tab === "내보내기" && <Export />}
      </main>
    </div>
  );
}

type LoginStatus = { student_no: string; pin_set: boolean; locked: boolean; last_reset_at: string | null; has_account: boolean };

function Accounts() {
  const toast = useToast();
  const [students, setStudents] = useState<Student[]>([]);
  const [status, setStatus] = useState<Map<string, LoginStatus>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const [{ data: s }, { data: st }] = await Promise.all([
      supabase.from("students").select("*").order("student_no"),
      supabase.rpc("teacher_login_status"),
    ]);
    setStudents((s ?? []) as Student[]);
    setStatus(new Map(((st ?? []) as LoginStatus[]).map((x) => [x.student_no, x])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const reset = async (s: Student) => {
    if (!confirm(`${s.name}(${s.student_no}) 비밀번호를 초기화할까요?\n\n학생은 다음에 생년월일 6자리로 로그인해서 새 비밀번호를 정해요. 지금 로그인돼 있는 기기는 바로 로그아웃돼요.`)) return;
    setBusy(s.student_no);
    const r = await callFn("auth", { action: "reset_pin", studentNo: s.student_no });
    setBusy(null);
    if (!r.ok) return toast(r.error ?? "초기화하지 못했어요.", "err");
    toast(`${s.name} 학생 비밀번호를 초기화했어요.`);
    load();
  };
  const unlock = async (s: Student) => {
    const r = await callFn("auth", { action: "unlock", studentNo: s.student_no });
    if (!r.ok) return toast(r.error ?? "실패했어요.", "err");
    toast("잠금을 풀었어요."); load();
  };
  const saveName = async () => {
    if (!editing) return;
    const { error } = await supabase.from("students").update({ name: editing.name.trim() }).eq("id", editing.id);
    if (error) return toast(errMsg(error), "err");
    setEditing(null); load();
  };

  const realStudents = students.filter((s) => s.role === "student");
  const pinCount = realStudents.filter((s) => status.get(s.student_no)?.pin_set).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Section title={`학생 계정 (${realStudents.length}명 · 비밀번호 설정 ${pinCount}명)`}>
        <div className="overflow-x-auto">
          <table className="table min-w-[560px]">
            <thead><tr><th>학번</th><th>이름</th><th>성별</th><th>상태</th><th></th></tr></thead>
            <tbody>
              {students.filter((s) => s.role !== "teacher").map((s) => {
                const st = status.get(s.student_no);
                return (
                  <tr key={s.id}>
                    <td className="text-muted">{s.student_no}</td>
                    <td>
                      {editing?.id === s.id ? (
                        <span className="flex gap-1"><input className="input py-1 text-sm" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /><button className="btn btn-sm" onClick={saveName}>저장</button></span>
                      ) : (
                        <button className="text-left hover:underline" title="이름 고치기" onClick={() => setEditing({ id: s.id, name: s.name })}>{s.name}</button>
                      )}
                      {s.role === "test" && <span className="chip-warn ml-1">테스트</span>}
                    </td>
                    <td>
                      <select className="rounded-lg border border-line bg-white px-1.5 py-1 text-sm" value={s.gender ?? ""} aria-label={`${s.name} 성별`}
                        onChange={async (e) => { const { error } = await supabase.from("students").update({ gender: e.target.value || null }).eq("id", s.id); if (error) toast(errMsg(error), "err"); else load(); }}>
                        <option value="">-</option><option value="M">남</option><option value="F">여</option>
                      </select>
                    </td>
                    <td className="space-x-1 whitespace-nowrap">
                      {st?.pin_set ? <span className="chip">비밀번호 있음</span> : <span className="chip-gray">생년월일로 첫 로그인 대기</span>}
                      {st?.locked && <span className="chip-red">잠김</span>}
                      {st?.last_reset_at && <span className="text-xs text-muted">초기화 {st.last_reset_at.slice(5, 10).replace("-", "/")}</span>}
                    </td>
                    <td className="space-x-1 whitespace-nowrap text-right">
                      {st?.locked && <button className="btn-outline btn-sm" onClick={() => unlock(s)}>잠금 해제</button>}
                      <button className="btn-outline btn-sm" disabled={busy !== null || !st?.pin_set} onClick={() => reset(s)}>{busy === s.student_no ? "초기화 중…" : "비밀번호 초기화"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">성별은 칭찬 릴레이 주인공을 남녀 고르게 뽑는 데만 써요. 이름을 누르면 고칠 수 있어요. 5번 틀리면 5분 잠기고, '잠금 해제'로 바로 풀 수 있어요.</p>
      </Section>
      <div className="space-y-4">
        <Section title="🔑 내 비밀번호 바꾸기"><ChangePin /></Section>
        <Section title="학생 안내 문구">
          <p className="text-sm leading-relaxed text-muted">주소로 들어가서 <b className="text-ink">학번 + 칭찬 릴레이 비밀번호</b>로 로그인해요. 처음이거나 초기화된 학생은 <b className="text-ink">생년월일 6자리</b>로 들어가서 새 비밀번호 4자리를 정해요.</p>
          <p className="mt-2 text-sm text-muted">폰에서 '홈 화면에 추가'를 하면 앱처럼 쓸 수 있어요.</p>
        </Section>
      </div>
    </div>
  );
}

function Export() {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(""); }
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const items = [
    { key: "att", title: "출결 보고 전체", desc: "날짜·학번·이름·종류·구분·사유·시간·나이스 처리", fn: async () => {
      const { data, error } = await supabase.from("attendance_reports").select("*").order("report_date").order("student_no");
      if (error) throw error;
      downloadCsv(`출결_${stamp}.csv`, [["출결일", "학번", "이름", "종류", "구분", "사유", "시간", "나이스 처리", "교사 등록", "제출 시각"],
        ...(data ?? []).map((r) => [r.report_date, r.student_no, r.student_name, r.kind, r.category, r.reason, r.time_note, r.neis_registered ? "O" : "", r.created_by_teacher ? "O" : "", r.created_at])]);
    } },
    { key: "relay", title: "칭찬 릴레이 편지 전체", desc: "날짜·받는 사람·쓴 사람·강점·편지·AI 주의·결과 포함 여부", fn: async () => {
      const [{ data: msgs, error }, { data: st }] = await Promise.all([
        supabase.from("relay_messages").select("*").order("day").order("created_at"),
        supabase.from("students").select("id, student_no, name"),
      ]);
      if (error) throw error;
      const by = new Map((st ?? []).map((s) => [s.id, s]));
      downloadCsv(`칭찬릴레이_${stamp}.csv`, [["날짜", "받는 학번", "받는 사람", "쓴 학번", "쓴 사람", "강점", "편지", "AI 주의", "AI 사유", "결과 포함", "교사 수정"],
        ...(msgs ?? []).map((m) => [m.day, by.get(m.target_student_id)?.student_no, by.get(m.target_student_id)?.name, by.get(m.author_student_id)?.student_no, by.get(m.author_student_id)?.name,
          (m.strengths as string[]).join(" / "), m.body, m.ai_flagged ? "O" : "", m.ai_reason ?? "", m.status === "approved" ? "O" : "제외", m.teacher_edited ? "O" : ""])]);
    } },
    { key: "study", title: "스터디 활동일지 전체", desc: "그룹·작성자·날짜·과목·시간·내용·느낀 점·확정 여부·교사 메모", fn: async () => {
      const [{ data: groups }, { data: logs, error }, { data: notes }, { data: st }] = await Promise.all([
        supabase.rpc("list_study_groups"), supabase.from("study_logs").select("*").order("activity_date"),
        supabase.from("study_log_notes").select("*"), supabase.from("students").select("id, student_no, name"),
      ]);
      if (error) throw error;
      const g = new Map(((groups ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
      const n = new Map((notes ?? []).map((x) => [x.log_id, x.note]));
      const s = new Map((st ?? []).map((x) => [x.id, x]));
      downloadCsv(`스터디일지_${stamp}.csv`, [["그룹", "작성 학번", "작성자", "날짜", "과목", "분", "활동 내용", "느낀 점", "상태", "교사 메모"],
        ...(logs ?? []).map((l) => [g.get(l.group_id), s.get(l.author_id)?.student_no, s.get(l.author_id)?.name, l.activity_date, l.subject, l.minutes, l.content, l.reflection, l.status === "confirmed" ? "확정" : "확인 대기", n.get(l.id) ?? ""])]);
    } },
    { key: "drafts", title: "생기부 초안", desc: "학생별로 저장된 초안", fn: async () => {
      const [{ data: d, error }, { data: st }] = await Promise.all([supabase.from("record_drafts").select("*"), supabase.from("students").select("id, student_no, name").order("student_no")]);
      if (error) throw error;
      const m = new Map((d ?? []).map((x) => [x.student_id, x]));
      downloadCsv(`생기부초안_${stamp}.csv`, [["학번", "이름", "초안", "글자 수", "수정 시각"],
        ...(st ?? []).filter((s) => m.has(s.id)).map((s) => [s.student_no, s.name, m.get(s.id)!.content, m.get(s.id)!.content.length, m.get(s.id)!.updated_at])]);
    } },
  ];
  return (
    <Section title="엑셀·구글시트로 내려받기">
      <p className="mb-4 text-sm text-muted">CSV 파일로 받아요. 엑셀에서 바로 열리고, 구글시트는 '파일 → 가져오기'로 올리면 돼요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.key} className="rounded-xl border border-line bg-white p-4">
            <p className="font-bold">{it.title}</p>
            <p className="mt-1 text-xs text-muted">{it.desc}</p>
            <button className="btn-outline btn-sm mt-3" disabled={!!busy} onClick={() => run(it.key, it.fn)}>{busy === it.key ? "만드는 중…" : "⬇ 내려받기"}</button>
          </div>
        ))}
      </div>
    </Section>
  );
}
