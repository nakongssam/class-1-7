import { useCallback, useEffect, useState } from "react";
import { callFn, supabase } from "../lib/supabase";
import { errMsg } from "../lib/util";
import { Empty, Loading, Section, Tabs, useToast } from "../ui/kit";
import { GroupCard, hm, loadStudy, LogCard, myConfirmedCount, type StudyGroup, type StudyLog } from "../student/Study";

const SUB = ["학생별 현황", "그룹", "활동일지", "생기부 초안"] as const;
type Data = Awaited<ReturnType<typeof loadStudy>>;

export default function StudyTeacher() {
  const toast = useToast();
  const [sub, setSub] = useState<(typeof SUB)[number]>("학생별 현황");
  const [d, setD] = useState<Data | null>(null);
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
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

  const deleteGroup = async (g: StudyGroup) => {
    if (!window.confirm(`'${g.name}' 그룹을 삭제할까요?\n그룹의 활동일지 ${g.log_count}건과 사진도 모두 지워지고 되돌릴 수 없어요.`)) return;
    const { data: paths, error } = await supabase.rpc("teacher_delete_study_group", { _group: g.id });
    if (error) return toast(errMsg(error), "err");
    if ((paths as string[] | null)?.length) await supabase.storage.from("study-photos").remove(paths as string[]);
    toast("그룹을 삭제했어요."); load();
  };
  const giveReward = async (studentId: string, round: number, give: boolean) => {
    const { error } = give
      ? await supabase.from("study_rewards").insert({ student_id: studentId, round })
      : await supabase.from("study_rewards").delete().eq("student_id", studentId).eq("round", round);
    if (error) return toast(errMsg(error), "err");
    load();
  };
  const setTarget = async (n: number) => {
    if (!n || n < 1 || n > 100) return;
    const { error } = await supabase.from("class_settings").update({ study_reward_target: n }).eq("id", 1);
    if (error) return toast(errMsg(error), "err");
    toast(`보상 기준을 일지 ${n}건으로 바꿨어요.`); load();
  };
  const waiting = d.classmates.filter((s) => {
    const r = Math.floor(myConfirmedCount(d.logs, s.id) / d.rewardTarget);
    return Array.from({ length: r }, (_, i) => i + 1).some((x) => !d.rewards.some((w) => w.student_id === s.id && w.round === x));
  });

  return (
    <>
      <Tabs tabs={SUB} value={sub} onChange={setSub} />
      {sub === "학생별 현황" && (
        <Section title="학생별 스터디 현황">
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm">
            <span>🏅 보상 기준: 본인이 쓴 <b>활동일지</b></span>
            <input type="number" min={1} max={100} defaultValue={d.rewardTarget} key={d.rewardTarget} className="input w-20 py-1 text-sm" aria-label="보상 기준 건수"
              onBlur={(e) => Number(e.target.value) !== d.rewardTarget && setTarget(Number(e.target.value))} />
            <span>건마다 1회</span>
            <span className="ml-auto">{waiting.length ? <>지급 대기 <b className="text-brand">{waiting.length}명</b>: {waiting.map((s) => s.name).join(", ")}</> : "지급 대기 없음"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead><tr><th>학번</th><th>이름</th><th>그룹(역할)</th><th>공부 시간</th><th>일지</th><th>최근 활동</th><th>보상</th><th></th></tr></thead>
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
                      <td className="text-xs">{gs.map((g) => { const ms = g.subjects?.filter((x) => x.mentor_id === s.id).map((x) => x.subject) ?? []; return `${g.name}${ms.length ? `(${ms.join("·")} 멘토)` : ""}`; }).join(", ") || <span className="text-muted">없음</span>}</td>
                      <td>{confirmedMin ? hm(confirmedMin) : "-"}</td><td>{logs.length}</td>
                      <td>{last ?? "-"}{warn && " ⚠"}</td>
                      <td className="text-xs">{(() => {
                        const n = myConfirmedCount(d.logs, s.id);
                        const rounds = Math.floor(n / d.rewardTarget);
                        return (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-muted">{n % d.rewardTarget}/{d.rewardTarget}</span>
                            {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => {
                              const given = d.rewards.some((w) => w.student_id === s.id && w.round === r);
                              return given
                                ? <button key={r} className="chip" title="누르면 지급 취소" onClick={() => window.confirm(`${s.name} ${r}회차 보상 지급을 취소할까요?`) && giveReward(s.id, r, false)}>{r}회 ✓</button>
                                : <button key={r} className="btn btn-sm" onClick={() => giveReward(s.id, r, true)}>{r}회 지급</button>;
                            })}
                          </div>
                        );
                      })()}</td>
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
                    editing === g.id ? <GroupEditor key={g.id} g={g} classmates={d.classmates} onDone={(saved) => { setEditing(null); if (saved) load(); }} /> :
                    <GroupCard key={g.id} g={g}>
                      {st === "pending" && <p className="mt-2 text-xs text-muted">{g.members.map((m) => `${m.name}: ${m.status === "accepted" ? "수락" : m.status === "rejected" ? "거절" : "대기"}`).join(" · ")}</p>}
                      <div className="mt-3 flex gap-2">
                        {st === "active" && <button className="btn-outline btn-sm" onClick={() => confirm(`'${g.name}' 그룹을 마감할까요? 새 일지를 쓸 수 없게 돼요.`) && setGroupStatus(g.id, "closed")}>마감</button>}
                        {st === "closed" && <button className="btn-outline btn-sm" onClick={() => setGroupStatus(g.id, "active")}>다시 열기</button>}
                        {st === "pending" && <button className="btn-outline btn-sm" onClick={() => confirm("멤버 수락 없이 바로 시작할까요?") && setGroupStatus(g.id, "active")}>바로 승인</button>}
                        <button className="btn-outline btn-sm ml-auto" onClick={() => setEditing(g.id)}>수정</button>
                        <button className="btn-danger" onClick={() => deleteGroup(g)}>삭제</button>
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
      <Section title="활동 기록" right={
        <select className="input w-48 py-1.5 text-sm" value={id} onChange={(e) => setSelected(e.target.value)} aria-label="학생">{d.classmates.map((s) => <option key={s.id} value={s.id}>{s.student_no} {s.name}</option>)}</select>
      }>
        {!logs.length ? <Empty>이 학생의 그룹 활동 일지가 없어요.</Empty> : (
          <div className="space-y-3">{logs.map((l) => <LogWithNote key={l.id} log={l} d={d} note={notes.get(l.id) ?? ""} onSaved={reload} />)}</div>
        )}
      </Section>
      <Section title="✍️ 생기부 초안" className="h-fit lg:sticky lg:top-32">
        <p className="-mt-1 mb-3 text-xs text-muted">활동일지와 교사 메모를 바탕으로 500자 이내로 써요. 대학명·기관명·가족 정보는 넣지 않아요.</p>
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

function GroupEditor({ g, classmates, onDone }: { g: StudyGroup; classmates: { id: string; name: string; student_no: string }[]; onDone: (saved: boolean) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: g.name, plan: g.plan, schedule: g.schedule, expected: g.expected_result, target: Math.round(g.target_minutes / 60) });
  const [members, setMembers] = useState<string[]>(g.members.filter((m) => m.status !== "rejected").map((m) => m.id));
  const [subjects, setSubjects] = useState(g.subjects?.length ? g.subjects.map((x) => ({ subject: x.subject, mentor: x.mentor_id ?? "" })) : [{ subject: "", mentor: "" }]);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => classmates.find((c) => c.id === id)?.name ?? g.members.find((m) => m.id === id)?.name ?? "";
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!members.length) return toast("멤버를 한 명 이상 골라 주세요.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("teacher_update_study_group", {
      _group: g.id, _name: f.name, _plan: f.plan, _schedule: f.schedule, _expected: f.expected, _target: Math.round(f.target * 60),
      _members: members, _subjects: subjects.filter((x) => x.subject.trim()).map((x) => ({ subject: x.subject.trim(), mentor: members.includes(x.mentor) ? x.mentor : null })),
    });
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    toast("그룹을 수정했어요."); onDone(true);
  };
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border-2 border-brand bg-white p-4 md:col-span-2">
      <div><label className="label">그룹 이름</label><input className="input" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div>
        <p className="label">멤버</p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {classmates.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={members.includes(p.id)} onChange={(e) => setMembers(e.target.checked ? [...members, p.id] : members.filter((x) => x !== p.id))} />{p.name}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="label">과목별 멘토</p>
        <div className="space-y-2">
          {subjects.map((x, i) => (
            <div key={i} className="flex gap-2">
              <input className="input" placeholder="과목" maxLength={30} value={x.subject} onChange={(e) => setSubjects(subjects.map((y, j) => (j === i ? { ...y, subject: e.target.value } : y)))} />
              <select className="input max-w-44" value={members.includes(x.mentor) ? x.mentor : ""} onChange={(e) => setSubjects(subjects.map((y, j) => (j === i ? { ...y, mentor: e.target.value } : y)))} aria-label="멘토">
                <option value="">멘토 없이 함께</option>
                {members.map((id) => <option key={id} value={id}>멘토: {nameOf(id)}</option>)}
              </select>
              <button type="button" className="btn-outline btn-sm" onClick={() => setSubjects(subjects.filter((_, j) => j !== i))} aria-label="과목 빼기">✕</button>
            </div>
          ))}
          <button type="button" className="btn-outline btn-sm" onClick={() => setSubjects([...subjects, { subject: "", mentor: "" }])}>+ 과목 추가</button>
        </div>
      </div>
      {([["plan", "활동 내용"], ["schedule", "활동 시간"], ["expected", "기대되는 결과"]] as const).map(([k, l]) => (
        <div key={k}><label className="label">{l}</label><textarea className="input min-h-16" required maxLength={2000} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
      ))}
      <div><label className="label">목표 공부 시간 (시간)</label><input className="input max-w-32" type="number" min={1} max={1000} value={f.target} onChange={(e) => setF({ ...f, target: Number(e.target.value) })} /></div>
      <p className="text-xs text-muted">멤버에서 빼도 그 학생이 쓴 일지는 지워지지 않아요.</p>
      <div className="flex gap-2"><button className="btn btn-sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button><button type="button" className="btn-outline btn-sm" onClick={() => onDone(false)}>취소</button></div>
    </form>
  );
}
