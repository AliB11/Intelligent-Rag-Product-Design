"use client";

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* formatters                                                          */
/* ------------------------------------------------------------------ */

export const HEMMAT_RIAL = 1e13;

export const fmtNum = (v: number, digits = 0) =>
  Number.isFinite(v)
    ? new Intl.NumberFormat("fa-IR", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(v)
    : "—";

export const fmtPct = (v: number, digits = 2) =>
  Number.isFinite(v) ? `${fmtNum(v * 100, digits)}٪` : "—";

export const fmtHemmat = (rial: number, digits = 2) => fmtNum(rial / HEMMAT_RIAL, digits);

export const fmtBToman = (rial: number, digits = 1) => fmtNum(rial / 1e10, digits);

export const fmtToman = (rial: number, digits = 0) => fmtNum(rial / 10, digits);

export const fmtCompact = (rial: number) => {
  const b = rial / 1e10;
  if (Math.abs(b) >= 1000) return `${fmtNum(b / 1000, 2)} همت`;
  return `${fmtNum(b, 1)} م.ت`;
};

/* ------------------------------------------------------------------ */
/* icons (hand-drawn inline SVG)                                       */
/* ------------------------------------------------------------------ */

type IconProps = { className?: string };
const base = "h-4 w-4";

export const IconBrain = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="M9 4.5A2.5 2.5 0 0 0 6.5 7 2.5 2.5 0 0 0 5 9.5c0 .9.5 1.7 1.2 2.1A2.6 2.6 0 0 0 5.5 14c0 1.3 1 2.4 2.3 2.5A2.5 2.5 0 0 0 12 19V5.8A2.4 2.4 0 0 0 9 4.5Z" />
    <path d="M15 4.5A2.5 2.5 0 0 1 17.5 7 2.5 2.5 0 0 1 19 9.5c0 .9-.5 1.7-1.2 2.1.5.5.7 1.2.7 1.9 0 1.3-1 2.4-2.3 2.5A2.5 2.5 0 0 1 12 19" />
    <path d="M12 8h2M12 12h3" strokeLinecap="round" />
  </svg>
);

export const IconLayers = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
    <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" strokeLinecap="round" />
  </svg>
);

export const IconChart = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="M4 19V5M4 19h16" strokeLinecap="round" />
    <path d="M7 15.5 11 10l3 3 4.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconNetwork = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <circle cx="12" cy="5" r="2.2" />
    <circle cx="5" cy="18" r="2.2" />
    <circle cx="19" cy="18" r="2.2" />
    <path d="M12 7.2v4M12 11.2 6.4 16M12 11.2 17.6 16" strokeLinecap="round" />
  </svg>
);

export const IconShield = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="M12 3 5 6v6c0 4 3 7.4 7 9 4-1.6 7-5 7-9V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconScale = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 5a3 3 0 0 0 5 0L5 8Zm14 0-2.5 5a3 3 0 0 0 5 0L19 8Z" strokeLinecap="round" />
  </svg>
);

export const IconFlask = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="M9 3h6M10 3v6.5L5.5 17A2.5 2.5 0 0 0 7.7 21h8.6a2.5 2.5 0 0 0 2.2-4L14 9.5V3" strokeLinecap="round" />
    <path d="M7.6 15h8.8" strokeLinecap="round" />
  </svg>
);

export const IconDoc = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="M6 3h8l4 4v14H6V3Z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" strokeLinecap="round" />
  </svg>
);

export const IconPlay = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="M7 4.5 19 12 7 19.5v-15Z" strokeLinejoin="round" />
  </svg>
);

export const IconStop = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const IconDatabase = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  </svg>
);

export const IconClock = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" strokeLinecap="round" />
  </svg>
);

export const IconAlert = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <path d="M12 4.5 21 19H3l9-14.5Z" strokeLinejoin="round" />
    <path d="M12 10v4M12 16.6v.4" strokeLinecap="round" />
  </svg>
);

export const IconCheck = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconCoins = ({ className = base }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <ellipse cx="9" cy="7" rx="5.5" ry="2.6" />
    <path d="M3.5 7v4c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6V7" />
    <ellipse cx="15.5" cy="14.5" rx="5" ry="2.4" />
    <path d="M10.5 14.5v3.2c0 1.3 2.2 2.3 5 2.3s5-1 5-2.3v-3.2" />
  </svg>
);

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

export type Tone = "neutral" | "gold" | "teal" | "rose" | "violet" | "sky";

const toneRing: Record<Tone, string> = {
  neutral: "border-line text-mist",
  gold: "border-gold/40 text-gold",
  teal: "border-teal/40 text-teal",
  rose: "border-rose/40 text-rose",
  violet: "border-violet/40 text-violet",
  sky: "border-sky/40 text-sky",
};

const toneText: Record<Tone, string> = {
  neutral: "text-chalk",
  gold: "text-gold",
  teal: "text-teal",
  rose: "text-rose",
  violet: "text-violet",
  sky: "text-sky",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] leading-5 ${toneRing[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line/80 bg-[rgba(255,255,255,0.015)] px-4 py-3">
          <div className="flex items-start gap-2.5">
            {icon ? <span className="mt-0.5 text-gold">{icon}</span> : null}
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-tight text-chalk">{title}</h2>
              {subtitle ? (
                <p className="mt-0.5 text-[11.5px] leading-5 text-mist">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={bodyClass || "p-4"}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = "neutral",
  hint,
  limit,
  ok,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  hint?: string;
  limit?: string;
  ok?: boolean;
}) {
  return (
    <div className="panel-tight relative px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-mist">{label}</span>
        {ok !== undefined ? (
          <span className={ok ? "text-teal" : "text-rose"}>
            {ok ? <IconCheck className="h-3.5 w-3.5" /> : <IconAlert className="h-3.5 w-3.5" />}
          </span>
        ) : null}
      </div>
      <div className={`mt-1 flex items-baseline gap-1 ${toneText[tone]}`}>
        <span className="num text-[19px] font-semibold leading-6">{value}</span>
        {unit ? <span className="text-[11px] text-mist">{unit}</span> : null}
      </div>
      {(hint || limit) && (
        <div className="mt-0.5 text-[10.5px] leading-4 text-mist/80">
          {limit ? <span className="num">حد مجاز: {limit}</span> : null}
          {limit && hint ? <span className="mx-1 opacity-40">|</span> : null}
          {hint}
        </div>
      )}
    </div>
  );
}

export function Bar({
  value,
  max = 1,
  tone = "gold",
  height = 6,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * 100;
  const colors: Record<Tone, string> = {
    neutral: "bg-mist",
    gold: "bg-gold",
    teal: "bg-teal",
    rose: "bg-rose",
    violet: "bg-violet",
    sky: "bg-sky",
  };
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]"
      style={{ height }}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${colors[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; icon?: ReactNode; badge?: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`group inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] transition ${
              isActive
                ? "border-gold/50 bg-gold/10 text-gold"
                : "border-line bg-[rgba(255,255,255,0.015)] text-mist hover:border-line2 hover:text-chalk"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge ? (
              <span className="num rounded-full bg-[rgba(255,255,255,0.07)] px-1.5 text-[10px]">
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="text-gold/70">{icon ?? <IconBrain className="h-7 w-7" />}</span>
      <p className="text-[13px] font-medium text-chalk">{title}</p>
      <p className="max-w-md text-[11.5px] leading-6 text-mist">{hint}</p>
    </div>
  );
}
