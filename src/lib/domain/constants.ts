/**
 * app/domain/constants.ts (TypeScript twin)
 * ---------------------------------------------------------------------------
 * Iranian banking unit system + Central Bank of Iran (CBI) regulatory defaults.
 * Every constant used by the deterministic financial engine lives here so that
 * no language model ever invents a number.
 */

/** 1 Hemmat (همت) = 10^13 Rial. The CBI large-scale resource unit. */
export const HEMMAT_RIAL = 1e13;
/** 1 Toman = 10 Rial. */
export const TOMAN_RIAL = 10;
/** 1 Billion Toman (میلیارد تومان) expressed in Rial. */
export const BILLION_TOMAN_RIAL = 1e9 * TOMAN_RIAL;
/** 1 Million Toman (میلیون تومان) expressed in Rial. */
export const MILLION_TOMAN_RIAL = 1e6 * TOMAN_RIAL;

export const rialToToman = (rial: number) => rial / TOMAN_RIAL;
export const rialToHemmat = (rial: number) => rial / HEMMAT_RIAL;
export const tomanToRial = (toman: number) => toman * TOMAN_RIAL;
export const hemmatToRial = (hemmat: number) => hemmat * HEMMAT_RIAL;

/** Days per Iranian banking month used by the average-balance point engine. */
export const DAYS_PER_MONTH = 30;

/** Simulation horizon of the ALM digital twin (months). */
export const ALM_HORIZON_MONTHS = 60;
/** Monte Carlo runs for the stress tester. */
export const MC_RUNS = 1000;
/** Fast screening runs used by the inverse optimiser candidate sweep. */
export const MC_SCREEN_RUNS = 120;

/** Statutory reserve ratio (سپرده قانونی) defaults per CBI directive. */
export const STATUTORY_RESERVE = {
  /** قرض‌الحسنه پس‌انداز / جاری */
  qarzHasaneh: 0.02,
  /** سپرده کوتاه‌مدت سرمایه‌گذاری */
  shortTermInvestment: 0.1,
  /** سپرده بلندمدت سرمایه‌گذاری */
  longTermInvestment: 0.15,
  /** اوراق مشارکت */
  participation: 0.0,
  /** اوراق گام (supply-chain bonds) */
  gam: 0.0,
} as const;

/** Vault + ATM liquidity deduction ratio (ضریب نقدینگی). */
export const LIQUIDITY_DEDUCTION_DEFAULT = 0.01;
/** Central Bank statutory-reserve reward rate. */
export const CB_REWARD_RATE = 0.01;
/** Administrative / operational cost ratio to free resources. */
export const OPEX_RATIO_DEFAULT = 0.035;

/** Market rate anchors. */
export const INTERBANK_RATE = 0.23;
export const HURDLE_MARGIN = 0.02;
export const HURDLE_RATE = INTERBANK_RATE + HURDLE_MARGIN;
export const TREASURY_RATE = 0.245;
export const INFLATION_RATE = 0.36;

/** CBI / Islamic-contract hard ceilings. */
export const REGULATORY = {
  /** Maximum commission on Qarz-ol-Hasanah (کارمزد) = 4%. */
  qarzHasanehMaxCommission: 0.04,
  /** Maximum Morabaha profit rate = 23%. */
  morabahaMaxRate: 0.23,
  /** Maximum rate for any contract after Shora-ye-Pool-o-Credit approval. */
  absoluteRateCeiling: 0.287,
  /** Tamin-Yar productive credit card cap = 5 billion Toman. */
  taminYarCapToman: 5e9,
  /** p95 Net Loan-to-Deposit solvency ceiling. */
  ldrCeiling: 0.85,
  /** Liquidity Coverage Ratio floor. */
  lcrFloor: 1.05,
  /** Internal early-warning LDR trigger used by the critic auditor. */
  ldrWarning: 0.8,
  /** Maximum installment-to-income for the target persona. */
  installmentToIncomeCeiling: 0.4,
  /** Maximum self-correction iterations of the critic loop. */
  maxCriticIterations: 5,
} as const;

/** Capital / liquidity calibration of the digital twin. */
export const CAPITAL = {
  /** Economic capital ratio against peak on-balance-sheet loans (CAR 8% + buffers). */
  capitalToLoans: 0.1,
  /** Structural HQLA held against the deposit book (Basel III style). */
  hqlaToDeposits: 0.12,
  /** Equity base of the simulated bank (Rial) used for ROE. */
  equityRial: 4.5e14,
  /** Stressed 30-day outflow shock factor applied to non-blocked deposits. */
  stressedOutflowShock: 0.09,
  /** Run-off sensitivity of hot (non-blocked) money to rate differentials. */
  hotMoneyElasticity: 1.6,
} as const;

/** Objective-function weights (lambda vector) defaults. */
export const DEFAULT_LAMBDAS = {
  lambda1Irr: 0.42,
  lambda2Adoption: 0.26,
  lambda3LdrPenalty: 0.22,
  lambda4Overturning: 0.1,
} as const;

export const formatNumberFa = (value: number, digits = 0) =>
  new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);

export const formatPercent = (value: number, digits = 2) =>
  `${(value * 100).toFixed(digits)}%`;
