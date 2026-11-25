import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Toast = { id: number; text: string; tone: "ok" | "err" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p, { id, text, tone }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`max-w-md rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg ${t.tone === "ok" ? "bg-ink text-white" : "bg-rose text-white"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, badges }: { tabs: readonly T[]; value: T; onChange: (t: T) => void; badges?: Partial<Record<T, number>> }) {
  return (
    <div role="tablist" className="no-print -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={value === t} onClick={() => onChange(t)}
          className={`shrink-0 rounded-full border-[1.5px] px-4 py-1.5 text-sm font-semibold transition ${value === t ? "border-ink bg-ink text-white" : "border-line bg-paper text-muted hover:border-brand hover:text-ink"}`}>
          {t}
          {!!badges?.[t] && <span className="ml-1.5 rounded-full bg-rose px-1.5 text-[11px] text-white">{badges[t]}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading() {
  return <p className="py-10 text-center text-sm text-muted">불러오는 중…</p>;
}

export function Section({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-200">
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** 흐린 별 배경 장식 */
export function SkyDeco() {
  const star = "M50 4l14 29 32 4-23 22 6 32-29-16-29 16 6-32L4 37l32-4z";
  const tw = "M20 0C21 15 25 19 40 20 25 21 21 25 20 40 19 25 15 21 0 20 15 19 19 15 20 0z";
  return (
    <svg className="sky-deco no-print" width="100%" height="100%" aria-hidden="true">
      <defs>
        <filter id="skyblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22" /></filter>
        <symbol id="skystar" viewBox="0 0 100 100"><path d={star} fill="#B3DBFB" /></symbol>
        <symbol id="skytw" viewBox="0 0 40 40"><path d={tw} /></symbol>
      </defs>
      <svg x="100%" y="0" overflow="visible"><g filter="url(#skyblur)" transform="translate(-230,-30)"><use href="#skystar" width="260" height="260" /></g></svg>
      <svg x="0" y="100%" overflow="visible"><g filter="url(#skyblur)" transform="translate(-70,-250)"><use href="#skystar" width="250" height="250" /></g></svg>
      <svg x="0" y="45%" overflow="visible"><g filter="url(#skyblur)" opacity=".55" transform="translate(-90,-60)"><use href="#skystar" width="160" height="160" /></g></svg>
      <g fill="#8CC7F5">
        <svg x="8%" y="18%" overflow="visible"><use href="#skytw" width="16" height="20" /></svg>
        <svg x="88%" y="34%" overflow="visible"><use href="#skytw" width="12" height="14" /></svg>
        <svg x="82%" y="86%" overflow="visible"><use href="#skytw" width="18" height="22" /></svg>
      </g>
      <g fill="#ffffff">
        <svg x="80%" y="9%" overflow="visible"><use href="#skytw" width="22" height="28" /></svg>
        <svg x="10%" y="80%" overflow="visible"><use href="#skytw" width="18" height="22" /></svg>
      </g>
    </svg>
  );
}
