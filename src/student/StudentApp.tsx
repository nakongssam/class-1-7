import { useEffect, useState } from "react";
import type { Me } from "../App";
import { ChangePin, signOut } from "../App";
import { supabase } from "../lib/supabase";
import { formatDay, weekStart } from "../lib/util";
import AttendanceStudent from "./Attendance";
import RelayStudent from "./Relay";
import StudyStudent from "./Study";
import CleanStudent, { RatingButtons } from "./Clean";
import CareerStudent from "./Career";
import { roleLabel, type CleanSlot } from "../lib/clean";
import { DutyBoard, dutyItems, type DutyRow } from "../lib/duties";

const TABS = [
  { id: "home", label: "홈", icon: "🏠" },
  { id: "attendance", label: "출결", icon: "🌱" },
  { id: "relay", label: "칭찬", icon: "💌" },
  { id: "study", label: "스터디", icon: "📚" },
  { id: "clean", label: "청소", icon: "🧹" },
  { id: "career", label: "진로", icon: "🎯" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function useHashTab(): [TabId, (t: TabId) => void] {
  const read = () => (TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "home") as TabId;
  const [tab, setTab] = useState<TabId>(read);
  useEffect(() => {
    const on = () => setTab(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return [tab, (t) => { location.hash = t; setTab(t); scrollTo(0, 0); }];
}

export default function StudentApp({ me }: { me: Me }) {
  const [tab, setTab] = useHashTab();
  return (
    <div className="min-h-dvh pb-24">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <button onClick={() => setTab("home")} className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-xs font-extrabold text-white">1-7</span>
            <span className="font-bold">{me.name}</span>
            {me.role === "test" && <span className="chip-warn">테스트</span>}
          </button>
          <button className="text-sm text-muted underline-offset-2 hover:underline" onClick={signOut}>로그아웃</button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-5 py-5">
        {tab === "home" && <Home me={me} go={setTab} />}
        {tab === "attendance" && <AttendanceStudent me={me} />}
        {tab === "relay" && <RelayStudent me={me} />}
        {tab === "study" && <StudyStudent me={me} />}
        {tab === "clean" && <CleanStudent me={me} />}
        {tab === "career" && <CareerStudent me={me} />}
      </main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="메뉴">
        <div className="mx-auto grid max-w-2xl grid-cols-6">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold ${tab === t.id ? "text-brand" : "text-muted"}`}>
              <span className="text-xl leading-none">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Home({ me, go }: { me: Me; go: (t: TabId) => void }) {
  const [hero, setHero] = useState<{ names: string[]; left: number } | null | undefined>(undefined);
  const [invites, setInvites] = useState(0);
  const [monthCheck, setMonthCheck] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [duty, setDuty] = useState<{ duty: string; service1: string; service2: string; hours: number } | null>(null);
  const [allDuties, setAllDuties] = useState<DutyRow[] | null>(null);
  const [showDuties, setShowDuties] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const [dutyChecks, setDutyChecks] = useState<Map<string, string>>(new Map());
  const rateDuty = async (key: string, rating: string) => {
    const { error } = await supabase.from("duty_checks").upsert({ student_id: me.id, item_key: key, rating, checked_at: new Date().toISOString() });
    if (error) return;
    setDutyChecks(new Map(dutyChecks).set(key, rating));
  };
  const [nextClean, setNextClean] = useState<CleanSlot | null>(null);
  useEffect(() => {
    supabase.from("class_duties").select("duty, service1, service2, hours").eq("student_id", me.id).maybeSingle().then(({ data }) => setDuty(data));
    supabase.from("duty_checks").select("item_key, rating").eq("student_id", me.id).then(({ data }) => setDutyChecks(new Map((data ?? []).map((x) => [x.item_key, x.rating]))));
    supabase.from("clean_slots").select("*").eq("student_id", me.id).gte("day", me.today).order("day").limit(1).then(({ data }) => setNextClean(((data ?? []) as CleanSlot[])[0] ?? null));
  }, [me.id, me.today]);
  const openDuties = async () => {
    setShowDuties((v) => !v);
    if (!allDuties) { const { data } = await supabase.rpc("list_class_duties"); setAllDuties(data ?? []); }
  };
  const [clean, setClean] = useState<{ today: (CleanSlot & { name: string })[]; mine: CleanSlot | null } | null>(null);
  const loadClean = async () => {
    const [{ data: slots }, { data: roster }, { data: pending }] = await Promise.all([
      supabase.from("clean_slots").select("*").eq("day", me.today),
      supabase.rpc("clean_roster"),
      supabase.from("clean_slots").select("*").eq("student_id", me.id).lte("day", me.today).is("done_at", null).order("day").limit(1),
    ]);
    const names = new Map(((roster ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
    setClean({ today: ((slots ?? []) as CleanSlot[]).map((s) => ({ ...s, name: names.get(s.student_id) ?? "" })), mine: ((pending ?? []) as CleanSlot[])[0] ?? null });
  };
  useEffect(() => { loadClean(); }, [me.id, me.today]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      await supabase.rpc("relay_auto_publish_today");
      const ws = weekStart(me.today);
      const [{ data: acts }, { data: mine }] = await Promise.all([
        supabase.from("relay_hero_activities").select("day, student_id, students(name)").gte("day", ws).lte("day", me.today),
        supabase.from("relay_messages").select("day, target_student_id").eq("author_student_id", me.id).gte("day", ws),
      ]);
      const list = (acts ?? []) as unknown as { day: string; student_id: string; students: { name: string } | null }[];
      setHero(list.length ? { names: list.map((a) => a.students?.name ?? ""), left: list.filter((a) => !(mine ?? []).some((m) => m.day === a.day && m.target_student_id === a.student_id)).length } : null);
      const { data: groups } = await supabase.rpc("list_study_groups");
      const gs = (groups ?? []) as { id: string; status: string; members: { id: string; status: string }[] }[];
      setInvites(gs.filter((g) => g.status === "pending" && g.members?.some((m) => m.id === me.id && m.status === "pending")).length);
      const [{ data: checks }, { data: done }] = await Promise.all([
        supabase.from("attendance_month_checks").select("month").order("month"),
        supabase.from("attendance_month_confirmations").select("month").eq("student_no", me.student_no),
      ]);
      const doneSet = new Set((done ?? []).map((d) => d.month));
      setMonthCheck((checks ?? []).find((c) => !doneSet.has(c.month))?.month ?? null);
    })();
  }, [me.id, me.today, me.student_no]);

  return (
    <>
      <div className="pt-1">
        <p className="text-sm text-muted">{formatDay(me.today)}</p>
        <h1 className="mt-0.5 text-2xl font-extrabold">안녕, {me.name}!</h1>
      </div>

      {monthCheck && (
        <button onClick={() => go("attendance")} className="card w-full border-amber-300 bg-amber-50 text-left">
          <p className="font-bold">📋 출결 기록 확인 요청</p>
          <p className="mt-1 text-sm text-muted">선생님이 이번 달 내 출결 기록을 확인해 달래요. 눌러서 확인하기</p>
        </button>
      )}

      <button onClick={() => go("relay")} className="card w-full text-left">
        <p className="text-sm text-muted">💌 이번 주 칭찬 주인공</p>
        {hero === undefined ? <p className="mt-2 text-muted">…</p> : hero ? (
          <div className="mt-1">
            <p className="text-xl font-extrabold text-brand">{hero.names.join(" · ")}</p>
            <span className={hero.left ? "chip-warn mt-2" : "chip mt-2"}>{hero.left ? `아직 ${hero.left}명에게 안 썼어요 →` : "모두 보냈어요 💛"}</span>
          </div>
        ) : <p className="mt-1 font-semibold">평일에 공개돼요</p>}
      </button>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => go("attendance")} className="card text-left">
          <p className="text-2xl">🌱</p>
          <p className="mt-2 font-bold">출결 보고</p>
          <p className="text-xs text-muted">지각·조퇴·결과·결석</p>
        </button>
        <button onClick={() => go("study")} className="card relative text-left">
          <p className="text-2xl">📚</p>
          <p className="mt-2 font-bold">스터디그룹</p>
          <p className="text-xs text-muted">{invites ? `초대 ${invites}건` : "활동 일지 쓰기"}</p>
          {invites > 0 && <span className="absolute right-4 top-4 size-2.5 rounded-full bg-rose" />}
        </button>
      </div>

      <section className="card">
        <p className="text-sm text-muted">🙋 내 역할</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="text-xl font-extrabold text-brand">{duty?.duty || "1인 1역 없음"}</p>
        {nextClean && (
          <p className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${nextClean.day === me.today ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-700"}`}>
            🧹 {nextClean.day === me.today ? "오늘 청소 당번" : `${formatDay(nextClean.day)} 청소 당번`} · {roleLabel(nextClean.role)}{nextClean.done_at ? " ✓" : ""}
          </p>
        )}
        </div>
        {showChecks && duty && dutyItems(duty).length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-xs text-muted">항목마다 얼마나 열심히 했는지 스스로 체크해요. (다시 누르면 바꿀 수 있어요)</p>
            <ul className="space-y-2">
              {dutyItems(duty).map((it) => (
                <li key={it.key} className="flex flex-wrap items-center gap-2">
                  <span className="chip-gray">{it.kind}</span>
                  <span className="text-sm">{it.label}</span>
                  <span className="ml-auto flex gap-1">
                    {(["상", "중", "하"] as const).map((r) => (
                      <button key={r} onClick={() => rateDuty(it.key, r)} className={dutyChecks.get(it.key) === r ? "btn btn-sm" : "btn-outline btn-sm"}>{r}</button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {duty && dutyItems(duty).length > 0 && (() => {
            const items = dutyItems(duty); const n = items.filter((it) => dutyChecks.has(it.key)).length;
            return <button className={n < items.length && !showChecks ? "btn btn-sm" : "btn-outline btn-sm"} onClick={() => setShowChecks((v) => !v)}>{showChecks ? "체크 닫기" : `역할 자기 체크 ${n}/${items.length}`}</button>;
          })()}
          <button className="btn-outline btn-sm" onClick={openDuties}>{showDuties ? "전체 닫기" : "우리 반 1인 1역 보기"}</button>
        </div>
        {showDuties && <div className="mt-4"><DutyBoard rows={allDuties ?? []} showHours={false} highlight={me.name} /></div>}
      </section>

      {clean?.mine && (
        <section className="card border-amber-300 bg-amber-50">
          <p className="font-bold">🧹 {clean.mine.day === me.today ? "오늘 청소 당번이에요" : "체크 안 한 청소가 있어요"} · {roleLabel(clean.mine.role)}</p>
          <p className="mb-2 mt-0.5 text-xs text-muted">청소를 다 했으면 열심히 한 정도를 눌러 체크해요.</p>
          <RatingButtons slot={clean.mine} onDone={loadClean} />
        </section>
      )}
      <button onClick={() => go("clean")} className="card w-full text-left">
        <p className="text-sm text-muted">🧹 오늘 청소</p>
        {clean?.today.length ? (
          <p className="mt-1 text-sm leading-relaxed">{["front_back", "col1", "col2", "col3", "col4"].map((r) => clean.today.find((s) => s.role === r)).filter(Boolean).map((s) => <span key={s!.role} className="mr-2 inline-block"><span className="text-muted">{roleLabel(s!.role)}</span> <b>{s!.name}</b>{s!.done_at ? " ✓" : ""}</span>)}</p>
        ) : <p className="mt-1 font-semibold">오늘은 당번이 없어요 · 달력 보기 →</p>}
      </button>


      <section className="card">
        <button className="flex w-full items-center justify-between text-left" onClick={() => setShowPin((v) => !v)}>
          <span className="font-bold">🔑 비밀번호 바꾸기</span><span className="text-muted">{showPin ? "닫기" : "열기"}</span>
        </button>
        {showPin && <div className="mt-4"><ChangePin onDone={() => setShowPin(false)} /></div>}
        <p className="mt-3 text-xs text-muted">비밀번호를 잊었으면 선생님께 초기화를 부탁하세요. 초기화하면 생년월일로 들어와서 새로 정해요.</p>
      </section>
    </>
  );
}
