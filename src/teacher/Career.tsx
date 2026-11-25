import { useCallback, useEffect, useState } from "react";
import { CareerView, goalLabel, loadCareer } from "../lib/career";
import { callFn, supabase } from "../lib/supabase";
import { downloadCsv, errMsg } from "../lib/util";
import { Empty, Loading, Section, Tabs, useToast } from "../ui/kit";
import { Reactions } from "../student/Career";

type Data = Awaited<ReturnType<typeof loadCareer>>;

export default function CareerTeacher() {
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [sel, setSel] = useState("");
  const [view, setView] = useState<"현황" | "갤러리 미리보기">("현황");
  const load = useCallback(async () => {
    try { setD(await loadCareer()); } catch (e) { toast(errMsg(e), "err"); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;

  const people = d.people;
  const card = (id: string) => d.cards.find((c) => c.student_id === id);
  const realPeople = people.filter((p) => !p.is_test);
  const nDone = realPeople.filter((p) => card(p.id)).length;
  const toggleOpen = async () => {
    if (!window.confirm(d.open ? "진로 갤러리를 닫을까요? 학생들은 자기 카드만 보게 돼요." : `작성한 학생 ${nDone}명의 진로 카드를 반 전체에 공개할까요?\n(숨김으로 둔 카드는 빼고 공개돼요)`)) return;
    const { error } = await supabase.from("class_settings").update({ career_open: !d.open }).eq("id", 1);
    if (error) return toast(errMsg(error), "err");
    toast(d.open ? "갤러리를 닫았어요." : "반 전체에 공개했어요! 🎉"); load();
  };
  const toggleHidden = async (id: string, hidden: boolean) => {
    const { error } = await supabase.from("career_cards").update({ hidden }).eq("student_id", id);
    if (error) return toast(errMsg(error), "err");
    load();
  };
  const id = sel || people[0]?.id || "";
  const c = card(id);

  const gallery = d.cards.filter((x) => !x.hidden);
  return (
    <>
    <Tabs tabs={["현황", "갤러리 미리보기"] as const} value={view} onChange={setView} />
    {view === "갤러리 미리보기" ? (
      <div className="space-y-3">
        <p className="text-sm text-muted">{d.open ? "🌍 지금 학생들에게 이렇게 보여요." : "🔒 아직 비공개예요. [반 전체 공개]를 누르면 학생들에게 이렇게 보여요."} 숨긴 카드는 빠져요.</p>
        {!gallery.length ? <Section><Empty>작성된 카드가 없어요.</Empty></Section> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {gallery.map((x) => <CareerView key={x.student_id} c={x} name={people.find((p) => p.id === x.student_id)?.name ?? ""}><Reactions d={d} cardId={x.student_id} /></CareerView>)}
          </div>
        )}
      </div>
    ) : (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      <Section title="🎯 진로 카드 현황" right={
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">작성 {nDone} · 안 씀 {realPeople.length - nDone}</span>
          <button className={d.open ? "btn-outline btn-sm" : "btn btn-sm"} onClick={toggleOpen}>{d.open ? "🌍 공개 중 · 닫기" : "🔒 반 전체 공개"}</button>
          <button className="btn-outline btn-sm" onClick={() => downloadCsv("1-7_진로카드.csv", [["학번", "이름", "구분", "희망", "분야", "시작", "지금", "미래", "공개"],
            ...people.map((p) => { const x = card(p.id); return [p.student_no, p.name, x?.goal_type ?? "", x?.goal ?? "", x?.field ?? "", x?.past ?? "", x?.present ?? "", x?.future ?? "", x ? (x.hidden ? "숨김" : "작성") : "안 씀"]; })])}>CSV</button>
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
                    <td onClick={(e) => e.stopPropagation()}>{!x ? <span className="chip-gray">안 씀</span> : (
                      <span className="flex items-center gap-1.5">
                        <span className={x.hidden ? "chip-red" : "chip"}>{x.hidden ? "숨김" : "작성"}</span>
                        <button className="text-[11px] text-muted underline" onClick={() => toggleHidden(p.id, !x.hidden)}>{x.hidden ? "보이기" : "숨기기"}</button>
                      </span>
                    )}</td>
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
            <p className="mt-3 text-xs text-muted">{c.hidden ? "🙈 숨김: 반 친구들에게 안 보여요" : d.open ? "🌍 반에 공개 중" : "🔒 아직 비공개 (반 전체 공개를 누르면 보여요)"}</p>
            {d.open && !c.hidden && <Reactions d={d} cardId={c.student_id} />}
          </CareerView>
        )}
        {c && <CareerDraft studentId={id} />}
      </div>
    </div>
    )}
    </>
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
