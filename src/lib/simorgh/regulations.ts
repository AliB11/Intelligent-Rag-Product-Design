/**
 * simorgh/regulations.ts — configurable regulatory rulebook (Simorgh adaptation).
 * ---------------------------------------------------------------------------
 * All thresholds the advisor checks are read from ONE mutable rulebook (in-memory,
 * optionally persisted later) so the compliance text can never cite a stale cap.
 * Defaults mirror the Money & Credit Council caps encoded in domain/constants.
 */

import { REGULATORY } from "../domain/constants";

export interface Regulations {
  /** Maximum exchange-contract profit rate (fraction, e.g. 0.23). */
  loanRateCap: number;
  /** Maximum QH commission (fraction). */
  qardFeeCap: number;
  /** Absolute ceiling for special guaranteed instruments (fraction). */
  absoluteCap: number;
  /** Gam discount cap (fraction). */
  gamCap: number;
  /** p95 net LDR ceiling. */
  ldrCeiling: number;
  /** p5 LCR floor. */
  lcrFloor: number;
  /** Installment-to-income (DTI) cap. */
  dtiCap: number;
  /** Micro-loan individual cap, million toman. */
  microLoanCap: number;
  /** Baseline annual inflation used for real-return (fraction). */
  inflation: number;
  /** Compensating-deposit ban (always enforced — CBI prohibition). */
  compensatingDepositBan: boolean;
  updatedAt: string;
}

const INFLATION_DEFAULT = 0.36;

let current: Regulations = {
  loanRateCap: REGULATORY.morabahaMaxRate,
  qardFeeCap: REGULATORY.qarzHasanehMaxCommission,
  absoluteCap: REGULATORY.absoluteRateCeiling,
  gamCap: 0.19,
  ldrCeiling: REGULATORY.ldrCeiling,
  lcrFloor: REGULATORY.lcrFloor,
  dtiCap: REGULATORY.installmentToIncomeCeiling,
  microLoanCap: 2000,
  inflation: INFLATION_DEFAULT,
  compensatingDepositBan: true,
  updatedAt: new Date(0).toISOString(),
};

export function getRegulations(): Regulations {
  return { ...current };
}

export function setRegulations(patch: Partial<Regulations>): Regulations {
  const next: Regulations = { ...current, ...patch, updatedAt: new Date().toISOString() };
  // hard floors: the regulatory core can never be loosened below CBI defaults
  next.loanRateCap = Math.min(next.loanRateCap, REGULATORY.morabahaMaxRate);
  next.qardFeeCap = Math.min(next.qardFeeCap, REGULATORY.qarzHasanehMaxCommission);
  next.absoluteCap = Math.min(next.absoluteCap, REGULATORY.absoluteRateCeiling);
  next.ldrCeiling = Math.min(next.ldrCeiling, REGULATORY.ldrCeiling);
  next.lcrFloor = Math.max(next.lcrFloor, REGULATORY.lcrFloor);
  next.dtiCap = Math.min(next.dtiCap, REGULATORY.installmentToIncomeCeiling);
  next.compensatingDepositBan = true;
  current = next;
  return { ...current };
}

export function resetRegulations(): Regulations {
  current = {
    loanRateCap: REGULATORY.morabahaMaxRate,
    qardFeeCap: REGULATORY.qarzHasanehMaxCommission,
    absoluteCap: REGULATORY.absoluteRateCeiling,
    gamCap: 0.19,
    ldrCeiling: REGULATORY.ldrCeiling,
    lcrFloor: REGULATORY.lcrFloor,
    dtiCap: REGULATORY.installmentToIncomeCeiling,
    microLoanCap: 2000,
    inflation: INFLATION_DEFAULT,
    compensatingDepositBan: true,
    updatedAt: new Date(0).toISOString(),
  };
  return { ...current };
}

export function capForContract(contract: string, reg: Regulations = getRegulations()): number {
  if (contract === "qarz-hasaneh") return reg.qardFeeCap;
  if (contract === "gam") return reg.gamCap;
  return reg.loanRateCap;
}

export interface ComplianceItem {
  id: string;
  level: "pass" | "warn" | "fail";
  titleFa: string;
  detailFa: string;
  refFa: string;
}

export interface ComplianceReport {
  items: ComplianceItem[];
  failed: number;
  warned: number;
  passed: number;
}

/** Compliance of one mode against the configurable rulebook. */
export function checkModeCompliance(
  mode: { nameFa: string; contract: string; loanRate: number; installmentToIncome: number; blockedRatio: number },
  reg: Regulations = getRegulations(),
): ComplianceReport {
  const items: ComplianceItem[] = [];
  const add = (id: string, level: ComplianceItem["level"], titleFa: string, detailFa: string, refFa: string) =>
    items.push({ id, level, titleFa, detailFa, refFa });
  const pct = (v: number) => `${(v * 100).toFixed(1)}٪`;
  const cap = capForContract(mode.contract, reg);

  if (mode.loanRate > cap + 1e-9) {
    add("rate_cap", "fail", `سقف نرخ «${mode.nameFa}»`, `نرخ ${pct(mode.loanRate)} از سقف ${pct(cap)} بیشتر است؛ تخلف محسوب می‌شود.`, "مصوبه شورای پول و اعتبار");
  } else {
    add("rate_cap", "pass", `سقف نرخ «${mode.nameFa}»`, `نرخ ${pct(mode.loanRate)} ≤ سقف ${pct(cap)}.`, "مصوبه شورای پول و اعتبار");
  }
  if (mode.installmentToIncome > reg.dtiCap + 1e-9) {
    add("dti", "fail", `توان بازپرداخت «${mode.nameFa}»`, `قسط به درآمد ${pct(mode.installmentToIncome)} از سقف ${pct(reg.dtiCap)} عبور کرده است.`, "دستورالعمل اعتبارسنجی");
  } else {
    add("dti", "pass", `توان بازپرداخت «${mode.nameFa}»`, `قسط به درآمد ${pct(mode.installmentToIncome)} در سقف ${pct(reg.dtiCap)}.`, "دستورالعمل اعتبارسنجی");
  }
  if (mode.blockedRatio > 0.55 + 1e-9) {
    add("blocking", "warn", `مسدودی «${mode.nameFa}»`, `مسدودی ${pct(mode.blockedRatio)} از حد شفافیت ۵۵٪ بیشتر است؛ الزام افشای مؤثر نرخ.`, "دستورالعمل طرح‌های میانگینی");
  }
  if (reg.compensatingDepositBan && mode.blockedRatio > 0.6) {
    add("comp_dep", "fail", `سپرده جبرانی «${mode.nameFa}»`, `مسدودی اجباری ${pct(mode.blockedRatio)} عملاً سپرده جبرانی است و ممنوع است.`, "بخشنامه منع سپرده جبرانی");
  }

  const failed = items.filter((i) => i.level === "fail").length;
  const warned = items.filter((i) => i.level === "warn").length;
  return { items, failed, warned, passed: items.length - failed - warned };
}
