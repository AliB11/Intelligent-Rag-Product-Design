"use client";

/**
 * ProductDossierPanel — RTL/Persian auditable product dossier (Phase 5).
 * Visualises: solved parameters, ALM & profitability metrics, the
 * Base/+20% run-off/+3pp NPL/+15pp cannibalization stress matrix,
 * cannibalization impact, the compliance & grounding ledger with the
 * Compliance Audit Badge, and the committee audit log with the structured
 * CRITIQUE. All figures render LTR inside the RTL layout.
 */

import type { ProductDossier } from "@/lib/dossier/productDossier";
import {
  Badge,
  IconCoins,
  IconDoc,
  IconFlask,
  IconScale,
  IconShield,
  Panel,
  Stat,
  fmtCompact,
  fmtNum,
  fmtPct,
} from "./ui";

const num = (v: number, digits = 2) => fmtNum(v, digits);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5 last:border-0">
      <span className="text-[12px] text-mist">{label}</span>
      <span className="num text-[13px] font-medium text-ink" dir="ltr">
        {value}
      </span>
    </div>
  );
}

export default function ProductDossierPanel({ dossier }: { dossier: ProductDossier | null }) {
  if (!dossier) {
    return (
      <Panel title="دوسیه محصول" icon={<IconDoc className="h-4 w-4" />}>
        <p className="px-4 py-6 text-center text-[13px] text-mist">
          دوسیه برای این اجرا در دسترس نیست؛ یک تولید جدید اجرا کنید تا دوسیه کامل صادر شود.
        </p>
      </Panel>
    );
  }

  const {
    product,
    optimalSpec,
    almProfitability: m,
    cannibalization: cann,
    stressMatrix,
    compliance: c,
    committeeAuditLog: log,
    decisionDiagnostics: diag,
  } = dossier;
  const s = optimalSpec.solution;
  const passed = c.validationStatus === "constraints_passed";
  const usury = c.hiddenUsury.solverFlagged || c.hiddenUsury.designFlagged;
  const splitTotal = Math.max(1e-9, cann.netNewMoneyRial + cann.migratedRial);
  const nnmPct = (100 * cann.netNewMoneyRial) / splitTotal;
  const migPct = 100 - nnmPct;
  const confTone = diag.decisionConfidence >= 0.85 ? "teal" : diag.decisionConfidence >= 0.6 ? "gold" : "rose";
  const bindingLabel: Record<string, string> = {
    bank_irr_target: "کف IRR بانک",
    borrower_rate_cap: "سقف نرخ مؤثر وام‌گیرنده",
    liquidity_gap_limit: "سقف شکاف نقدینگی",
    customer_floor: "کف رقابت سپرده",
    loan_rate_ceiling: "سقف نرخ تسهیلات",
    fee_ceiling: "سقف کارمزد",
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Compliance Audit Badge + header */}
      <Panel
        title={`دوسیه محصول — ${product.titleFa}`}
        subtitle={`کد ${product.code} · ${fmtCompact(product.targetDepositsRial)} منبع هدف · ${product.modeCount} طرح`}
        icon={<IconShield className="h-4 w-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={confTone}>
              {`اطمینان تصمیم ${fmtPct(diag.decisionConfidence, 0)}`}
            </Badge>
            <Badge tone={passed ? "teal" : "rose"}>
              {passed ? "نشان انطباق: قیود پاس" : "نشان انطباق: غیرقابل‌تأیید"}
            </Badge>
            <Badge tone={usury ? "rose" : "teal"}>
              {usury ? "شکاف ربا پنهان: هشدار" : "ربا پنهان: پاک"}
            </Badge>
            <Badge tone={optimalSpec.feasible ? "teal" : "gold"}>
              {optimalSpec.feasible ? "حل معکوس: ممکن" : `حل معکوس: ${optimalSpec.violations.length} نقض`}
            </Badge>
          </div>
        }
      >
        <div className="grid gap-2 px-4 py-3 md:grid-cols-4">
          <Stat
            label="IRR بانک (سالانه)"
            value={fmtPct(m.bankIrrAnnual)}
            tone="teal"
            ok={optimalSpec.feasible}
            hint="از جریان‌های اقتصادی کوهرت"
          />
          <Stat
            label="IRR مؤثر وام‌گیرنده"
            value={fmtPct(m.customerEffectiveIrr)}
            tone={m.customerNominalIrr > c.hiddenUsury.effectiveRateCap ? "rose" : "sky"}
            limit={`سقف مؤثر ${fmtPct(c.hiddenUsury.effectiveRateCap, 0)}`}
            ok={m.customerNominalIrr <= c.hiddenUsury.effectiveRateCap + 1e-9}
            hint={`.nominal ${fmtPct(m.customerNominalIrr)}`}
          />
          <Stat label="هزینه حاشیه‌ای تأمین (MCoF)" value={fmtPct(m.marginalCostOfFunds)} tone="gold" />
          <Stat
            label="خالص NII پس از مهاجرت"
            value={fmtCompact(m.netNiiPostCannibalization)}
            tone="violet"
            hint={`ریسک‌تنظیم‌شده: ${fmtCompact(m.riskAdjustedNiiRial)}`}
          />
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Optimal product spec — the seven solved variables */}
        <Panel
          title="۱) مشخصات بهینه — بردار حل معکوس"
          subtitle={`هدف IRR بانک · ${optimalSpec.evaluations} ارزیابی · ${fmtNum(optimalSpec.elapsedMs, 0)} میلی‌ثانیه`}
          icon={<IconScale className="h-4 w-4" />}
        >
          <div className="px-4 py-2">
            <Row label="دوره ماندگاری سپرده (T_wait)" value={`${s.depositRetentionMonths} ماه`} />
            <Row label="ضریب تسهیلات به سپرده (M)" value={num(s.loanToDepositMultiplier)} />
            <Row label="سهم سپرده مسدودی (B)" value={fmtPct(s.blockedDepositPct, 1)} />
            <Row label="نرخ سود تسهیلات (r_loan)" value={fmtPct(s.loanInterestRate)} />
            <Row label="نرخ سود سپرده (r_dep)" value={fmtPct(s.depositInterestRate)} />
            <Row label="نرخ کارمزد (fee)" value={fmtPct(s.feeRate)} />
            <Row label="دوره بازپرداخت (N)" value={`${s.repaymentMonths} ماه`} />
            <Row
              label="ماه سر به سر / بدترین شکاف تجمعی"
              value={`${m.breakevenMonth ?? "—"} / ${fmtCompact(m.worstCumulativeGapRial)}`}
            />
            <Row
              label="هدف IRR درخواستی ← مرز ممکن تأییدشده"
              value={`${fmtPct(diag.requestedTargetIrr, 1)} ← ${fmtPct(diag.finalTargetIrr, 2)}`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-mist">بندهای الزام‌آور:</span>
              {diag.binding.length ? (
                diag.binding.map((b) => (
                  <Badge key={b} tone="gold">
                    {bindingLabel[b] ?? b}
                  </Badge>
                ))
              ) : (
                <Badge tone="teal">هیچ قیدی در مرز نیست — فضای مانور باز</Badge>
              )}
              {diag.recalibrated ? <Badge tone="violet">بازتنظیم بازخوردی مرزی</Badge> : null}
            </div>
            {optimalSpec.violations.length > 0 ? (
              <p className="mt-2 rounded-lg bg-rose/10 px-3 py-2 text-[11px] leading-5 text-rose">
                نقض‌ها: {optimalSpec.violations.join(" · ")}
              </p>
            ) : null}
          </div>
        </Panel>

        {/* Stress-test matrix */}
        <Panel
          title="۲) ماتریس آزمون تنش"
          subtitle={`سقف شکاف ${fmtCompact(stressMatrix.gapLimitRial)} · ${
            stressMatrix.allRespectGapLimit ? "همه سناریوها داخل سقف" : "نقض سقف"
          }`}
          icon={<IconFlask className="h-4 w-4" />}
        >
          <div className="overflow-x-auto px-2 py-2">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[11px] text-mist">
                  <th className="px-2 py-1.5 text-right font-medium">سناریو</th>
                  <th className="px-2 py-1.5 text-left font-medium">شکاف تجمعی</th>
                  <th className="px-2 py-1.5 text-left font-medium">سر به سر</th>
                  <th className="px-2 py-1.5 text-left font-medium">خالص جریان</th>
                  <th className="px-2 py-1.5 text-center font-medium">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {stressMatrix.scenarios.map((sc) => (
                  <tr key={sc.id} className="border-t border-line/60">
                    <td className="px-2 py-2 text-right">
                      <span className="text-ink">{sc.labelFa}</span>
                      {sc.id === stressMatrix.worstScenarioId ? (
                        <Badge tone="rose" className="mr-2">
                          بدترین
                        </Badge>
                      ) : null}
                    </td>
                    <td className="num px-2 py-2 text-left" dir="ltr">
                      {fmtCompact(sc.worstCumulativeGapRial)}
                    </td>
                    <td className="num px-2 py-2 text-left" dir="ltr">
                      {sc.breakevenMonth ?? "—"}
                    </td>
                    <td className="num px-2 py-2 text-left" dir="ltr">
                      {fmtCompact(sc.netCashflowRial)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Badge tone={sc.breachedGapLimit ? "rose" : "teal"}>
                        {sc.breachedGapLimit ? "نقض" : "سالم"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Cannibalization impact */}
        <Panel
          title="۳) تأثیر مهاجرت سپرده (Cannibalization)"
          subtitle={`α = ${fmtPct(cann.rate, 0)} · MCoF ${fmtPct(cann.marginalCostOfFunds)} · گسترش از دست‌رفته ${fmtCompact(
            cann.lostSpreadOnCannibalizedRial,
          )}`}
          icon={<IconCoins className="h-4 w-4" />}
        >
          <div className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-[11px] text-mist">
              <span>منابع نو (NNM) — {fmtPct(nnmPct / 100, 1)}</span>
              <span>منابع مهاجرت‌شده — {fmtPct(migPct / 100, 1)}</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-line/70" dir="ltr">
              <div
                className="h-full bg-teal/80"
                style={{ width: `${Math.max(0, Math.min(100, nnmPct))}%` }}
              />
              <div
                className="h-full bg-gold/80"
                style={{ width: `${Math.max(0, Math.min(100, migPct))}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] leading-5 text-mist" dir="ltr">
              {`${fmtCompact(cann.netNewMoneyRial)} NNM @ ${fmtPct(cann.newMoneyCostOfFunds)} · ${fmtCompact(
                cann.migratedRial,
              )} migrated @ ${fmtPct(cann.sourceCostOfFunds)}`}
            </p>
            <div className="mt-2">
              <Row label="خالص NII پس از مهاجرت" value={fmtCompact(m.netNiiPostCannibalization)} />
              <Row label="NII تعدیل‌شده ریسک" value={fmtCompact(m.riskAdjustedNiiRial)} />
              <Row label="بازده سود سپرده مشتری" value={fmtPct(m.customerDepositYield)} />
              <Row label="بدترین شکاف ماهانه" value={fmtCompact(m.worstMonthlyGapRial)} />
            </div>
          </div>
        </Panel>

        {/* Compliance & grounding ledger */}
        <Panel
          title="۴) دفتر انطباق و استناد"
          subtitle={`${c.constraintCount} قید استخراج‌شده · ${c.envelope.citations.length} استناد پایه‌گذاری`}
          icon={<IconShield className="h-4 w-4" />}
        >
          <div className="px-4 py-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="سقف نرخ تسهیلات"
                value={fmtPct(c.envelope.max_loan_interest_rate, 0)}
                tone="sky"
              />
              <Stat label="سقف کارمزد" value={fmtPct(c.envelope.max_fee_rate, 0)} tone="sky" />
              <Stat
                label="کف ذخیره قانونی"
                value={fmtPct(c.envelope.min_reserve_ratio, 0)}
                tone="sky"
              />
              <Stat
                label="وثیقه سپرده مسدودی"
                value={c.envelope.allow_blocked_deposit_collateral ? "مجاز" : "ممنوع"}
                tone={c.envelope.allow_blocked_deposit_collateral ? "teal" : "rose"}
              />
            </div>
            <div className="mt-3 space-y-1.5">
              {c.envelope.citations.slice(0, 4).map((cit, i) => (
                <div
                  key={`${cit.doc_id}-${i}`}
                  className="rounded-lg border border-line/60 bg-[rgba(255,255,255,0.015)] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-[11px] text-gold" dir="ltr">
                      {cit.doc_id}
                    </span>
                    <span className="num text-[10px] text-mist" dir="ltr">
                      {cit.clause}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-5 text-mist">{cit.summary}</p>
                </div>
              ))}
              {c.envelope.citations.length === 0 ? (
                <p className="text-[11px] text-mist">استنادی ثبت نشده است.</p>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>

      {/* Committee audit log */}
      <Panel
        title="۵) گزارش کمیته — چرخه نقد و خوداصلاحی"
        subtitle={`${log.iterations.length} گام از سقف ${log.maxIterations} · ${log.traceEventCount} رویداد ردیابی`}
        icon={<IconDoc className="h-4 w-4" />}
      >
        <div className="px-4 py-3">
          <div
            className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2.5 text-[12px] leading-6 text-ink"
            dir="ltr"
          >
            {log.critique}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[11px] text-mist">
                  <th className="px-2 py-1.5 text-right font-medium">گام</th>
                  <th className="px-2 py-1.5 text-left font-medium">IRR</th>
                  <th className="px-2 py-1.5 text-left font-medium">p95 LDR</th>
                  <th className="px-2 py-1.5 text-left font-medium">p5 LCR</th>
                  <th className="px-2 py-1.5 text-center font-medium">یافته‌ها</th>
                  <th className="px-2 py-1.5 text-center font-medium">دستورات</th>
                  <th className="px-2 py-1.5 text-center font-medium">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {log.iterations.map((it) => (
                  <tr key={it.iteration} className="border-t border-line/60">
                    <td className="num px-2 py-2 text-right" dir="ltr">
                      {it.iteration}
                    </td>
                    <td className="num px-2 py-2 text-left" dir="ltr">
                      {fmtPct(it.irrAnnual)}
                    </td>
                    <td className="num px-2 py-2 text-left" dir="ltr">
                      {fmtPct(it.p95Ldr, 1)}
                    </td>
                    <td className="num px-2 py-2 text-left" dir="ltr">
                      {num(it.p5Lcr)}
                    </td>
                    <td className="num px-2 py-2 text-center" dir="ltr">
                      {it.findingCount}
                      {it.blockerCount > 0 ? ` (${it.blockerCount})` : ""}
                    </td>
                    <td className="num px-2 py-2 text-center" dir="ltr">
                      {it.directivesApplied}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Badge tone={it.feasible ? "teal" : "rose"}>
                        {it.feasible ? "پاس" : "نقض"}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {log.iterations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-3 text-center text-[11px] text-mist">
                      در نخستین گام قیود پاس شدند؛ حلقه خوداصلاحی وارد نشد.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-mist">
            گره‌های کمیته: {log.committeeNodes.join("، ")}
          </p>
        </div>
      </Panel>
    </div>
  );
}
