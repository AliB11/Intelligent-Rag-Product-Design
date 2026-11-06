/**
 * simorgh/randomIdea.ts — safe random-idea generator (Simorgh adaptation).
 * ---------------------------------------------------------------------------
 * "ایده تصادفی" for the composer: a seeded random draw over the 17 templates,
 * 12 personas and the regulatory control ranges, producing a coherent
 * few-word prompt + slider controls. Deterministic for a given seed.
 */

import { createRng } from "../domain/financial";
import { PRODUCT_TEMPLATES } from "./templates";

export interface RandomIdea {
  emoji: string;
  prompt: string;
  controls: { hemmat: number; irr: number; ldr: number; lcr: number; overturn: number };
  templateId: string;
}

const HEMMAT_RANGE: [number, number] = [2, 14];
const IRR_BY_CONTRACT: Record<string, [number, number]> = {
  "qarz-hasaneh": [8, 16],
  bnpl: [24, 30],
  morabaha: [22, 28],
  joalah: [20, 26],
  "kharid-deyn": [18, 26],
  gam: [20, 26],
  mudaraba: [22, 27],
};

const NEED_WORDS: Record<string, string[]> = {
  "tpl-credit-card": ["کارت اعتباری", "اعتبار گردشی"],
  "tpl-bnpl-budget": ["خرید اقساطی با سقف برنامه‌ای", "BNPL بودجه‌دار"],
  "tpl-bnpl-open": ["خرید اقساطی", "BNPL"],
  "tpl-micro-loan": ["وام خرد مصرفی", "وام کوچک"],
  "tpl-qh-average": ["قرض‌الحسنه میانگین‌حساب", "وام بی‌سود با امتیاز حساب"],
  "tpl-joalah-housing": ["جعاله تعمیرات مسکن", "وام تعمیر خانه"],
  "tpl-ijara-vehicle": ["اجاره به شرط تملیک خودرو", "وام خودرو"],
  "tpl-business-line": ["خط اعتباری کسب‌وکار", "سرمایه در گردش SME"],
  "tpl-gold-credit": ["اعتبار طلا‌محور", "وام با وثیقه شمش"],
  "tpl-points-money-time": ["وام امتیازی پول–زمان", "اعتبار بر پایه امتیاز سپرده"],
  "tpl-tiered-murabaha": ["مرابحه پله‌ای با نرخ رتبه‌محور"],
  "tpl-loyalty": ["باشگاه وفاداری با اعتبار خرید"],
  "tpl-salaried-installment": ["تسهیلات حقوق‌بگیران با کسر از حقوق"],
  "tpl-newlywed-qh": ["وام ازدواج قرض‌الحسنه"],
  "tpl-supply-gam": ["اوراق گام زنجیره تأمین"],
  "tpl-solar-energy": ["نیروگاه خورشیدی خانگی"],
  "tpl-agri-input": ["نهاده کشاورزی با خرید دین"],
};

/** Deterministic idea for a numeric seed; seed omitted => time-based. */
export function randomIdea(seed?: number): RandomIdea {
  const s = seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = createRng(s);
  const template = PRODUCT_TEMPLATES[Math.floor(rng() * PRODUCT_TEMPLATES.length)];
  const [hLo, hHi] = HEMMAT_RANGE;
  const hemmat = Math.round(hLo + rng() * (hHi - hLo));
  const [iLo, iHi] = IRR_BY_CONTRACT[template.contract] ?? [20, 27];
  const irr = Math.round((iLo + rng() * (iHi - iLo)) * 2) / 2;
  const overturn = Math.round((2 + rng() * 5) * 2) / 2;
  const needs = NEED_WORDS[template.id] ?? [template.nameFa];
  const need = needs[Math.floor(rng() * needs.length)];
  const personaHint = rng() < 0.5 ? " برای بخش هدف مناسب" : "";
  const prompt = `${need}${personaHint} — ${hemmat} همت منبع، IRR هدف حداقل ${irr}٪، سقف LDR ۸۵٪، کف LCR ۱٫۰۵ و حداکثر ریسک واژگونی ${overturn}٪`;
  return {
    emoji: template.emoji,
    prompt,
    controls: { hemmat, irr, ldr: 85, lcr: 1.05, overturn },
    templateId: template.id,
  };
}
