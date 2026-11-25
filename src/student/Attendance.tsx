import { useCallback, useEffect, useMemo, useState } from "react";
import type { Me } from "../App";
import { supabase } from "../lib/supabase";
import { errMsg, monthLabel, toDateString, todayStr } from "../lib/util";
import {
  buildBadges, calcStreak, CATEGORIES, CATEGORY_HELP, KIND_DOT, KIND_EMOJI, KIND_HINT, KINDS, plantStage, PLANT_STAGES,
  POT_OPTIONS, PROP_OPTIONS, type Category, type Kind, type Report,
} from "../lib/attendance";
import { Empty, Section, Tabs, useToast } from "../ui/kit";

const SUB = ["보고하기", "내 기록", "내 정원"] as const;

export default function AttendanceStudent({ me }: { me: Me }) {
  const [sub, setSub] = useState<(typeof SUB)[number]>("보고하기");
  const [reports, setReports] = useState<Report[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ month: string; confirmed: boolean }[]>([]);
  const toast = useToast();

  const load = useCallback(async () => {
    const [{ data: rows }, { data: meta }, { data: mc }, { data: done }] = await Promise.all([
      supabase.from("attendance_reports").select("*").eq("student_no", me.student_no).order("report_date", { ascending: false }),
      supabase.rpc("attendance_meta"),
      supabase.from("attendance_month_checks").select("month").order("month"),
      supabase.from("attendance_month_confirmations").select("month").eq("student_no", me.student_no),
    ]);
    setReports((rows ?? []) as Report[]);
    setStartDate((meta as { start_date: string | null }[] | null)?.[0]?.start_date ?? null);
    const d = new Set((done ?? []).map((x) => x.month));
    setChecks((mc ?? []).map((c) => ({ month: c.month, confirmed: d.has(c.month) })));
  }, [me.student_no]);
  useEffect(() => { load(); }, [load]);

  const pending = checks.filter((c) => !c.confirmed);
  const confirm = async (month: string) => {
    const { error } = await supabase.from("attendance_month_confirmations").insert({ month, student_no: me.student_no });
    if (error) return toast(errMsg(error), "err");
    toast(`${monthLabel(month)} 기록을 확인했어요.`);
    load();
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-ink pb-4 pt-1">
        <div><span className="bubble text-xs">지각·조퇴·결과·결석 보고</span><h1 className="mt-2 text-[34px] leading-none">출결</h1></div>
        <span className="ill size-16 bg-sky"><i className="ti ti-calendar-check text-4xl" aria-hidden="true" /></span>
      </div>
      {pending.map((c) => (
        <Section key={c.month} title={`📋 ${monthLabel(c.month)} 출결 확인`} className="border-amber-300 bg-amber-50">
          <p className="text-sm text-muted">아래 '내 기록'에서 {monthLabel(c.month)} 기록이 맞는지 보고, 맞으면 확인을 눌러 주세요. 다르면 선생님께 말씀드려요.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={() => confirm(c.month)}>네, 맞아요</button>
            <button className="btn-outline" onClick={() => setSub("내 기록")}>기록 보기</button>
          </div>
        </Section>
      ))}
      <Tabs tabs={SUB} value={sub} onChange={setSub} />
      {sub === "보고하기" && <ReportForm onDone={load} />}
      {sub === "내 기록" && <MyRecords reports={reports} />}
      {sub === "내 정원" && <Garden me={me} reports={reports} startDate={startDate} />}
    </>
  );
}

function ReportForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<Kind | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [reason, setReason] = useState("");
  const [timeNote, setTimeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const ready = !!(kind && category && reason.trim());

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const { error } = await supabase.from("attendance_reports").insert({
      report_date: date, kind, category, reason: reason.trim().slice(0, 200), time_note: kind === "결석" ? "" : timeNote.trim().slice(0, 60),
      student_no: "", student_name: "", // 서버가 로그인한 학생으로 채운다
    });
    setBusy(false);
    if (error) return toast(errMsg(error, "보고를 저장하지 못했어요."), "err");
    setDone(true); setKind(null); setCategory(null); setReason(""); setTimeNote("");
    onDone();
  };

  if (done) return (
    <Section>
      <div className="py-8 text-center">
        <p className="text-5xl">🌿</p>
        <h2 className="mt-4 text-xl font-bold">보고가 전달됐어요</h2>
        <p className="mt-1 text-sm text-muted">선생님 화면에 바로 보여요. 오늘도 수고했어요!</p>
        <button className="btn-outline mt-6" onClick={() => setDone(false)}>다른 내용 더 보고하기</button>
      </div>
    </Section>
  );

  return (
    <div className="space-y-4">
      <Section>
        <div className="mb-2 flex items-center justify-between"><span className="label mb-0">언제인가요?</span>{date === today && <span className="chip">오늘</span>}</div>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        <p className="label mt-5">무슨 일이었나요?</p>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`h-16 rounded-xl border text-base font-bold ${kind === k ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>
              {KIND_EMOJI[k]} {k}
            </button>
          ))}
        </div>
        {kind && (
          <>
            <p className="label mt-5">어떤 사유인가요?</p>
            <div className="space-y-2">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left ${category === c ? "border-brand bg-brand-soft" : "border-line bg-white"}`}>
                  <span className={`size-4 shrink-0 rounded-full border-2 ${category === c ? "border-brand bg-brand" : "border-line"}`} />
                  <span className="font-semibold">{c}</span>
                  <span className="ml-auto text-right text-xs text-muted">{CATEGORY_HELP[c]}</span>
                </button>
              ))}
            </div>
            {kind !== "결석" && (
              <>
                <label className="label mt-5" htmlFor="tn">시간</label>
                <input id="tn" className="input" placeholder={KIND_HINT[kind]} value={timeNote} onChange={(e) => setTimeNote(e.target.value)} maxLength={60} />
              </>
            )}
            <label className="label mt-5" htmlFor="rs">사유 <span className="font-normal text-rose">(필수)</span></label>
            <textarea id="rs" className="input" rows={2} maxLength={200} placeholder="예: 장염, 생리통, 위클래스 상담, 보건실 이용" value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="mt-1.5 text-xs leading-relaxed text-muted">'병원 방문'처럼만 적지 말고 병명(예: 장염, 발목 염좌)을 꼭 써 주세요.</p>
          </>
        )}
      </Section>
      <details className="card text-sm leading-relaxed">
        <summary className="cursor-pointer font-bold">출결 사항 (꼭 읽어 주세요)</summary>
        <div className="mt-3 space-y-3 text-muted">
          <div><p className="font-semibold text-ink">1. 증빙서류·신청서 제출 기한</p><p>· 결석 신고서: 결석한 날로부터 5일 이내</p><p>· 교외체험학습 신청서: 체험학습일 3일보다 이전</p><p>· 교외체험학습 보고서: 체험 후 7일 이내</p><p>· 기한이 지나면 모두 미인정으로 처리합니다.</p></div>
          <div><p className="font-semibold text-ink">2. 공결 처리</p><p>· 공식 대회 참가, 면접 응시 등 '공문'이 있는 경우만 공결</p><p>· 그 외(개인 자격증 시험 등)는 교외체험학습으로 처리</p></div>
          <div><p className="font-semibold text-ink">3. 자주 쓰는 사유</p><p>· 생리통은 보통 인정으로 처리해요.</p><p>· 위클래스 상담은 인정 결과, 보건실 이용은 질병 결과예요.</p></div>
        </div>
      </details>
      <button className="btn w-full py-4 text-base" disabled={!ready || busy} onClick={submit}>
        {busy ? "보내는 중…" : ready ? "보고 보내기" : "종류·사유를 고르고 사유를 적어 주세요"}
      </button>
    </div>
  );
}

function MyRecords({ reports }: { reports: Report[] }) {
  const [ym, setYm] = useState(todayStr().slice(0, 7));
  const monthRows = reports.filter((r) => r.report_date.startsWith(ym));
  const counts = KINDS.map((k) => [k, monthRows.filter((r) => r.kind === k).length] as const);
  const shift = (n: number) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() + n); setYm(toDateString(d).slice(0, 7)); };
  const days = useMemo(() => {
    const first = new Date(`${ym}-01T12:00:00`);
    const cells: (string | null)[] = Array(first.getDay()).fill(null);
    const d = new Date(first);
    while (d.getMonth() === first.getMonth()) { cells.push(toDateString(d)); d.setDate(d.getDate() + 1); }
    return cells;
  }, [ym]);
  const byDay = new Map<string, Report[]>();
  monthRows.forEach((r) => byDay.set(r.report_date, [...(byDay.get(r.report_date) ?? []), r]));
  return (
    <div className="space-y-4">
      <Section>
        <div className="flex items-center justify-between">
          <button className="btn-outline btn-sm" onClick={() => shift(-1)} aria-label="이전 달">‹</button>
          <b>{monthLabel(ym)}</b>
          <button className="btn-outline btn-sm" onClick={() => shift(1)} aria-label="다음 달">›</button>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs">
          {["일", "월", "화", "수", "목", "금", "토"].map((w) => <span key={w} className="py-1 text-muted">{w}</span>)}
          {days.map((d, i) => (
            <div key={i} className={`flex aspect-square flex-col items-center justify-center rounded-lg ${d && byDay.has(d) ? "bg-warm" : ""}`}>
              {d && <span>{Number(d.slice(8))}</span>}
              {d && byDay.has(d) && <span className="mt-0.5 flex gap-0.5">{byDay.get(d)!.map((r) => <i key={r.id} className={`size-1.5 rounded-full ${KIND_DOT[r.kind]}`} />)}</span>}
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {counts.map(([k, n]) => <div key={k} className="rounded-xl bg-bg py-2"><p className="text-xs text-muted">{k}</p><p className="text-lg font-bold">{n}</p></div>)}
        </div>
      </Section>
      <Section title={`${monthLabel(ym)} 기록`}>
        {monthRows.length === 0 ? <Empty>이 달에는 기록이 없어요 🌿</Empty> : (
          <ul className="divide-y divide-line">
            {monthRows.map((r) => (
              <li key={r.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><b>{r.report_date.slice(5).replace("-", "/")}</b><span className="chip">{r.kind}</span><span className="chip-gray">{r.category}</span>{r.time_note && <span className="text-muted">{r.time_note}</span>}</div>
                <p className="mt-1 text-muted">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Garden({ me, reports, startDate }: { me: Me; reports: Report[]; startDate: string | null }) {
  const toast = useToast();
  const today = new Date();
  const streak = calcStreak(reports.map((r) => r.report_date), today, startDate);
  const monthCount = reports.filter((r) => r.report_date.startsWith(todayStr().slice(0, 7))).length;
  const badges = buildBadges(reports, streak, monthCount);
  const { stage, next } = plantStage(streak);
  const [g, setG] = useState({ plant_name: "", pot_color: "terracotta", prop: "none" });
  const [cls, setCls] = useState<{ total: number; avg: number; counts: number[] } | null>(null);

  useEffect(() => {
    supabase.from("student_gardens").select("plant_name, pot_color, prop").eq("student_no", me.student_no).maybeSingle()
      .then(({ data }) => data && setG(data));
    (async () => {
      const [{ data: rows }, { data: meta }] = await Promise.all([supabase.rpc("attendance_class_garden"), supabase.rpc("attendance_meta")]);
      const m = (meta as { start_date: string | null; student_count: number }[] | null)?.[0];
      const by = new Map<number, string[]>();
      ((rows ?? []) as { k: number; report_date: string }[]).forEach((r) => by.set(r.k, [...(by.get(r.k) ?? []), r.report_date]));
      const total = m?.student_count ?? 0;
      const streaks: number[] = [];
      for (const dates of by.values()) streaks.push(calcStreak(dates, today, m?.start_date));
      while (streaks.length < total) streaks.push(calcStreak([], today, m?.start_date));
      const counts = PLANT_STAGES.map((s, i) => streaks.filter((x) => x >= s.min && (i === PLANT_STAGES.length - 1 || x < PLANT_STAGES[i + 1].min)).length);
      setCls({ total, avg: total ? Math.round((streaks.reduce((a, b) => a + b, 0) / total) * 10) / 10 : 0, counts });
    })();
  }, [me.student_no]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const { error } = await supabase.from("student_gardens").upsert({ student_no: me.student_no, ...g, plant_name: g.plant_name.slice(0, 8), updated_at: new Date().toISOString() });
    if (error) return toast(errMsg(error), "err");
    toast("화분을 꾸몄어요.");
  };
  const pot = POT_OPTIONS.find((p) => p.id === g.pot_color) ?? POT_OPTIONS[0];
  const prop = PROP_OPTIONS.find((p) => p.id === g.prop);

  return (
    <div className="space-y-4">
      <Section>
        <div className="text-center">
          <div className="relative mx-auto w-40">
            <p className="text-7xl">{stage.emoji}</p>
            <div className="mx-auto -mt-1 h-14 w-28 rounded-b-[2.5rem] rounded-t-lg" style={{ background: pot.pot, borderTop: `8px solid ${pot.soil}` }} />
            {prop?.emoji && <span className="absolute -right-2 bottom-0 text-3xl">{prop.emoji}</span>}
          </div>
          <p className="mt-3 text-lg font-bold">{g.plant_name || "이름 없는 식물"} · {stage.name}</p>
          <p className="text-sm text-muted">연속 {streak}일 무사고 {next ? `· ${next.name}까지 ${next.min - streak}일` : "· 최고 단계!"}</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <input className="input" maxLength={8} placeholder="식물 이름 (8자)" value={g.plant_name} onChange={(e) => setG({ ...g, plant_name: e.target.value })} />
          <select className="input" value={g.pot_color} onChange={(e) => setG({ ...g, pot_color: e.target.value })}>{POT_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label} 화분</option>)}</select>
          <select className="input" value={g.prop} onChange={(e) => setG({ ...g, prop: e.target.value })}>{PROP_OPTIONS.map((p) => <option key={p.id} value={p.id}>정원 친구: {p.label}</option>)}</select>
        </div>
        <button className="btn-outline mt-3 w-full" onClick={save}>꾸미기 저장</button>
      </Section>
      <Section title="배지">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {badges.map((b) => (
            <div key={b.id} className={`rounded-xl border p-3 text-center ${b.earned ? "border-brand bg-brand-soft" : "border-line opacity-50"}`}>
              <p className="text-2xl">{b.emoji}</p><p className="mt-1 text-sm font-bold">{b.name}</p><p className="text-[11px] text-muted">{b.desc}</p>
            </div>
          ))}
        </div>
      </Section>
      {cls && (
        <Section title="🌳 우리 반 정원">
          <p className="text-sm text-muted">반 평균 연속 출석 <b className="text-ink">{cls.avg}일</b> · {cls.total}명</p>
          <div className="mt-3 grid grid-cols-5 gap-2 text-center">
            {PLANT_STAGES.map((s, i) => <div key={s.name} className="rounded-xl bg-bg py-2"><p className="text-2xl">{s.emoji}</p><p className="text-xs text-muted">{s.name}</p><p className="font-bold">{cls.counts[i]}</p></div>)}
          </div>
        </Section>
      )}
    </div>
  );
}
