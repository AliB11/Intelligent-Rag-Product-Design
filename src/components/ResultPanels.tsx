"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AlmMetrics,
  BenchmarkScheme,
  ProductGenerationRequest,
  RegulatoryConstraint,
} from "@/lib/domain/types";
import type {
  AccountingEntry,
  ComplianceDraftItem,
  SensitivityFrame,
  ValidationStatus,
} from "@/lib/agents/state";
import { REGULATORY } from "@/lib/domain/constants";
import type { OptimizerIteration } from "@/lib/domain/optimizer";
import type { RunSummary } from "@/lib/db/repository";
import {
  Badge,
  Bar,
  IconCoins,
  IconDatabase,
  IconDoc,
  IconFlask,
  IconScale,
  IconShield,
  Panel,
  Stat,
  fmtBToman,
  fmtNum,
  fmtPct,
} from "./ui";

const tooltipStyle = {
  background: "rgba(6,10,18,0.96)",
  border: "1px solid #24344f",
  borderRadius: 10,
  fontSize: 11,
  color: "#e7eef8",
  fontFamily: "Vazirmatn, sans-serif",
};
const axisTick = { fill: "#8ea0bd", fontSize: 10, fontFamily: "Vazirmatn" };

/* ------------------------------------------------------------------ */
/* KPI + critic trace                                                  */
/* ------------------------------------------------------------------ */

export function MetricsPanel({
  metrics,
  request,
  iterations,
  findings,
  validationStatus,
  horizonMonths,
  monteCarloRuns,
}: {
  metrics: AlmMetrics | null;
  request: ProductGenerationRequest | null;
  iterations: OptimizerIteration[];
  findings: { severity: string; messageFa: string; metric: string; observed: number; limit: number }[];
  validationStatus: ValidationStatus;
  horizonMonths: number;
  monteCarloRuns: number;
}) {
  if (!metrics || !request) return null;
  const blockers = findings.filter((f) => f.severity === "blocker");
  const ldrCeiling = Math.min(request.ldrCeiling, REGULATORY.ldrCeiling);
  const lcrFloor = Math.max(request.lcrFloor, REGULATORY.lcrFloor);

  return (
    <div className="space-y-3">
      <Panel
        title="سنجه‌های کلیدی دوقلوی دیجیتال"
        subtitle={`آزمون ALM ${fmtNum(horizonMonths)} ماهه با ${fmtNum(monteCarloRuns)} مسیر مونت‌کارلو؛ حد مؤثر = سخت‌گیرانه‌ترِ درخواست و حدود مدل‌شده`}
        icon={<IconScale className="h-4 w-4" />}
        actions={
          <Badge tone={validationStatus === "constraints_passed" ? "teal" : validationStatus === "not_validated" ? "rose" : "gold"}>
            {validationStatus === "constraints_passed"
              ? `قیود سخت مدل پاس شدند${findings.some((f) => f.severity === "warning") ? ` · ${fmtNum(findings.filter((f) => f.severity === "warning").length)} هشدار` : ""}`
              : validationStatus === "not_validated"
                ? `${fmtNum(blockers.length)} مانع · غیرقابل‌تأیید`
                : "اعتبارسنجی نهایی نشده"}
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat
            label="IRR بانک (سالانه)"
            value={fmtPct(metrics.irrBankAnnual)}
            tone="gold"
            limit={`≥ ${fmtPct(request.targetIrr, 1)}`}
            ok={metrics.irrBankAnnual >= request.targetIrr}
          />
          <Stat
            label="ROI تجمیعی ۵ ساله"
            value={fmtPct(metrics.roi, 1)}
            tone="teal"
            limit={`≥ ${fmtPct(request.targetRoi, 0)}`}
            ok={metrics.roi >= request.targetRoi}
          />
          <Stat
            label="ROE سالانه"
            value={fmtPct(metrics.roe, 1)}
            tone="teal"
            limit={`≥ ${fmtPct(request.targetRoe, 1)}`}
            ok={metrics.roe >= request.targetRoe}
          />
          <Stat
            label="NIM کل"
            value={fmtPct(metrics.nim)}
            tone="sky"
            hint={`مشاع ${fmtPct(metrics.nimJoint)} · غیرمشاع ${fmtPct(metrics.nimNonJoint)}`}
            limit={`≥ ${fmtPct(request.targetNim, 1)}`}
            ok={metrics.nim >= request.targetNim}
          />
          <Stat
            label="p95 نسبت تسهیلات به سپرده"
            value={fmtPct(metrics.p95Ldr)}
            tone={metrics.p95Ldr <= ldrCeiling ? "teal" : "rose"}
            limit={`≤ ${fmtPct(ldrCeiling, 0)}`}
            ok={metrics.p95Ldr <= ldrCeiling}
            hint={request.ldrCeiling > REGULATORY.ldrCeiling ? `درخواست: ${fmtPct(request.ldrCeiling, 0)}؛ سقف مدل: ${fmtPct(REGULATORY.ldrCeiling, 0)}` : `میانگین ${fmtPct(metrics.meanLdr)}`}
          />
          <Stat
            label="p5 نسبت پوشش نقدینگی"
            value={fmtNum(metrics.p5Lcr, 2)}
            tone={metrics.p5Lcr >= lcrFloor ? "teal" : "rose"}
            limit={`≥ ${fmtNum(lcrFloor, 2)}`}
            ok={metrics.p5Lcr >= lcrFloor}
            hint={request.lcrFloor < REGULATORY.lcrFloor ? `درخواست: ${fmtNum(request.lcrFloor, 2)}؛ کف مدل: ${fmtNum(REGULATORY.lcrFloor, 2)}` : `میانگین ${fmtNum(metrics.meanLcr, 2)}`}
          />
          <Stat
            label="شوک واژگونی منابع"
            value={fmtPct(metrics.overturningShock)}
            tone={metrics.overturningShock <= request.maxOverturningShock ? "teal" : "rose"}
            limit={`≤ ${fmtPct(request.maxOverturningShock, 1)}`}
            ok={metrics.overturningShock <= request.maxOverturningShock}
            hint={`پایداری منابع ${fmtPct(metrics.resourceStabilityIndex, 0)}`}
          />
          <Stat
            label="خالص خروج نقدینگی"
            value={fmtPct(metrics.netLiquidityDrainRatio)}
            tone={metrics.netLiquidityDrainRatio <= 0.05 ? "teal" : "gold"}
            hint="نسبت به کل تسهیلات اعطاشده"
            limit="≈ ۰"
            ok={metrics.netLiquidityDrainRatio <= 0.05}
          />
          <Stat label="امتیاز پذیرش مشتری" value={fmtPct(metrics.adoptionScore, 1)} tone="violet" />
          <Stat label="درآمد خالص ۵ ساله" value={`${fmtBToman(metrics.totalNetIncomeRial)} م.ت`} tone="gold" />
          <Stat label="سرمایه اقتصادی برنامه" value={`${fmtBToman(metrics.economicCapitalRial)} م.ت`} />
          <Stat label="IRR ماهانه (مونت‌کارلو)" value={fmtPct(metrics.irrBank, 2)} tone="sky" />
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="مسیر خوداصلاحی ممیز" subtitle={`حداکثر ${fmtNum(5)} گام بازگشت شرطی به سنتزکننده`} icon={<IconFlask className="h-4 w-4" />}>
          {iterations.length ? (
            <div className="space-y-2">
              {iterations.map((it) => (
                <div key={it.iteration} className="panel-tight px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] text-chalk">
                      گام {fmtNum(it.iteration)}{" "}
                      <span className="num text-mist">(امتیاز {fmtNum(it.score, 3)})</span>
                    </span>
                    <Badge tone={it.feasible ? "teal" : "gold"}>
                      {it.feasible ? "موجه" : "نیازمند تعدیل"}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    <MiniBar label="IRR" value={it.irrAnnual} max={0.5} tone="gold" text={fmtPct(it.irrAnnual, 1)} />
                    <MiniBar label="p95 LDR" value={it.p95Ldr} max={1} tone="teal" text={fmtPct(it.p95Ldr, 1)} />
                    <MiniBar label="p5 LCR" value={it.p5Lcr / 2} max={1} tone="sky" text={fmtNum(it.p5Lcr, 2)} />
                    <MiniBar label="واژگونی" value={it.overturningShock} max={0.15} tone="rose" text={fmtPct(it.overturningShock, 1)} />
                  </div>
                  {it.directivesAppliedFa?.length ? (
                    <ul className="mt-2 space-y-1 border-t border-line/60 pt-2">
                      {it.directivesAppliedFa.slice(0, 3).map((d, i) => (
                        <li key={i} className="text-[10.5px] leading-5 text-mist">
                          ← {d}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-[11.5px] text-mist">
              ساختار در نخستین ارزیابی موجه تشخیص داده شد.
            </p>
          )}
        </Panel>

        <Panel title="یافته‌های ممیزی و دستورات تعدیل" subtitle="هر یافته با دستور ریاضی مشخص روی پارامترهای طرح" icon={<IconShield className="h-4 w-4" />}>
          {findings.length ? (
            <div className="max-h-[330px] space-y-2 overflow-y-auto pl-1">
              {findings.map((f, i) => (
                <div
                  key={i}
                  className={`rounded-lg border px-3 py-2 ${
                    f.severity === "blocker"
                      ? "border-rose/40 bg-rose/5"
                      : f.severity === "warning"
                        ? "border-gold/40 bg-gold/5"
                        : "border-line bg-[rgba(255,255,255,0.02)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-chalk">{f.metric}</span>
                    <span className="num text-[10.5px] text-mist">
                      مشاهده {fmtNum(f.observed, 4)} / حد {fmtNum(f.limit, 4)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-6 text-mist">{f.messageFa}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-[11.5px] text-teal">
              هیچ نقض یا هشداری ثبت نشد — ساختار آماده تصویب است.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function MiniBar({
  label,
  value,
  max,
  tone,
  text,
}: {
  label: string;
  value: number;
  max: number;
  tone: "gold" | "teal" | "sky" | "rose";
  text: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-mist">
        <span>{label}</span>
        <span className="num text-chalk">{text}</span>
      </div>
      <div className="mt-1">
        <Bar value={value} max={max} tone={tone} height={4} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* sensitivity dashboard                                               */
/* ------------------------------------------------------------------ */

export function SensitivityDashboard({ sensitivity }: { sensitivity: SensitivityFrame | null }) {
  const [dim, setDim] = useState(0);
  const data = useMemo(() => {
    if (!sensitivity) return [];
    return sensitivity.deltas[dim].map((d, i) => ({
      delta: d,
      irr: sensitivity.irr[dim][i] * 100,
      ldr: sensitivity.ldr[dim][i] * 100,
      lcr: sensitivity.lcr[dim][i],
      overturning: sensitivity.overturning[dim][i] * 100,
      adoption: sensitivity.adoption[dim][i] * 100,
    }));
  }, [sensitivity, dim]);

  if (!sensitivity) return null;

  return (
    <Panel
      title="داشبورد حساسیت‌سنجی تعاملی"
      subtitle="اثر تغییر تک‌بعدی هر پارامتر ساختاری بر IRR، LDR، LCR و شوک واژگونی منابع"
      icon={<IconFlask className="h-4 w-4" />}
      actions={
        <div className="flex flex-wrap gap-1">
          {sensitivity.dims.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setDim(i)}
              className={`rounded-md border px-2 py-1 text-[10.5px] transition ${
                i === dim
                  ? "border-gold/50 bg-gold/10 text-gold"
                  : "border-line text-mist hover:text-chalk"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <div dir="ltr" className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="delta"
                tick={axisTick}
                stroke="#24344f"
                label={{ value: "Δ parameter", fill: "#8ea0bd", fontSize: 10, position: "insideBottom", offset: -2 }}
              />
              <YAxis yAxisId="l" tick={axisTick} stroke="#24344f" width={42} />
              <YAxis yAxisId="r" orientation="right" tick={axisTick} stroke="#24344f" width={42} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="l" type="monotone" dataKey="irr" name="IRR %" stroke="#e0b25c" strokeWidth={2} dot />
              <Line yAxisId="l" type="monotone" dataKey="ldr" name="p95 LDR %" stroke="#35d6a4" strokeWidth={1.8} dot />
              <Line yAxisId="r" type="monotone" dataKey="lcr" name="p5 LCR" stroke="#4ea8de" strokeWidth={1.8} dot />
              <Line yAxisId="l" type="monotone" dataKey="overturning" name="overturning %" stroke="#f4695c" strokeWidth={1.6} strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-[11px]">
            <thead className="bg-[rgba(255,255,255,0.03)] text-mist">
              <tr>
                {["Δ", "IRR", "p95 LDR", "p5 LCR", "واژگونی", "پذیرش", "موجه"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => {
                const feasible = row.ldr <= 85 && row.lcr >= 1.05 && row.irr >= 20;
                return (
                  <tr key={i} className="border-t border-line/60">
                    <td className="num px-2 py-1.5 text-gold">
                      {row.delta > 0 ? "+" : ""}
                      {fmtNum(row.delta, 2)}
                    </td>
                    <td className="num px-2 py-1.5">{fmtNum(row.irr, 2)}٪</td>
                    <td className="num px-2 py-1.5">{fmtNum(row.ldr, 2)}٪</td>
                    <td className="num px-2 py-1.5">{fmtNum(row.lcr, 2)}</td>
                    <td className="num px-2 py-1.5">{fmtNum(row.overturning, 2)}٪</td>
                    <td className="num px-2 py-1.5">{fmtNum(row.adoption, 1)}٪</td>
                    <td className="px-2 py-1.5">
                      <Badge tone={feasible ? "teal" : "rose"}>{feasible ? "بله" : "خیر"}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* RAG knowledge + benchmark registry                                  */
/* ------------------------------------------------------------------ */

export function KnowledgePanel({
  constraints,
  benchmarks,
}: {
  constraints: RegulatoryConstraint[];
  benchmarks: BenchmarkScheme[];
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel
        title="اسناد بازیابی‌شده از پایگاه دانش مقرراتی (RAG)"
        subtitle="بخشنامه‌های بانک مرکزی، قواعد عقود اسلامی و اصول حمایت از مشتری"
        icon={<IconDatabase className="h-4 w-4" />}
        actions={<Badge tone="gold">{fmtNum(constraints.length)} سند</Badge>}
      >
        <div className="max-h-[430px] space-y-2 overflow-y-auto pl-1">
          {constraints.map((c) => (
            <article key={c.id} className="panel-tight px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-[12px] font-medium text-chalk">{c.titleFa}</h4>
                <span className="num shrink-0 rounded border border-gold/30 bg-gold/10 px-1.5 text-[9.5px] text-gold">
                  {fmtPct(c.relevance, 0)}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-mist/80">
                {c.authority} · <span className="num">{c.code}</span>
              </p>
              <p className="mt-1.5 text-[11px] leading-6 text-mist">{c.bodyFa}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.binding.map((b, i) => (
                  <span
                    key={i}
                    className="num rounded border border-line bg-[rgba(255,255,255,0.03)] px-1.5 py-0.5 text-[9.5px] text-sky"
                  >
                    {b.field} {b.op} {Array.isArray(b.value) ? b.value.join("|") : String(b.value)}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[9.5px] text-mist/60">استناد: {c.citation}</p>
            </article>
          ))}
        </div>
      </Panel>

      <Panel
        title="ثبت بنچمارک محصولات بانکی ایران"
        subtitle="مهر ایران، تجارت، ملت، ملی، شهر و صندوق رفاه و درمان"
        icon={<IconCoins className="h-4 w-4" />}
        actions={<Badge tone="teal">{fmtNum(benchmarks.length)} طرح</Badge>}
      >
        <div className="max-h-[430px] overflow-y-auto pl-1">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-panel text-mist">
              <tr>
                {["بانک", "طرح", "عقد", "سقف (م.ت)", "نرخ/کارمزد", "خواب/سررسید", "γ"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((b) => (
                <tr key={b.code} className="border-t border-line/60 align-top hover:bg-[rgba(224,178,92,0.04)]">
                  <td className="whitespace-nowrap px-2 py-1.5 text-mist">{b.bank}</td>
                  <td className="px-2 py-1.5">
                    <p className="text-chalk">{b.productFa}</p>
                    <p className="text-[9.5px] text-mist/70">{b.segmentFa}</p>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-mist">{b.contractType}</td>
                  <td className="num px-2 py-1.5">{fmtNum(b.ceilingToman / 1e6)}</td>
                  <td className="num px-2 py-1.5">
                    {b.profitRate ? fmtPct(b.profitRate, 1) : b.feeRate ? fmtPct(b.feeRate, 1) : "—"}
                  </td>
                  <td className="num px-2 py-1.5">
                    {b.sleepMonths != null ? `${fmtNum(b.sleepMonths)}m` : "—"} /{" "}
                    {b.tenorMonths != null ? `${fmtNum(b.tenorMonths)}m` : "—"}
                  </td>
                  <td className="num px-2 py-1.5 text-teal">
                    {b.closedLoopRetention != null ? fmtPct(b.closedLoopRetention, 0) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* compliance + accounting                                             */
/* ------------------------------------------------------------------ */

export function CompliancePanel({
  complianceDraft,
  accountingEntries,
}: {
  complianceDraft: ComplianceDraftItem[];
  accountingEntries: AccountingEntry[];
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel
        title="پیش‌نویس انطباق مقرراتی"
        subtitle="بندهای الزامی قرارداد و دروازه‌های اعتبارسنجی"
        icon={<IconShield className="h-4 w-4" />}
        actions={<Badge tone="gold">{fmtNum(complianceDraft.length)} بند</Badge>}
      >
        <div className="max-h-[420px] space-y-2 overflow-y-auto pl-1">
          {complianceDraft.map((c) => (
            <article
              key={c.code}
              className={`rounded-lg border px-3 py-2 ${
                c.statusFa.includes("نقض") || c.statusFa.includes("نیازمند")
                  ? "border-gold/40 bg-gold/5"
                  : "border-line bg-[rgba(255,255,255,0.02)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-[11.5px] text-chalk">{c.titleFa}</h4>
                <span className="num shrink-0 text-[9.5px] text-mist/70">{c.code}</span>
              </div>
              <p className="mt-1 text-[11px] leading-6 text-mist">{c.requirementFa}</p>
              <p className="mt-1 text-[10.5px] text-teal">وضعیت: {c.statusFa}</p>
            </article>
          ))}
        </div>
      </Panel>

      <Panel
        title="سندهای حسابداری ساختار سنتزشده"
        subtitle="ثبت‌های دفتر کل برای اعطا، مسدودی، حلقه بسته و ذخیره‌گیری"
        icon={<IconCoins className="h-4 w-4" />}
      >
        <div className="max-h-[420px] overflow-y-auto pl-1">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-panel text-mist">
              <tr>
                {["رویداد", "بدهکار", "بستانکار", "مبلغ (م.ت)"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accountingEntries.map((e, i) => (
                <tr key={i} className="border-t border-line/60 align-top">
                  <td className="px-2 py-1.5">
                    <p className="text-chalk">{e.eventFa}</p>
                    <p className="text-[9.5px] text-mist/70">{e.contract}</p>
                  </td>
                  <td className="px-2 py-1.5 text-mist">{e.debitFa}</td>
                  <td className="px-2 py-1.5 text-mist">{e.creditFa}</td>
                  <td className="num whitespace-nowrap px-2 py-1.5 text-gold">
                    {fmtBToman(e.amountRial)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* executive report                                                    */
/* ------------------------------------------------------------------ */

function renderInline(text: string) {
  const parts = text.split("**");
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-gold">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function MiniMarkdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: React.ReactNode[] = [];
  let tableBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushTable = () => {
    if (!tableBuffer.length) return;
    const rows = tableBuffer
      .filter((r) => !/^\|[\s-|]+\|$/.test(r))
      .map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
    const [head, ...body] = rows;
    blocks.push(
      <div key={`tbl-${blocks.length}`} className="my-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[520px] text-[11px]">
          <thead className="bg-[rgba(255,255,255,0.03)] text-mist">
            <tr>
              {(head ?? []).map((h, i) => (
                <th key={i} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="border-t border-line/60">
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-1.5 text-mist">
                    {renderInline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableBuffer = [];
  };

  const flushList = () => {
    if (!listBuffer.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 space-y-1 pr-4">
        {listBuffer.map((item, i) => (
          <li key={i} className="relative text-[11.8px] leading-7 text-mist">
            <span className="absolute -right-3.5 top-2 h-1 w-1 rounded-full bg-gold/70" />
            {renderInline(item)}
          </li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  lines.forEach((raw) => {
    const line = raw.trimEnd();
    if (line.startsWith("|")) {
      flushList();
      tableBuffer.push(line);
      return;
    }
    flushTable();
    if (line.startsWith("### ")) {
      flushList();
      blocks.push(
        <h3 key={blocks.length} className="mt-4 mb-1 text-[12.5px] font-semibold text-gold">
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        <h2
          key={blocks.length}
          className="mt-5 mb-2 border-b border-line/70 pb-1.5 text-[13.5px] font-bold text-chalk"
        >
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      flushList();
      blocks.push(
        <h1 key={blocks.length} className="gold-text mb-2 text-[17px] font-extrabold">
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2));
    } else if (line.length === 0) {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={blocks.length} className="my-1.5 text-[11.8px] leading-7 text-mist">
          {renderInline(line)}
        </p>,
      );
    }
  });
  flushTable();
  flushList();

  return <div className="max-h-[620px] overflow-y-auto pl-2">{blocks}</div>;
}

export function ReportPanel({
  reportFa,
  reportEn,
  runId,
}: {
  reportFa: string;
  reportEn: string;
  runId?: string | null;
}) {
  const [lang, setLang] = useState<"fa" | "en">("fa");
  const source = lang === "fa" ? reportFa : reportEn;

  return (
    <Panel
      title="گزارش مدیریتی و مشخصات کامل محصول"
      subtitle="پیش‌نویس پیشنهاد اجرایی فارسی به‌همراه نسخه انگلیسی برای کمیته محصولات"
      icon={<IconDoc className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-1.5">
          {runId ? <Badge tone="violet">شناسه اجرا <span className="num">{runId.slice(0, 8)}</span></Badge> : null}
          <div className="flex overflow-hidden rounded-md border border-line">
            {(["fa", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 text-[10.5px] transition ${
                  lang === l ? "bg-gold/15 text-gold" : "text-mist hover:text-chalk"
                }`}
              >
                {l === "fa" ? "فارسی" : "EN"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([source], { type: "text/markdown;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `product-spec-${lang}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-md border border-line px-2.5 py-1 text-[10.5px] text-mist transition hover:border-gold/40 hover:text-gold"
          >
            دریافت Markdown
          </button>
        </div>
      }
    >
      <MiniMarkdown source={source} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* run history                                                         */
/* ------------------------------------------------------------------ */

export function RunHistory({
  runs,
  onPick,
  onRefresh,
}: {
  runs: RunSummary[];
  onPick: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <Panel
      title="تاریخچه اجرای‌های ذخیره‌شده در PostgreSQL"
      subtitle="ردپای کامل حسابرسی: قصد تجزیه‌شده، قیود بازیابی‌شده، ساختار، سنجه‌ها و رویدادهای گره‌ها"
      icon={<IconDatabase className="h-4 w-4" />}
      actions={
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-line px-2.5 py-1 text-[10.5px] text-mist transition hover:border-gold/40 hover:text-gold"
        >
          بازخوانی
        </button>
      }
      bodyClass="p-0"
    >
      {runs.length === 0 ? (
        <p className="px-4 py-8 text-center text-[11.5px] text-mist">
          هنوز اجرایی ذخیره نشده است. نخستین درخواست راهبردی را اجرا کنید.
        </p>
      ) : (
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-panel text-mist">
              <tr>
                {["زمان", "درخواست", "منابع", "IRR", "p95 LDR", "p5 LCR", "واژگونی", "اعتبار مدل", "گام‌ها", ""].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-line/60 hover:bg-[rgba(224,178,92,0.04)]">
                  <td className="num whitespace-nowrap px-2 py-1.5 text-mist">
                    {new Date(run.createdAt).toLocaleString("fa-IR", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="max-w-[280px] truncate px-2 py-1.5 text-chalk">{run.prompt}</td>
                  <td className="num px-2 py-1.5">{fmtNum(run.targetDeposits / 1e13, 1)} همت</td>
                  <td className="num px-2 py-1.5 text-gold">
                    {run.irrBank != null ? fmtPct(run.irrBank, 1) : "—"}
                  </td>
                  <td className="num px-2 py-1.5">{run.maxLdr != null ? fmtPct(run.maxLdr, 1) : "—"}</td>
                  <td className="num px-2 py-1.5">{run.minLcr != null ? fmtNum(run.minLcr, 2) : "—"}</td>
                  <td className="num px-2 py-1.5">
                    {run.overturningRisk != null ? fmtPct(run.overturningRisk, 1) : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge tone={run.validationStatus === "constraints_passed" ? "teal" : run.validationStatus === "not_validated" ? "rose" : "gold"}>
                      {run.validationStatus === "constraints_passed" ? "قیود پاس" : run.validationStatus === "not_validated" ? "غیرقابل‌تأیید" : "نامشخص"}
                    </Badge>
                  </td>
                  <td className="num px-2 py-1.5">{fmtNum(run.iterations)}</td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onPick(run.id)}
                      className="rounded border border-line px-2 py-0.5 text-[10px] text-mist transition hover:border-gold/40 hover:text-gold"
                    >
                      بازبینی
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
