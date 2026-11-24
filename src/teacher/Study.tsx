import { useCallback, useEffect, useState } from "react";
import { callFn, supabase } from "../lib/supabase";
import { errMsg } from "../lib/util";
import { Empty, Loading, Section, Tabs, useToast } from "../ui/kit";
import { GroupCard, hm, loadStudy, LogCard, type StudyLog } from "../student/Study";

const SUB = ["학생별 현황", "그룹", "활동일지", "생기부 초안"] as const;
type Data = Awaited<ReturnType<typeof loadStudy>>;

export default function StudyTeacher() {
  const toast = useToast();
  const [sub, setSub] = useState<(typeof SUB)[number]>("학생별 현황");
  const [d, setD] = useState<Data | null>(null);
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState("");
  const load = useCallback(async () => {
    try {
      const [data, { data: n }] = await Promise.all([loadStudy(), supabase.from("study_log_notes").select("log_id, note")]);
      setD(data); setNotes(new Map((n ?? []).map((x) => [x.log_id, x.note])));
    } catch (e) { toast(errMsg(e), "err"); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;

  const groupsOf = (id: string) => d.groups.filter((g) => g.status === "active" && g.members?.some((m) => m.id === id && m.status === "accepted"));
  const logsOf = (id: string) => { const gs = new Set(groupsOf(id).map((g) => g.id)); return d.logs.filter((l) => gs.has(l.group_id)); };
  const twoWeeksAgo = (() => { const x = new Date(); x.setDate(x.getDate() - 14); return x.toISOString().slice(0, 10); })();

  const setGroupStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("study_groups").update({ status }).eq("id", id);
    if (error) return toast(errMsg(error), "err");
    toast("바꿨어요."); load();
  };

  return (
    <>
      <Tabs tabs={SUB} value={sub} onChange={setSub} />
      {sub === "학생별 현황" && (
        <Section title="학생별 스터디 현황">
          <div className="overflow-x-auto">
            <table className="table min-w-[640px]">
              <thead><tr><th>학번</th><th>이름</th><th>그룹(역할)</th><th>확정 시간</th><th>일지</th><th>최근 활동</th><th></th></tr></thead>
              <tbody>
                {d.classmates.map((s) => {
                  const gs = groupsOf(s.id);
                  const logs = logsOf(s.id);
                  const confirmedMin = logs.filter((l) => l.status === "confirmed").reduce((a, l) => a + l.minutes, 0);
                  const last = logs[0]?.activity_date;
                  const warn = gs.length > 0 && (!last || last < twoWeeksAgo);
                  return (
                    <tr key={s.id} className={warn ? "bg-rose-50/60" : ""}>
                      <td className="text-muted">{s.student_no}</td><td>{s.name}</td>
                      <td className="text-xs">{gs.map((g) => `${g.name}(${g.members.find((m) => m.id === s.id)?.role === "mentor" ? "멘토" : "멘티"})`).join(", ") || <span className="text-muted">없음</span>}</td>
                      <td>{confirmedMin ? hm(confirmedMin) : "-"}</td><td>{logs.length}</td>
                      <td>{last ?? "-"}{warn && " ⚠"}</td>
                      <td><button className="btn-outline btn-sm" onClick={() => { setSelected(s.id); setSub("생기부 초안"); }}>기록·초안</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">⚠ 그룹이 있는데 2주 넘게 활동 기록이 없는 학생</p>
        </Section>
      )}
      {sub === "그룹" && (
        <div className="space-y-4">
          {(["active", "pending", "closed", "rejected"] as const).map((st) => {
            const gs = d.groups.filter((g) => g.status === st);
            if (!gs.length) return null;
            return (
              <Section key={st} title={`${{ active: "활동 중", pending: "수락 대기", closed: "마감", rejected: "거절됨" }[st]} (${gs.length})`}>
                <div className="grid gap-3 md:grid-cols-2">
                  {gs.map((g) => (
                    <GroupCard key={g.id} g={g}>
                      {st === "pending" && <p className="mt-2 text-xs text-muted">{g.members.map((m) => `${m.name}: ${m.status === "accepted" ? "수락" : m.status === "rejected" ? "거절" : "대기"}`).join(" · ")}</p>}
                      <div className="mt-3 flex gap-2">
                        {st === "active" && <button className="btn-outline btn-sm" onClick={() => confirm(`'${g.name}' 그룹을 마감할까요? 새 일지를 쓸 수 없게 돼요.`) && setGroupStatus(g.id, "closed")}>마감</button>}
                        {st === "closed" && <button className="btn-outline btn-sm" onClick={() => setGroupStatus(g.id, "active")}>다시 열기</button>}
                        {st === "pending" && <button className="btn-outline btn-sm" onClick={() => confirm("멤버 수락 없이 바로 시작할까요?") && setGroupStatus(g.id, "active")}>바로 승인</button>}
                      </div>
                    </GroupCard>
                  ))}
                </div>
              </Section>
            );
          })}
          {!d.groups.length && <Section><Empty>아직 신청된 그룹이 없어요.</Empty></Section>}
        </div>
      )}
      {sub === "활동일지" && (
        <Section title={`전체 활동일지 (${d.logs.length})`}>
          {!d.logs.length ? <Empty>제출된 일지가 없어요.</Empty> : (
            <div className="space-y-3">{d.logs.map((l) => <LogWithNote key={l.id} log={l} d={d} note={notes.get(l.id) ?? ""} onSaved={load} />)}</div>
          )}
        </Section>
      )}
      {sub === "생기부 초안" && <Drafts d={d} notes={notes} selected={selected} setSelected={setSelected} logsOf={logsOf} reload={load} />}
    </>
  );
}

function LogWithNote({ log, d, note, onSaved }: { log: StudyLog; d: Data; note: string; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(note);
  useEffect(() => setV(note), [note]);
  const save = async () => {
    const { error } = await supabase.from("study_log_notes").upsert({ log_id: log.id, note: v, updated_at: new Date().toISOString() });
    if (error) return toast(errMsg(error), "err");
    toast("메모를 저장했어요."); onSaved();
  };
  const del = async () => {
    if (!confirm("이 일지를 삭제할까요?")) return;
    const { error } = await supabase.from("study_logs").delete().eq("id", log.id);
    if (error) return toast(errMsg(error), "err");
    if (log.photo_paths.length) await supabase.storage.from("study-photos").remove(log.photo_paths);
    onSaved();
  };
  return (
    <div>
      <LogCard log={log} group={d.groups.find((g) => g.id === log.group_id)} action={<button className="btn-danger" onClick={del}>삭제</button>} />
      <div className="mt-1 flex gap-2 px-1">
        <input className="input py-1.5 text-sm" placeholder="교사 관찰 메모 (생기부 초안에 반영)" value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn-outline btn-sm" disabled={v === note} onClick={save}>저장</button>
      </div>
    </div>
  );
}

function Drafts({ d, notes, selected, setSelected, logsOf, reload }: {
  d: Data; notes: Map<string, string>; selected: string; setSelected: (s: string) => void; logsOf: (id: string) => StudyLog[]; reload: () => void;
}) {
  const toast = useToast();
  const id = selected || d.classmates[0]?.id || "";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id) return;
    supabase.from("record_drafts").select("content").eq("student_id", id).maybeSingle().then(({ data }) => setText(data?.content ?? ""));
  }, [id]);
  const logs = logsOf(id);
  const gen = async () => {
    setBusy(true);
    const r = await callFn("ai", { action: "record_draft", studentId: id });
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "생성하지 못했어요.", "err");
    setText(String(r.content)); toast("초안을 만들었어요. 다듬어서 저장하세요.");
  };
  const save = async () => {
    const { error } = await supabase.from("record_drafts").upsert({ student_id: id, content: text, updated_at: new Date().toISOString() });
    if (error) return toast(errMsg(error), "err");
    toast("저장했어요.");
  };
  if (!id) return <Section><Empty>학생이 없어요.</Empty></Section>;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Section title="확정된 활동 기록" right={
        <select className="input w-48 py-1.5 text-sm" value={id} onChange={(e) => setSelected(e.target.value)} aria-label="학생">{d.classmates.map((s) => <option key={s.id} value={s.id}>{s.student_no} {s.name}</option>)}</select>
      }>
        {!logs.length ? <Empty>이 학생의 그룹 활동 일지가 없어요.</Empty> : (
          <div className="space-y-3">{logs.map((l) => <LogWithNote key={l.id} log={l} d={d} note={notes.get(l.id) ?? ""} onSaved={reload} />)}</div>
        )}
      </Section>
      <Section title="✍️ 생기부 초안" className="h-fit lg:sticky lg:top-32">
        <p className="-mt-1 mb-3 text-xs text-muted">확정된 일지와 교사 메모를 바탕으로 500자 이내로 써요. 대학명·기관명·가족 정보는 넣지 않아요.</p>
        <button className="btn w-full" disabled={busy} onClick={gen}>{busy ? "만드는 중…" : "AI로 초안 만들기"}</button>
        <textarea className="input mt-3 min-h-72 text-sm leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} placeholder="초안이 여기에 나와요. 직접 써도 돼요." />
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className={text.length > 500 ? "font-bold text-rose" : "text-muted"}>{text.length} / 500자</span>
          <span className="flex gap-1.5">
            <button className="btn-outline btn-sm" disabled={!text} onClick={save}>저장</button>
            <button className="btn-outline btn-sm" disabled={!text} onClick={() => navigator.clipboard.writeText(text).then(() => toast("복사했어요."))}>복사</button>
          </span>
        </div>
      </Section>
    </div>
  );
}
