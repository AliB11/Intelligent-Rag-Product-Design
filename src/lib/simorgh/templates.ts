/**
 * simorgh/templates.ts — 17 starting product templates (Simorgh adaptation).
 * ---------------------------------------------------------------------------
 * Every Iranian product family from the reference simulator (credit card,
 * BNPL with/without global budget, micro loan, QH, Joalah, Ijarah, business
 * line, gold-backed, money–time points, loyalty, tiered Morabaha…) mapped onto
 * this repo's archetypes/contracts. Each template is a candidate SEED for the
 * inverse optimizer: the identified facility decides which template leads.
 */

import type { ContractType, ModeArchetype } from "../domain/types";

export interface ProductTemplate {
  id: string;
  nameFa: string;
  nameEn: string;
  emoji: string;
  taglineFa: string;
  archetype: ModeArchetype;
  contract: ContractType;
  /** Categories (from the resolver taxonomy) this template serves. */
  categories: string[];
  /** Seed u-params for buildMode (0..1 each). */
  params: Partial<Record<"rr" | "rd" | "rl" | "td" | "tl" | "omega" | "alpha" | "beta" | "gamma" | "delta" | "fee" | "cap" | "adoption" | "pd" | "lgd", number>>;
}

export const PRODUCT_TEMPLATES: ProductTemplate[] = [
  {
    id: "tpl-credit-card",
    nameFa: "کارت اعتباری مرابحه‌ای",
    nameEn: "Murabaha credit card",
    emoji: "💳",
    taglineFa: "سقف گردشی با تسویه درون‌شبکه‌ای",
    archetype: "merchant-pos-accelerator",
    contract: "bnpl",
    categories: ["scored", "goods", "payroll"],
    params: { td: 0.2, tl: 0.35, omega: 0.1, alpha: 0.6, beta: 0.1, gamma: 0.8, delta: 0.2, rl: 0.55, fee: 0.5, adoption: 0.75 },
  },
  {
    id: "tpl-bnpl-budget",
    nameFa: "BNPL با بودجه کل",
    nameEn: "BNPL with global budget",
    emoji: "🛒",
    taglineFa: "خرید اقساطی با سقف برنامه‌ای",
    archetype: "merchant-pos-accelerator",
    contract: "bnpl",
    categories: ["goods", "scored"],
    params: { td: 0.15, tl: 0.2, omega: 0.05, alpha: 0.7, beta: 0.08, gamma: 0.85, delta: 0.18, rl: 0.5, adoption: 0.8 },
  },
  {
    id: "tpl-bnpl-open",
    nameFa: "BNPL باز (بدون بودجه کل)",
    nameEn: "Open-loop BNPL",
    emoji: "🏷️",
    taglineFa: "اعتبار خرید برای همه پذیرندگان",
    archetype: "merchant-pos-accelerator",
    contract: "bnpl",
    categories: ["goods"],
    params: { td: 0.12, tl: 0.18, omega: 0.05, alpha: 0.65, beta: 0.06, gamma: 0.78, delta: 0.2, rl: 0.45, adoption: 0.82 },
  },
  {
    id: "tpl-micro-loan",
    nameFa: "وام خرد مصرفی",
    nameEn: "Micro consumer loan",
    emoji: "🌱",
    taglineFa: "اقساط کوچک با اعطای سریع",
    archetype: "retail-qarz-average",
    contract: "morabaha",
    categories: ["goods", "payroll", "instant"],
    params: { td: 0.3, tl: 0.4, omega: 0.2, alpha: 0.45, beta: 0.12, gamma: 0.4, delta: 0.35, rl: 0.6, adoption: 0.8 },
  },
  {
    id: "tpl-qh-average",
    nameFa: "قرض‌الحسنه میانگین‌حساب",
    nameEn: "QH average-balance",
    emoji: "🤲",
    taglineFa: "کارمزد حداکثر ۴٪ با امتیاز حساب",
    archetype: "retail-qarz-average",
    contract: "qarz-hasaneh",
    categories: ["qh", "marriage", "scored"],
    params: { td: 0.5, tl: 0.6, omega: 0.3, alpha: 0.5, beta: 0.15, gamma: 0.5, delta: 0.3, rl: 0.15, adoption: 0.85 },
  },
  {
    id: "tpl-joalah-housing",
    nameFa: "جعاله تعمیرات مسکن",
    nameEn: "Joalah home-repair",
    emoji: "🔨",
    taglineFa: "اجرت ساخت و بهسازی ملک",
    archetype: "investment-deposit",
    contract: "joalah",
    categories: ["housing"],
    params: { td: 0.7, tl: 0.7, omega: 0.25, alpha: 0.5, beta: 0.12, gamma: 0.45, delta: 0.25, rl: 0.6, adoption: 0.6 },
  },
  {
    id: "tpl-ijara-vehicle",
    nameFa: "اجاره به شرط تملیک خودرو",
    nameEn: "Ijara vehicle lease-to-own",
    emoji: "🚗",
    taglineFa: "قسط اجاره با تملیک پایانی",
    archetype: "corporate-float-anchor",
    contract: "morabaha",
    categories: ["car", "payroll"],
    params: { td: 0.4, tl: 0.85, omega: 0.2, alpha: 0.55, beta: 0.1, gamma: 0.6, delta: 0.22, rl: 0.7, adoption: 0.7 },
  },
  {
    id: "tpl-business-line",
    nameFa: "خط اعتباری کسب‌وکار",
    nameEn: "SME business credit line",
    emoji: "🏭",
    taglineFa: "سرمایه در گردش برداشت‌پذیر",
    archetype: "corporate-float-anchor",
    contract: "morabaha",
    categories: ["sme", "supply-chain"],
    params: { td: 0.25, tl: 0.6, omega: 0.15, alpha: 0.5, beta: 0.1, gamma: 0.65, delta: 0.25, rl: 0.65, adoption: 0.6 },
  },
  {
    id: "tpl-gold-credit",
    nameFa: "اعتبار طلا‌محور",
    nameEn: "Gold-backed credit",
    emoji: "🥇",
    taglineFa: "وثیقه شمش با بازده سپرده",
    archetype: "investment-deposit",
    contract: "mudaraba",
    categories: ["deposit-certificate", "scored"],
    params: { td: 0.2, tl: 0.4, omega: 0.1, alpha: 0.4, beta: 0.08, gamma: 0.35, delta: 0.2, rl: 0.75, adoption: 0.55 },
  },
  {
    id: "tpl-points-money-time",
    nameFa: "وام امتیازی پول–زمان",
    nameEn: "Money–time points loan",
    emoji: "⏳",
    taglineFa: "امتیاز = مبلغ × زمان، اعتبار بر پایه معدل",
    archetype: "scored-deposit-credit",
    contract: "qarz-hasaneh",
    categories: ["scored", "qh"],
    params: { td: 0.6, tl: 0.7, omega: 0.15, alpha: 0.7, beta: 0.05, gamma: 0.7, delta: 0.28, rl: 0.12, adoption: 0.85 },
  },
  {
    id: "tpl-tiered-murabaha",
    nameFa: "مرابحه پله‌ای",
    nameEn: "Tiered Murabaha",
    emoji: "🪜",
    taglineFa: "نرخ‌های پله‌ای بر پایه رتبه",
    archetype: "investment-deposit",
    contract: "morabaha",
    categories: ["payroll", "scored"],
    params: { td: 0.35, tl: 0.6, omega: 0.15, alpha: 0.55, beta: 0.1, gamma: 0.55, delta: 0.28, rl: 0.7, adoption: 0.7 },
  },
  {
    id: "tpl-loyalty",
    nameFa: "باشگاه وفاداری",
    nameEn: "Loyalty club",
    emoji: "🎁",
    taglineFa: "پاداش گردش با اعتبار وابسته",
    archetype: "merchant-pos-accelerator",
    contract: "bnpl",
    categories: ["goods", "merchant"],
    params: { td: 0.1, tl: 0.15, omega: 0.05, alpha: 0.6, beta: 0.05, gamma: 0.9, delta: 0.15, rl: 0.3, adoption: 0.9 },
  },
  {
    id: "tpl-salaried-installment",
    nameFa: "اقساطی حقوق‌بگیران",
    nameEn: "Salaried installment",
    emoji: "💼",
    taglineFa: "کسر از حقوق با نرخ مبادله‌ای",
    archetype: "corporate-float-anchor",
    contract: "morabaha",
    categories: ["payroll"],
    params: { td: 0.25, tl: 0.7, omega: 0.15, alpha: 0.5, beta: 0.08, gamma: 0.7, delta: 0.25, rl: 0.65, adoption: 0.75 },
  },
  {
    id: "tpl-newlywed-qh",
    nameFa: "قرض‌الحسنه تازه‌زوجین",
    nameEn: "Newlywed QH",
    emoji: "💍",
    taglineFa: "کمک ازدواج با کارمزد ۴٪",
    archetype: "retail-qarz-average",
    contract: "qarz-hasaneh",
    categories: ["marriage", "qh"],
    params: { td: 0.35, tl: 0.8, omega: 0.2, alpha: 0.4, beta: 0.06, gamma: 0.35, delta: 0.4, rl: 0.12, adoption: 0.8 },
  },
  {
    id: "tpl-supply-gam",
    nameFa: "گام زنجیره تأمین",
    nameEn: "Supply-chain Gam",
    emoji: "🔗",
    taglineFa: "تنزیل فاکتور درون‌زنجیره‌ای",
    archetype: "supply-chain-gam",
    contract: "gam",
    categories: ["supply-chain", "sme"],
    params: { td: 0.15, tl: 0.35, omega: 0.1, alpha: 0.6, beta: 0.03, gamma: 0.85, delta: 0.18, rl: 0.6, adoption: 0.65 },
  },
  {
    id: "tpl-solar-energy",
    nameFa: "تسهیلات انرژی خورشیدی",
    nameEn: "Solar energy facility",
    emoji: "☀️",
    taglineFa: "نیروگاه خانگی با یارانه سود",
    archetype: "supply-chain-gam",
    contract: "morabaha",
    categories: ["solar", "sme"],
    params: { td: 0.2, tl: 0.8, omega: 0.1, alpha: 0.5, beta: 0.05, gamma: 0.6, delta: 0.15, rl: 0.45, adoption: 0.6 },
  },
  {
    id: "tpl-agri-input",
    nameFa: "نهاده کشاورزی (خرید دین)",
    nameEn: "Agri-input factoring",
    emoji: "🌾",
    taglineFa: "خرید دین نهاده با تسویه محصول",
    archetype: "supply-chain-gam",
    contract: "kharid-deyn",
    categories: ["agri"],
    params: { td: 0.15, tl: 0.35, omega: 0.1, alpha: 0.55, beta: 0.05, gamma: 0.72, delta: 0.22, rl: 0.6, adoption: 0.65 },
  },
];

/** Templates serving a resolver category (priority-ordered). */
export function templatesForCategories(categories: string[]): ProductTemplate[] {
  if (!categories.length) return PRODUCT_TEMPLATES;
  const hit = PRODUCT_TEMPLATES.filter((t) => t.categories.some((c) => categories.includes(c)));
  return hit.length ? hit : PRODUCT_TEMPLATES;
}
