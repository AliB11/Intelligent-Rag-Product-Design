"use client";

import type { GuildEcosystem, PersonaSpec, ProductSpec } from "@/lib/domain/types";
import { Badge, IconNetwork, Panel, fmtNum, fmtPct } from "./ui";

export default function GuildEcosystemCanvas({
  ecosystem,
  persona,
  product,
}: {
  ecosystem: GuildEcosystem | null;
  persona: PersonaSpec | null;
  product: ProductSpec | null;
}) {
  if (!ecosystem || !persona) {
    return (
      <Panel title="بوم زیست‌بوم صنفی" icon={<IconNetwork className="h-4 w-4" />}>
        <p className="py-10 text-center text-[12px] text-mist">
          برای فعال‌سازی گره «پرسونا و زنجیره ارزش صنفی» نام یک شغل یا صنف را در درخواست ذکر کنید
          (مثلاً پزشکان متخصص، دندانپزشکان، داروخانه‌ها، رانندگان ناوگان، پذیرندگان POS، صنایع زنجیره تأمین).
        </p>
      </Panel>
    );
  }

  const suppliers = ecosystem.suppliersFa.slice(0, 4);
  const clients = ecosystem.clientsFa.slice(0, 3);
  const rails = ecosystem.railsFa.slice(0, 4);
  const gammaModes = product?.modes.filter((m) => m.closedLoopRetention >= 0.6) ?? [];

  return (
    <Panel
      title={ecosystem.titleFa}
      subtitle={`لنگر زنجیره: ${ecosystem.anchorFa} — گلوگاه نقدینگی: ${ecosystem.bottleneckFa}`}
      icon={<IconNetwork className="h-4 w-4" />}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="teal">γ هدف {fmtPct(ecosystem.gammaTarget, 0)}</Badge>
          <Badge tone="gold">بسته‌بودن اکوسیستم {fmtPct(ecosystem.loopClosure, 0)}</Badge>
          <Badge tone="violet">
            κ منبع {fmtNum(persona.sourceKappa, 2)}
          </Badge>
        </div>
      }
    >
      <style>{`
        @keyframes dashFlow { to { stroke-dashoffset: -120; } }
        .flow-line { stroke-dasharray: 6 8; animation: dashFlow 3.4s linear infinite; }
        .flow-line-slow { stroke-dasharray: 4 10; animation: dashFlow 5.6s linear infinite; }
      `}</style>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="panel-tight p-2">
          <svg viewBox="0 0 620 400" className="h-[380px] w-full" role="img">
            <defs>
              <radialGradient id="anchorGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#e0b25c" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#e0b25c" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="bankGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#16324a" />
                <stop offset="100%" stopColor="#0d1a2b" />
              </linearGradient>
              <marker id="arrowTeal" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#35d6a4" />
              </marker>
              <marker id="arrowGold" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#e0b25c" />
              </marker>
              <marker id="arrowViolet" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#8b7cf6" />
              </marker>
            </defs>

            {/* bank node */}
            <g>
              <rect x="228" y="330" width="164" height="52" rx="12" fill="url(#bankGrad)" stroke="#2c4a68" />
              <text x="310" y="352" textAnchor="middle" fill="#cfe0f2" fontSize="13" fontFamily="Vazirmatn">
                بانک عامل (دفتر کل)
              </text>
              <text x="310" y="370" textAnchor="middle" fill="#8ea0bd" fontSize="10.5" fontFamily="Vazirmatn">
                سپرده جاری کم‌هزینه · γ = {fmtPct(ecosystem.gammaTarget, 0)}
              </text>
            </g>

            {/* anchor */}
            <g>
              <circle cx="310" cy="185" r="86" fill="url(#anchorGlow)" />
              <circle cx="310" cy="185" r="58" fill="#101a2b" stroke="#e0b25c" strokeWidth="1.6" />
              <text x="310" y="178" textAnchor="middle" fill="#f0d9a6" fontSize="12.5" fontFamily="Vazirmatn">
                {persona.titleFa.length > 26
                  ? persona.titleFa.slice(0, 26) + "…"
                  : persona.titleFa}
              </text>
              <text x="310" y="196" textAnchor="middle" fill="#8ea0bd" fontSize="10" fontFamily="Vazirmatn">
                درآمد {fmtNum(persona.monthlyNetIncomeToman / 1e6, 0)} م.ت/ماه
              </text>
              <text x="310" y="212" textAnchor="middle" fill="#8ea0bd" fontSize="10" fontFamily="Vazirmatn">
                PD {fmtPct(persona.pd, 2)} · LGD {fmtPct(persona.lgd, 0)}
              </text>
            </g>

            {/* suppliers (B2B) */}
            {suppliers.map((s, i) => {
              const y = 40 + i * 74;
              return (
                <g key={s.name}>
                  <rect x="8" y={y} width="176" height="58" rx="10" fill="#0e1a2a" stroke="#2a3a58" />
                  <text x="96" y={y + 22} textAnchor="middle" fill="#dce7f5" fontSize="11" fontFamily="Vazirmatn">
                    {s.name.length > 28 ? s.name.slice(0, 28) + "…" : s.name}
                  </text>
                  <text x="96" y={y + 40} textAnchor="middle" fill="#35d6a4" fontSize="9.5" fontFamily="Vazirmatn">
                    {s.instrument} · سهم {fmtPct(s.share, 0)}
                  </text>
                  <path
                    className="flow-line"
                    d={`M184 ${y + 29} C 220 ${y + 29}, 232 ${150 + i * 16}, 254 ${170 + i * 10}`}
                    fill="none"
                    stroke="#35d6a4"
                    strokeWidth="1.3"
                    markerEnd="url(#arrowTeal)"
                    opacity="0.75"
                  />
                </g>
              );
            })}

            {/* clients (B2C) */}
            {clients.map((c, i) => {
              const y = 58 + i * 74;
              return (
                <g key={c.name}>
                  <rect x="436" y={y} width="176" height="58" rx="10" fill="#0e1a2a" stroke="#2a3a58" />
                  <text x="524" y={y + 22} textAnchor="middle" fill="#dce7f5" fontSize="11" fontFamily="Vazirmatn">
                    {c.name.length > 28 ? c.name.slice(0, 28) + "…" : c.name}
                  </text>
                  <text x="524" y={y + 40} textAnchor="middle" fill="#8b7cf6" fontSize="9.5" fontFamily="Vazirmatn">
                    {c.instrument} · سهم {fmtPct(c.share, 0)}
                  </text>
                  <path
                    className="flow-line"
                    d={`M366 ${170 + i * 12} C 396 ${158 + i * 18}, 410 ${y + 29}, 436 ${y + 29}`}
                    fill="none"
                    stroke="#8b7cf6"
                    strokeWidth="1.3"
                    markerEnd="url(#arrowViolet)"
                    opacity="0.75"
                  />
                </g>
              );
            })}

            {/* funding + settlement loop through the bank */}
            <path
              className="flow-line-slow"
              d="M310 330 C 250 300, 210 260, 258 214"
              fill="none"
              stroke="#e0b25c"
              strokeWidth="1.5"
              markerEnd="url(#arrowGold)"
            />
            <text x="196" y="286" fill="#e0b25c" fontSize="10" fontFamily="Vazirmatn">
              تأمین مالی (گام/خرید دین/مرابحه)
            </text>

            <path
              className="flow-line"
              d="M362 214 C 420 262, 400 306, 392 330"
              fill="none"
              stroke="#4ea8de"
              strokeWidth="1.6"
              markerEnd="url(#arrowTeal)"
            />
            <text x="392" y="286" fill="#4ea8de" fontSize="10" fontFamily="Vazirmatn">
              تسویه و بازگشت منبع (POS/درگاه)
            </text>

            <text x="310" y="24" textAnchor="middle" fill="#8ea0bd" fontSize="10.5" fontFamily="Vazirmatn">
              زیست‌بوم سه‌جانبه حلقه بسته: تأمین‌کننده ← لنگر صنفی ← مشتری ← بازچرخش در بانک
            </text>
          </svg>
        </div>

        <div className="space-y-3">
          <div className="panel-tight p-3">
            <h3 className="text-[12px] font-semibold text-gold">زنجیره ارزش پنج مرحله‌ای</h3>
            <ol className="mt-2 space-y-1.5">
              {ecosystem.valueChainFa.map((step) => (
                <li key={step} className="text-[11.3px] leading-6 text-mist">
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <div className="panel-tight p-3">
            <h3 className="text-[12px] font-semibold text-chalk">ریل‌های تسویه</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rails.map((rail) => (
                <span
                  key={rail}
                  className="rounded-full border border-line bg-[rgba(255,255,255,0.03)] px-2.5 py-1 text-[10.5px] text-mist"
                >
                  {rail}
                </span>
              ))}
            </div>
          </div>

          <div className="panel-tight p-3">
            <h3 className="text-[12px] font-semibold text-chalk">
              طرح‌های متصل به حلقه بسته (γ ≥ ۶۰٪)
            </h3>
            <div className="mt-2 space-y-1.5">
              {gammaModes.length ? (
                gammaModes.map((mode) => (
                  <div
                    key={mode.id}
                    className="flex items-center justify-between rounded-md border border-line/70 bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5"
                  >
                    <span className="text-[11px] text-chalk">{mode.nameFa}</span>
                    <span className="num text-[11px] text-teal">
                      γ {fmtPct(mode.closedLoopRetention, 0)} · κ {fmtNum(mode.sourceKappa, 2)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-mist">
                  در ساختار فعلی هیچ طرحی به آستانه γ ≥ ۶۰٪ نرسیده است؛ ممیز خوداصلاح دستور افزایش
                  ماندگاری حلقه بسته را صادر می‌کند.
                </p>
              )}
            </div>
          </div>

          <div className="panel-tight p-3">
            <h3 className="text-[12px] font-semibold text-chalk">مشخصات پرسونا</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <Kv k="جمعیت هدف" v={fmtNum(persona.population)} />
              <Kv k="درآمد خالص ماهانه" v={`${fmtNum(persona.monthlyNetIncomeToman / 1e6)} م.ت`} />
              <Kv k="پتانسیل حلقه بسته" v={fmtPct(persona.closedLoopPotential, 0)} />
              <Kv k="ضریب منبع κ" v={fmtNum(persona.sourceKappa, 2)} />
              <Kv k="عقود ترجیحی" v={persona.preferredContracts.length.toString()} />
              <Kv k="زیان مورد انتظار" v={fmtPct(persona.pd * persona.lgd, 2)} />
            </dl>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-line/60 bg-[rgba(255,255,255,0.02)] px-2 py-1.5">
      <dt className="text-[10px] text-mist">{k}</dt>
      <dd className="num mt-0.5 text-[12px] text-chalk">{v}</dd>
    </div>
  );
}
