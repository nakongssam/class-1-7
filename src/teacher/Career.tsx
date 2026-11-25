import { useCallback, useEffect, useState } from "react";
import { CareerView, goalLabel, loadCareer } from "../lib/career";
import { callFn, supabase } from "../lib/supabase";
import { downloadCsv, errMsg } from "../lib/util";
import { Empty, Loading, Section, useToast } from "../ui/kit";
import { Reactions } from "../student/Career";

type Data = Awaited<ReturnType<typeof loadCareer>>;

export default function CareerTeacher() {
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [sel, setSel] = useState("");
  const load = useCallback(async () => {
    try { setD(await loadCareer()); } catch (e) { toast(errMsg(e), "err"); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;

  const people = d.people;
  const card = (id: string) => d.cards.find((c) => c.student_id === id);
  const realPeople = people.filter((p) => !p.is_test);
  const nPub = realPeople.filter((p) => card(p.id)?.published).length;
  const nDraft = realPeople.filter((p) => card(p.id) && !card(p.id)!.published).length;
  const id = sel || people[0]?.id || "";
  const c = card(id);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      <Section title="🎯 진로 카드 현황" right={
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">공개 {nPub} · 작성 중 {nDraft} · 안 씀 {realPeople.length - nPub - nDraft}</span>
          <button className="btn-outline btn-sm" onClick={() => downloadCsv("1-7_진로카드.csv", [["학번", "이름", "구분", "희망", "분야", "시작", "지금", "고2 선택과목", "미래", "공개"],
            ...people.map((p) => { const x = card(p.id); return [p.student_no, p.name, x?.goal_type ?? "", x?.goal ?? "", x?.field ?? "", x?.past ?? "", x?.present ?? "", x?.subjects ?? "", x?.future ?? "", x ? (x.published ? "공개" : "작성 중") : "안 씀"]; })])}>CSV</button>
        </div>}>
        <div className="overflow-x-auto">
          <table className="table min-w-[520px]">
            <thead><tr><th>번호</th><th>이름</th><th>희망 진로·학과</th><th>분야</th><th>상태</th><th>반응</th></tr></thead>
            <tbody>
              {people.map((p) => {
                const x = card(p.id);
                return (
                  <tr key={p.id} onClick={() => setSel(p.id)} className={`cursor-pointer ${p.id === id ? "bg-brand-soft" : "hover:bg-stone-50"}`}>
                    <td className="text-muted">{Number(p.student_no.slice(-2))}</td>
                    <td className="font-semibold">{p.name}{p.is_test && <span className="chip-warn ml-1">테스트</span>}</td>
                    <td>{x ? goalLabel(x) || "-" : <span className="text-muted">-</span>}</td>
                    <td className="text-xs">{x?.field || "-"}</td>
                    <td>{!x ? <span className="chip-gray">안 씀</span> : x.published ? <span className="chip">공개</span> : <span className="chip-warn">작성 중</span>}</td>
                    <td className="text-xs">{d.reactions.filter((r) => r.card_id === p.id).length || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      <div className="space-y-4">
        {!c ? <Section><Empty>{people.find((p) => p.id === id)?.name}은(는) 아직 진로 카드를 쓰지 않았어요.</Empty></Section> : (
          <CareerView c={c} name={people.find((p) => p.id === id)?.name ?? ""}>
            <p className="mt-3 text-xs text-muted">{c.published ? "🌍 반에 공개 중" : "🔒 학생만 보는 중 (선생님은 볼 수 있어요)"}</p>
            {c.published && <Reactions d={d} cardId={c.student_id} />}
          </CareerView>
        )}
        {c && <CareerDraft studentId={id} />}
      </div>
    </div>
  );
}

function CareerDraft({ studentId }: { studentId: string }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from("career_drafts").select("content, note").eq("student_id", studentId).maybeSingle()
      .then(({ data }) => { setText(data?.content ?? ""); setNote(data?.note ?? ""); });
  }, [studentId]);
  const save = async (content = text) => {
    const { error } = await supabase.from("career_drafts").upsert({ student_id: studentId, content, note, updated_at: new Date().toISOString() });
    if (error) return toast(errMsg(error), "err");
    toast("저장했어요.");
  };
  const gen = async () => {
    setBusy(true);
    await supabase.from("career_drafts").upsert({ student_id: studentId, content: text, note, updated_at: new Date().toISOString() });
    const r = await callFn("ai", { action: "career_draft", studentId });
    setBusy(false);
    if (!r.ok) return toast(String(r.error ?? "만들지 못했어요."), "err");
    setText(String(r.content)); toast("초안을 만들었어요. 다듬어서 저장하세요.");
  };
  return (
    <Section title="진로활동 생기부 초안" right={<span className="text-xs text-muted">{text.length}/500자</span>}>
      <input className="input mb-2 text-sm" placeholder="교사 관찰 메모 (초안에 반영, 예: 진로 발표 대신 글로 성실히 작성함)" value={note} onChange={(e) => setNote(e.target.value)} />
      <textarea className="input min-h-48 text-sm leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} placeholder="AI 초안이 여기에 나와요. 직접 써도 돼요." />
      <div className="mt-2 flex gap-2">
        <button className="btn btn-sm" disabled={busy} onClick={gen}>{busy ? "만드는 중…" : "AI 초안 만들기"}</button>
        <button className="btn-outline btn-sm" onClick={() => save()}>저장</button>
        <button className="btn-outline btn-sm" onClick={() => { navigator.clipboard.writeText(text); toast("복사했어요."); }}>복사</button>
      </div>
      <p className="mt-2 text-[11px] text-muted">학생 진로 카드와 교사 메모만 근거로 써요. 대학명·기관명·가족 정보는 넣지 않아요.</p>
    </Section>
  );
}
