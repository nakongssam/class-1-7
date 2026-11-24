import { useCallback, useEffect, useState } from "react";
import type { Me } from "../App";
import { supabase } from "../lib/supabase";
import { errMsg, todayStr } from "../lib/util";
import { Empty, Progress, Section, Tabs, useToast } from "../ui/kit";

export type StudyMember = { id: string; name: string; student_no: string; role: "mentor" | "mentee"; status: string };
export type StudyGroup = {
  id: string; name: string; plan: string; schedule: string; expected_result: string; target_minutes: number; status: string;
  creator_id: string; members: StudyMember[]; total_minutes: number; log_count: number; pending_count: number; created_at: string;
};
export type StudyLog = {
  id: string; group_id: string; author_id: string; activity_date: string; minutes: number; subject: string; content: string;
  reflection: string; status: string; photo_paths: string[]; created_at: string; photos?: string[];
};

export const hm = (m: number) => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;

export async function loadStudy() {
  const [{ data: groups, error }, { data: classmates }, { data: logs }] = await Promise.all([
    supabase.rpc("list_study_groups"),
    supabase.rpc("list_classmates"),
    supabase.from("study_logs").select("*").order("activity_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  if (error) throw error;
  const paths = [...new Set((logs ?? []).flatMap((l) => l.photo_paths as string[]))];
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage.from("study-photos").createSignedUrls(paths, 3600);
    (data ?? []).forEach((p) => p.path && p.signedUrl && urls.set(p.path, p.signedUrl));
  }
  return {
    groups: (groups ?? []) as StudyGroup[],
    classmates: (classmates ?? []) as { id: string; name: string; student_no: string }[],
    logs: ((logs ?? []) as StudyLog[]).map((l) => ({ ...l, photos: l.photo_paths.map((p) => urls.get(p)).filter(Boolean) as string[] })),
  };
}

export function GroupCard({ g, children }: { g: StudyGroup; children?: React.ReactNode }) {
  const pct = Math.min(100, Math.floor((g.total_minutes / g.target_minutes) * 100));
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <h3 className="font-bold">👥 {g.name}</h3>
      <p className="mt-1 text-sm">{g.members?.map((m) => `${m.name}${m.role === "mentor" ? "(멘토)" : ""}`).join(", ")}</p>
      <dl className="mt-3 space-y-2 text-sm">
        {[["활동 내용", g.plan], ["활동 시간", g.schedule], ["기대되는 결과", g.expected_result]].map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-1.5 flex justify-between text-sm"><b className="text-brand">{pct}%</b><span>{hm(g.total_minutes)} / {hm(g.target_minutes)}</span></div>
        <Progress value={pct} />
        <p className="mt-1.5 text-xs text-muted">일지 {g.log_count}건 · 확인 대기 {g.pending_count}건{g.total_minutes >= g.target_minutes && g.pending_count === 0 ? " · 🎉 목표 달성" : ""}</p>
      </div>
      {children}
    </article>
  );
}

export function LogCard({ log, group, action }: { log: StudyLog; group?: StudyGroup; action?: React.ReactNode }) {
  const author = group?.members?.find((m) => m.id === log.author_id);
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm"><b>{log.activity_date}</b><span className="chip-gray">{log.subject}</span>
          <span className={log.status === "confirmed" ? "chip" : "chip-warn"}>{log.status === "confirmed" ? "확정" : "확인 대기"}</span></div>
        <div className="flex gap-2">{action}</div>
      </div>
      <p className="mt-1.5 text-xs text-muted">{group?.name} · {author?.name} 작성 · {hm(log.minutes)}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm">{log.content}</p>
      {log.reflection && <p className="mt-2 whitespace-pre-wrap border-l-2 border-brand pl-3 text-sm text-muted">{log.reflection}</p>}
      {!!log.photos?.length && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {log.photos.map((p, i) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt={`인증 사진 ${i + 1}`} className="aspect-[4/3] w-full rounded-lg object-cover" loading="lazy" /></a>)}
        </div>
      )}
    </article>
  );
}

const SUB = ["내 활동일지", "학급 그룹", "그룹 신청"] as const;

export default function StudyStudent({ me }: { me: Me }) {
  const toast = useToast();
  const [sub, setSub] = useState<(typeof SUB)[number]>("내 활동일지");
  const [d, setD] = useState<Awaited<ReturnType<typeof loadStudy>> | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => loadStudy().then(setD).catch((e) => toast(errMsg(e), "err")), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <p className="py-10 text-center text-sm text-muted">불러오는 중…</p>;

  const myGroups = d.groups.filter((g) => g.status === "active" && g.members?.some((m) => m.id === me.id && m.status === "accepted"));
  const invites = d.groups.filter((g) => g.status === "pending" && g.members?.some((m) => m.id === me.id && m.status === "pending"));
  const myPending = d.groups.filter((g) => g.status !== "active" && g.creator_id === me.id);
  const myLogs = d.logs.filter((l) => myGroups.some((g) => g.id === l.group_id));

  const respond = async (id: string, accept: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc("respond_study_invite", { _group: id, _accept: accept });
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    toast(accept ? "수락했어요. 모두 수락하면 그룹이 만들어져요." : "초대를 거절했어요.");
    load();
  };
  const confirm = async (id: string) => {
    const { error } = await supabase.rpc("confirm_study_log", { _id: id });
    if (error) return toast(errMsg(error), "err");
    toast("활동을 확인했어요."); load();
  };
  const remove = async (log: StudyLog) => {
    if (!window.confirm("이 활동일지를 삭제할까요?")) return;
    const { error } = await supabase.from("study_logs").delete().eq("id", log.id);
    if (error) return toast(errMsg(error), "err");
    if (log.photo_paths.length) await supabase.storage.from("study-photos").remove(log.photo_paths);
    load();
  };

  return (
    <>
      <h1 className="text-xl font-extrabold">📚 스터디그룹</h1>
      {invites.length > 0 && (
        <Section title="받은 그룹 초대" className="border-amber-300">
          <div className="space-y-3">
            {invites.map((g) => (
              <GroupCard key={g.id} g={g}>
                <div className="mt-3 flex gap-2"><button className="btn btn-sm" disabled={busy} onClick={() => respond(g.id, true)}>수락</button><button className="btn-outline btn-sm" disabled={busy} onClick={() => respond(g.id, false)}>거절</button></div>
              </GroupCard>
            ))}
          </div>
        </Section>
      )}
      <Tabs tabs={SUB} value={sub} onChange={setSub} />
      {sub === "내 활동일지" && (
        <>
          <Section title="활동 인증하기"><LogForm groups={myGroups} me={me} onSaved={load} /></Section>
          <Section title={`내 그룹의 활동 (${myLogs.length})`}>
            {!myLogs.length ? <Empty>아직 활동일지가 없어요.</Empty> : (
              <div className="space-y-3">
                {myLogs.map((log) => {
                  const g = d.groups.find((x) => x.id === log.group_id);
                  const canConfirm = log.status === "pending" && log.author_id !== me.id;
                  return <LogCard key={log.id} log={log} group={g} action={<>
                    {canConfirm && <button className="btn btn-sm" onClick={() => confirm(log.id)}>함께 했어요 ✓</button>}
                    {log.author_id === me.id && log.status === "pending" && <button className="btn-danger" onClick={() => remove(log)}>삭제</button>}
                  </>} />;
                })}
              </div>
            )}
            <p className="mt-3 text-xs text-muted">같은 그룹 친구가 쓴 일지는 내가 '함께 했어요'를 눌러야 확정되고 공부 시간에 더해져요.</p>
          </Section>
        </>
      )}
      {sub === "학급 그룹" && (
        <Section title={`결성된 그룹 (${d.groups.filter((g) => g.status === "active").length})`}>
          <div className="grid gap-3 sm:grid-cols-2">{d.groups.filter((g) => g.status === "active").map((g) => <GroupCard key={g.id} g={g} />)}</div>
          {!d.groups.some((g) => g.status === "active") && <Empty>아직 결성된 그룹이 없어요.</Empty>}
        </Section>
      )}
      {sub === "그룹 신청" && (
        <>
          <Section title="스터디그룹 신청서"><Apply me={me} classmates={d.classmates} onSaved={() => { load(); setSub("내 활동일지"); }} /></Section>
          {myPending.length > 0 && (
            <Section title="내 신청 현황">
              <div className="space-y-3">
                {myPending.map((g) => (
                  <GroupCard key={g.id} g={g}>
                    <p className="mt-3 text-sm">{g.status === "rejected" ? "❌ 초대가 거절됐어요. 새로 신청할 수 있어요." : "⏳ 멤버 수락 대기 중"}</p>
                    <p className="text-xs text-muted">{g.members.map((m) => `${m.name}: ${m.status === "accepted" ? "수락" : m.status === "rejected" ? "거절" : "대기"}`).join(" · ")}</p>
                  </GroupCard>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function Apply({ me, classmates, onSaved }: { me: Me; classmates: { id: string; name: string; student_no: string }[]; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", plan: "", schedule: "", expected: "", target: 10, mentor: me.id });
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("create_study_group", {
      _name: f.name, _plan: f.plan, _schedule: f.schedule, _expected: f.expected, _members: members, _mentor: f.mentor, _target: Math.round(f.target * 60),
    });
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    toast("그룹을 신청했어요. 멤버 모두가 수락하면 시작돼요.");
    onSaved();
  };
  const pickable = classmates.filter((p) => p.id !== me.id);
  return (
    <form onSubmit={submit} className="space-y-4">
      <div><label className="label" htmlFor="gn">그룹 이름</label><input id="gn" className="input" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <fieldset>
        <legend className="label">함께할 친구 (나 포함 {members.length + 1}명)</legend>
        <div className="grid max-h-60 grid-cols-2 gap-1.5 overflow-auto rounded-xl border border-line bg-white p-3 sm:grid-cols-3">
          {pickable.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={members.includes(p.id)} onChange={(e) => {
                const next = e.target.checked ? [...members, p.id] : members.filter((x) => x !== p.id);
                setMembers(next);
                if (!next.includes(f.mentor) && f.mentor !== me.id) setF({ ...f, mentor: me.id });
              }} />{p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div><label className="label" htmlFor="mt">멘토</label>
        <select id="mt" className="input" value={f.mentor} onChange={(e) => setF({ ...f, mentor: e.target.value })}>
          {classmates.filter((p) => p.id === me.id || members.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me.id ? " (나)" : ""}</option>)}
        </select></div>
      {([["plan", "활동 내용", "예: 한국사 통사 공부"], ["schedule", "활동 시간", "예: 화·목 점심시간 30분씩"], ["expected", "기대되는 결과", "예: 시험 점수 10점 이상 올리기"]] as const).map(([k, l, ph]) => (
        <div key={k}><label className="label">{l}</label><textarea className="input min-h-20" required maxLength={2000} placeholder={ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
      ))}
      <div><label className="label" htmlFor="tg">목표 공부 시간 (시간)</label><input id="tg" className="input max-w-32" type="number" min={1} max={1000} value={f.target} onChange={(e) => setF({ ...f, target: Number(e.target.value) })} /></div>
      <button className="btn w-full" disabled={busy || !members.length}>{busy ? "신청 중…" : "그룹 신청"}</button>
    </form>
  );
}

function LogForm({ groups, me, onSaved }: { groups: StudyGroup[]; me: Me; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ group: "", date: todayStr(), minutes: 30, subject: "", content: "", reflection: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const groupId = groups.some((g) => g.id === f.group) ? f.group : groups[0]?.id ?? "";
  if (!groups.length) return <Empty>결성된 그룹이 있어야 일지를 쓸 수 있어요. '그룹 신청'에서 시작해 보세요.</Empty>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const paths: string[] = [];
    try {
      for (const file of files) {
        const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
        const path = `${groupId}/${me.id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("study-photos").upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        paths.push(path);
      }
      const { error } = await supabase.from("study_logs").insert({
        group_id: groupId, author_id: me.id, activity_date: f.date, minutes: f.minutes, subject: f.subject.trim(),
        content: f.content.trim(), reflection: f.reflection.trim(), photo_paths: paths,
      });
      if (error) throw error;
      toast("활동일지를 저장했어요. 그룹 친구가 확인하면 확정돼요.");
      setF({ ...f, subject: "", content: "", reflection: "" }); setFiles([]); setFileKey((k) => k + 1);
      onSaved();
    } catch (err) {
      if (paths.length) await supabase.storage.from("study-photos").remove(paths);
      toast(errMsg(err, "저장하지 못했어요."), "err");
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <select className="input" value={groupId} onChange={(e) => setF({ ...f, group: e.target.value })} aria-label="활동 그룹">{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">날짜</label><input type="date" required className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><label className="label">공부 시간 (분)</label><input type="number" required min={1} max={1440} className="input" value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} /></div>
      </div>
      <div><label className="label">과목</label><input className="input" required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
      <div><label className="label">활동 내용</label><textarea className="input min-h-24" required value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></div>
      <div><label className="label">느낀 점</label><textarea className="input min-h-20" value={f.reflection} onChange={(e) => setF({ ...f, reflection: e.target.value })} /></div>
      <div><label className="label">📷 인증 사진 (선택)</label>
        <input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp" multiple className="block w-full text-sm"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            if (chosen.some((x) => x.size > 10 * 1024 * 1024)) { toast("사진은 한 장에 10MB 이내로 올려 주세요.", "err"); e.target.value = ""; return setFiles([]); }
            setFiles(chosen);
          }} />
      </div>
      <button className="btn w-full" disabled={busy || !groupId}>{busy ? "저장 중…" : "활동일지 저장"}</button>
    </form>
  );
}
