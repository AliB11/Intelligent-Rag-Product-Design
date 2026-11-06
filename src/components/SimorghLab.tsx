"use client";

import { useState } from "react";
import type { SimorghReport } from "@/lib/agents/state";
import {
  Badge,
  EmptyState,
  IconFlask,
  Panel,
  fmtNum,
  fmtPct,
} from "./ui";

const SOURCE_LABEL: Record<string, string> = {
  critic: "ممیز",
  regulation: "مقررات",
  stress: "سناریو",
  metrics: "سنجه",
};

const LEVEL_TONE: Record<string, "rose" | "gold" | "teal" | "sky"> = {
  critical: "rose",
  warning: "gold",
  info: "sky",
  good: "teal",
};

/** Per-class customer estimator inputs (Simorgh calculator). */
interface CalcState {
  productClass: "instalment" | "qh" | "revolving" | "points";
  amount: number;
  tenor: number;
  rate: number;
  income: number;
  deposit: number;
  holding: number;
}

/** Simorgh lab: metrics, tier table, 7 scenarios, advisor, calculator, compare. */
export default function SimorghLab({
  report,
  estimate,
}: {
  report: SimorghReport | null;
  estimate: (input: { prompt: string }) => void;
}) {
  const [calc, setCalc] = useState<CalcState>({
    productClass: "instalment",
    amount: 300,
    tenor: 36,
    rate: 23,
    income: 40,
    deposit: 200,
    holding: 8,
  });
  const [calcOut, setCalcOut] = useState<string | null>(null);
  const [showAllInsights, setShowAllInsights] = useState(false);

  if (!report) {
    return (
      <Panel title="آزمایشگاه سیمرغ" icon={<IconFlask className="h-4 w-4" />}>
        <EmptyState
          title="آزمایشگاه سیمرغ برای این اجرا در دسترس نیست"
          hint="پس از اجرای خط لوله، سناریوهای کلان، جمعیت مصنوعی، APR/NPL/VaR/IRB و مشاور اینجا نمایش داده می‌شود."
          icon={<IconFlask className="h-6 w-6" />}
        />
      </Panel>
    );
  }

  const runEstimate = () => {
    const cls = calc.productClass;
    const rate = calc.rate / 100;
    if (cls === "points") {
      const limit = 0.35 * calc.deposit * (calc.holding / Math.max(1, calc.tenor));
      setCalcOut(
        `سقف امتیازی تخمینی: ${fmtNum(limit, 1)} م.ت (k=۰٫۳۵، مانده ${fmtNum(calc.deposit)} م.ت، ${calc.holding} ماه ماندگاری)`,
      );
      return;
    }
    if (cls === "revolving") {
      const eff = (Math.pow(1 + rate / 12, 12) - 1) * 100;
      const burden = calc.amount * 0.6 * rate;
      setCalcOut(
        `APR مؤثر گردشی ~${eff.toFixed(1)}٪ · بار ماهانه با استفاده ۶۰٪: ${fmtNum(burden, 1)} م.ت (+ اقساط جاری شما)`,
      );
      return;
    }
    const isQh = cls === "qh";
    const r = isQh ? 0 : rate / 12;
    const n = Math.max(1, calc.tenor);
    const pay = r < 1e-9 ? calc.amount / n : (calc.amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const feePct = isQh ? calc.rate : 0;
    const total = pay * n + calc.amount * (feePct / 100) * (isQh ? 1 : 0);
    const dti = (pay + 0) / Math.max(1, calc.income);
    setCalcOut(
      `قسط ماهانه: ${fmtNum(pay, 1)} م.ت · کل بازپرداخت: ${fmtNum(total, 1)} م.ت · ${isQh ? `کارمزد ${fmtNum(feePct, 1)}٪ پیش‌دریافت` : "annuity"} · نسبت به درآمد ${fmtPct(dti, 0)}${dti > 0.4 ? " — بالای سقف ۴۰٪" : ""}`,
    );
  };

  const m = report.metrics;
  const insights = showAllInsights ? report.advisor.insights : report.advisor.insights.slice(0, 6);

  return (
    <div className="space-y-4">
      <Panel
        title="آزمایشگاه سیمرغ — سنجه‌های پیشرفته"
        subtitle="APR مؤثر · NPL فصلی · VaR95 جریان نقد · سرمایه IRB بازل · بازده واقعی پس از تورم · شمول مالی و شکاف دهکی"
        icon={<IconFlask className="h-4 w-4" />}
        actions={
          <Badge tone={report.advisor.health === "healthy" ? "teal" : report.advisor.health === "watch" ? "gold" : "rose"}>
            سلامت مشاور: {report.advisor.health === "healthy" ? "سالم" : report.advisor.health === "watch" ? "پایش" : "بحرانی"}
          </Badge>
        }
      >
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-4">
          {[
            { label: "APR مؤثر", value: `${fmtNum(m.aprPct, 1)}٪`, hint: "نرخ سالانه مؤثر نماینده" },
            { label: "NPL فصلی", value: fmtPct(m.nplRatio, 2), hint: "بر پایه PD وزنی × منحنی فصلی" },
            { label: "VaR95 جریان نقد", value: `${fmtNum(m.var95NetIncomeRial / 1e9, 0)} میلیارد ریال`, hint: "صدک ۵ مسیر تجمعی" },
            { label: "سرمایه IRB بازل", value: fmtPct(m.irbCapitalRate, 2), hint: "K خرده‌فروشی" },
            { label: "بازده واقعی سالانه", value: fmtPct(m.realReturnAnnual, 1), hint: "پس از کسر تورم مبنا" },
            { label: "نمره شمول مالی", value: fmtPct(m.inclusionScore, 0), hint: "دسترسی دو دهک پایین" },
            { label: "شکاف دهکی", value: fmtPct(m.decileGap, 0), hint: "تفاضل پذیرش بالا/پایین" },
            { label: "الگوی شروع", value: report.template ? `${report.template.emoji} ${report.template.nameFa}` : "—", hint: "قالب ۱۷گانه سیمرغ" },
          ].map((s) => (
            <div key={s.label} className="panel-tight p-3">
              <p className="text-[10px] text-mist/70">{s.label}</p>
              <p className="num mt-0.5 text-[14px] font-bold text-chalk">{s.value}</p>
              <p className="mt-1 text-[9.5px] leading-4 text-mist/60">{s.hint}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="جدول پله‌های رتبه اعتباری (پricing به تفکیک رتبه)"
        subtitle={`${fmtNum(report.population.size)} مشتری مصنوعی قطعی (seed ${fmtNum(report.population.seed)}) · نرخ پذیرش کل ${fmtPct(report.population.approvalRate, 0)} · PD وزنی ${fmtPct(report.population.weightedPd, 2)}`}
        icon={<IconFlask className="h-4 w-4" />}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-right text-[11px]">
            <thead>
              <tr className="border-b border-line/70 text-mist/80">
                <th className="px-2 py-2 font-medium">پله</th>
                <th className="px-2 py-2 font-medium">سهم جامعه</th>
                <th className="px-2 py-2 font-medium">نرخ پذیرش</th>
                <th className="px-2 py-2 font-medium">PD پایه</th>
                <th className="px-2 py-2 font-medium">شاخص قیمت‌گذاری</th>
              </tr>
            </thead>
            <tbody>
              {report.population.tiers.map((t) => (
                <tr key={t.labelFa} className="border-b border-line/40">
                  <td className="px-2 py-2 text-chalk">{t.labelFa}</td>
                  <td className="num px-2 py-2 text-mist">{fmtPct(t.share, 0)}</td>
                  <td className="num px-2 py-2">
                    <span className={t.approval > 0.5 ? "text-teal" : t.approval > 0.2 ? "text-gold" : "text-rose"}>
                      {fmtPct(t.approval, 0)}
                    </span>
                  </td>
                  <td className="num px-2 py-2 text-mist">{fmtPct(t.pd, 1)}</td>
                  <td className="num px-2 py-2 text-mist">{fmtNum(t.pricingIndex, 2)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="آزمون تنش ۷ سناریوی کلان"
        subtitle={`${fmtNum(report.stress.pathsPerScenario)} مسیر مونت‌کارلو در هر سناریو · ${report.stress.feasibleInAll ? "همه موجه ✓" : `ضعیف‌ترین: ${report.stress.worstScenario}`}`}
        icon={<IconFlask className="h-4 w-4" />}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-right text-[11px]">
            <thead>
              <tr className="border-b border-line/70 text-mist/80">
                <th className="px-2 py-2 font-medium">سناریو</th>
                <th className="px-2 py-2 font-medium">IRR</th>
                <th className="px-2 py-2 font-medium">p95 LDR</th>
                <th className="px-2 py-2 font-medium">p5 LCR</th>
                <th className="px-2 py-2 font-medium">واژگونی</th>
                <th className="px-2 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {report.stress.runs.map((r) => (
                <tr key={r.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-chalk">{r.labelFa}</td>
                  <td className="num px-2 py-2 text-mist">{fmtPct(r.irrBankAnnual, 1)}</td>
                  <td className="num px-2 py-2 text-mist">{fmtPct(r.p95Ldr, 1)}</td>
                  <td className="num px-2 py-2 text-mist">{fmtNum(r.p5Lcr, 2)}</td>
                  <td className="num px-2 py-2 text-mist">{fmtPct(r.overturningShock, 2)}</td>
                  <td className="px-2 py-2">
                    <Badge tone={r.feasible ? "teal" : "rose"}>{r.feasible ? "موجه" : "نقض"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="مشاور سیمرغ — بینش‌های قابل اقدام"
        subtitle="تلفیق ممیز + مقررات پیکربندی‌شده + سناریوها + سنجه‌ها"
        icon={<IconFlask className="h-4 w-4" />}
        actions={
          report.advisor.insights.length > 6 ? (
            <button
              type="button"
              onClick={() => setShowAllInsights((v) => !v)}
              className="rounded-md border border-line px-2 py-1 text-[10px] text-mist transition hover:text-gold"
            >
              {showAllInsights ? "نمایش کمتر" : `نمایش همه (${fmtNum(report.advisor.insights.length)})`}
            </button>
          ) : null
        }
      >
        {insights.length === 0 ? (
          <p className="text-[11px] text-mist/70">بینش فعالی نیست — ساختار در وضعیت سالم است.</p>
        ) : (
          <ul className="space-y-1.5">
            {insights.map((i) => (
              <li key={i.id} className="panel-tight px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={LEVEL_TONE[i.level] ?? "sky"}>{SOURCE_LABEL[i.source] ?? i.source}</Badge>
                  <span className="text-[11.5px] font-medium text-chalk">{i.titleFa}</span>
                </div>
                <p className="mt-1 text-[10.5px] leading-5 text-mist">{i.detailFa}</p>
                <p className="mt-0.5 text-[10px] leading-5 text-gold/90">اقدام: {i.actionFa}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="محاسبه‌گر مشتری (تخمینی، بدون ذخیره ورودی)"
        subtitle="چهار کلاس: اقساطی / قرض‌الحسنه / گردشی / امتیازی — مطابق فرم‌های سیمرغ"
        icon={<IconFlask className="h-4 w-4" />}
        actions={
          <button
            type="button"
            onClick={() => estimate({ prompt: "محاسبه‌گر: سناریوی فعلی محصول را با ورودی مشتری نمونه بازتولید کن" })}
            className="rounded-md border border-gold/35 bg-gold/10 px-2 py-1 text-[10px] text-gold transition hover:bg-gold/20"
          >
            افزودن به گزارش
          </button>
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] text-mist">
            کلاس
            <select
              dir="ltr"
              value={calc.productClass}
              onChange={(e) => setCalc((c) => ({ ...c, productClass: e.target.value as CalcState["productClass"] }))}
              className="rounded-md border border-line bg-ink px-2 py-1.5 text-[11px] text-chalk outline-none"
            >
              <option value="instalment">اقساطی</option>
              <option value="qh">قرض‌الحسنه</option>
              <option value="revolving">گردشی</option>
              <option value="points">امتیازی</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-mist">
            مبلغ (م.ت)
            <input
              type="number"
              dir="ltr"
              value={calc.amount}
              onChange={(e) => setCalc((c) => ({ ...c, amount: Number(e.target.value) }))}
              className="num w-24 rounded-md border border-line bg-ink px-2 py-1.5 text-[11px] text-chalk outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-mist">
            سررسید (ماه)
            <input
              type="number"
              dir="ltr"
              value={calc.tenor}
              onChange={(e) => setCalc((c) => ({ ...c, tenor: Number(e.target.value) }))}
              className="num w-20 rounded-md border border-line bg-ink px-2 py-1.5 text-[11px] text-chalk outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-mist">
            نرخ/کارمزد (٪)
            <input
              type="number"
              dir="ltr"
              value={calc.rate}
              onChange={(e) => setCalc((c) => ({ ...c, rate: Number(e.target.value) }))}
              className="num w-20 rounded-md border border-line bg-ink px-2 py-1.5 text-[11px] text-chalk outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-mist">
            درآمد (م.ت/ماه)
            <input
              type="number"
              dir="ltr"
              value={calc.income}
              onChange={(e) => setCalc((c) => ({ ...c, income: Number(e.target.value) }))}
              className="num w-20 rounded-md border border-line bg-ink px-2 py-1.5 text-[11px] text-chalk outline-none"
            />
          </label>
          <button
            type="button"
            onClick={runEstimate}
            className="rounded-lg border border-gold/45 bg-gold/15 px-3 py-2 text-[11px] text-gold transition hover:bg-gold/25"
          >
            محاسبه
          </button>
        </div>
        {calcOut ? (
          <p className="num mt-2 rounded-md border border-line/70 bg-[rgba(4,7,13,0.6)] px-3 py-2 text-[11px] text-chalk">
            {calcOut}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
