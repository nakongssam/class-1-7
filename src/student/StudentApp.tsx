import { useEffect, useState } from "react";
import type { Me } from "../App";
import { ChangePin, signOut } from "../App";
import { supabase } from "../lib/supabase";
import { formatDay, weekStart } from "../lib/util";
import AttendanceStudent from "./Attendance";
import RelayStudent from "./Relay";
import StudyStudent from "./Study";

const TABS = [
  { id: "home", label: "홈", icon: "🏠" },
  { id: "attendance", label: "출결", icon: "🌱" },
  { id: "relay", label: "칭찬", icon: "💌" },
  { id: "study", label: "스터디", icon: "📚" },
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
      </main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="메뉴">
        <div className="mx-auto grid max-w-2xl grid-cols-4">
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
  const [toConfirm, setToConfirm] = useState(0);
  const [monthCheck, setMonthCheck] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);

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
      const active = gs.filter((g) => g.status === "active" && g.members?.some((m) => m.id === me.id && m.status === "accepted")).map((g) => g.id);
      if (active.length) {
        const { count } = await supabase.from("study_logs").select("id", { count: "exact", head: true }).in("group_id", active).eq("status", "pending").neq("author_id", me.id);
        setToConfirm(count ?? 0);
      }
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
          <p className="text-xs text-muted">{invites ? `초대 ${invites}건` : toConfirm ? `확인할 일지 ${toConfirm}건` : "활동 일지 쓰기"}</p>
          {(invites > 0 || toConfirm > 0) && <span className="absolute right-4 top-4 size-2.5 rounded-full bg-rose" />}
        </button>
      </div>

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
