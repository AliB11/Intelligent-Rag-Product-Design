/**
 * simorgh/advisor.ts — merged advisory layer (Simorgh adaptation).
 * ---------------------------------------------------------------------------
 * Combines the critic-auditor feasibility findings, the configurable
 * regulatory compliance report and scenario stress into prioritized, actionable
 * Persian insights — the "what should the product designer do next" panel.
 */

import type { CriticFinding, ProductSpec } from "../domain/types";
import type { AlmResult } from "../domain/types";
import type { StressSuiteResult } from "./stress";
import { checkModeCompliance, getRegulations, type ComplianceItem } from "./regulations";

export interface Insight {
  id: string;
  /** 0 critical — 3 informational. */
  priority: 0 | 1 | 2 | 3;
  level: "critical" | "warning" | "info" | "good";
  titleFa: string;
  detailFa: string;
  actionFa: string;
  source: "critic" | "regulation" | "stress" | "metrics";
}

export interface AdvisorReport {
  insights: Insight[];
  health: "healthy" | "watch" | "critical";
  compliance: { items: ComplianceItem[]; failed: number; warned: number };
}

export function buildAdvisorReport(
  product: ProductSpec,
  alm: AlmResult,
  findings: CriticFinding[],
  stress: StressSuiteResult | null,
): AdvisorReport {
  const reg = getRegulations();
  const insights: Insight[] = [];

  // 1) critic findings → insights (blockers first)
  for (const f of findings) {
    insights.push({
      id: `critic-${f.id}`,
      priority: f.severity === "blocker" ? 0 : 2,
      level: f.severity === "blocker" ? "critical" : f.severity === "warning" ? "warning" : "info",
      titleFa: f.messageFa,
      detailFa: `مشاهده ${f.observed.toFixed(3)} در برابر حد ${f.limit.toFixed(3)} — دستور تعدیل: ${f.directive.action} ${String(f.directive.field)} به بزرگی ${f.directive.magnitude.toFixed(3)}`,
      actionFa: f.directive.rationaleFa,
      source: "critic",
    });
  }

  // 2) configurable regulation compliance per mode
  for (const mode of product.modes) {
    const report = checkModeCompliance(
      {
        nameFa: mode.nameFa,
        contract: mode.contract,
        loanRate: mode.loanRate,
        installmentToIncome: mode.installmentToIncome,
        blockedRatio: mode.blockedRatio,
      },
      reg,
    );
    for (const item of report.items) {
      if (item.level === "pass") continue;
      insights.push({
        id: `reg-${mode.id}-${item.id}`,
        priority: item.level === "fail" ? 0 : 2,
        level: item.level === "fail" ? "critical" : "warning",
        titleFa: item.titleFa,
        detailFa: item.detailFa,
        actionFa: `سقف پیکربندی‌شده فعلی: نرخ مبادله‌ای ${(reg.loanRateCap * 100).toFixed(1)}٪ · قرض‌الحسنه ${(reg.qardFeeCap * 100).toFixed(1)}٪ · DTI ${(reg.dtiCap * 100).toFixed(0)}٪`,
        source: "regulation",
      });
    }
  }

  // 3) stress weakest link
  if (stress) {
    const worst = stress.runs.find((r) => r.scenario.id === stress.worstScenario);
    if (worst) {
      insights.push({
        id: "stress-worst",
        priority: stress.feasibleInAll ? 3 : 1,
        level: stress.feasibleInAll ? "good" : "warning",
        titleFa: stress.feasibleInAll
          ? `مقاوم در هر ۷ سناریو — بدترین حالت «${worst.scenario.labelFa}» هم در حد مجاز`
          : `ضعیف‌ترین سناریو: «${worst.scenario.labelFa}»`,
        detailFa: `p95 LDR ${(worst.p95Ldr * 100).toFixed(1)}٪ · p5 LCR ${worst.p5Lcr.toFixed(2)} · واژگونی ${(worst.overturningShock * 100).toFixed(2)}٪`,
        actionFa: stress.feasibleInAll
          ? "آماده عرضه از منظر سناریوهای کلان؛ پایش فصلی توصیه می‌شود."
          : "افزایش مسدودی پلکانی و ماندگاری حلقه بسته برای مهار سناریوی بحرانی.",
        source: "stress",
      });
    }
  }

  // 4) metric headlines
  const m = alm.metrics;
  if (m.irrValidPathShare < 0.9) {
    insights.push({
      id: "metrics-irr-validity",
      priority: 2,
      level: "warning",
      titleFa: `تنها ${(m.irrValidPathShare * 100).toFixed(0)}٪ مسیرهای مونت‌کارلو IRR معتبر داشتند`,
      detailFa: "نوسان جریان نقد در برخی مسیرها جواب IRR داخل بازه نمی‌دهد؛ نشانه پرنوسانی بودن درآمد.",
      actionFa: "افزایش γ و متنوع‌سازی منابع برای هموارسازی جریان نقد.",
      source: "metrics",
    });
  }
  if (m.netLiquidityDrainRatio <= 0.02) {
    insights.push({
      id: "metrics-drain-good",
      priority: 3,
      level: "good",
      titleFa: `خالص خروج نقدینگی ناچیز (${(m.netLiquidityDrainRatio * 100).toFixed(2)}٪)`,
      detailFa: "حلقه بسته منابع عملاً نشتی اعطا را جبران می‌کند.",
      actionFa: "این مزیت را در پیش‌نویس انطباق و بازاریابی برجسته کنید.",
      source: "metrics",
    });
  }

  insights.sort((a, b) => a.priority - b.priority);
  const failed = insights.filter((i) => i.level === "critical").length;
  const warned = insights.filter((i) => i.level === "warning").length;
  return {
    insights,
    health: failed ? "critical" : warned ? "watch" : "healthy",
    compliance: { items: [], failed, warned },
  };
}
