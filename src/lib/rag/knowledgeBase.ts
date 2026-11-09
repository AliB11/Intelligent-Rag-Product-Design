/**
 * app/rag/vector_store.py + app/rag/seed_iran_banking_kb.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Deterministic hashed bag-of-words vector store (128 dims, L2 normalised,
 * cosine similarity) with hybrid lexical re-ranking. The same documents are
 * mirrored into PostgreSQL (`kb_documents`) so retrieval is pgvector-shaped.
 */

import type { RegulatoryChunkMeta, RegulatoryConstraint } from "../domain/types";
import {
  parseOrThrow,
  retrievalLimitSchema,
  retrievalQuerySchema,
} from "../validation/schemas";
import { activeDocFilter, isChunkActiveAt, regulatoryChunkMetaSchema } from "./governance";
import { HybridRagIndex } from "./hybridRag";

export const EMBEDDING_DIM = 128;

export interface KbDocumentSeed {
  code: string;
  category: string;
  authority: string;
  titleFa: string;
  titleEn: string;
  bodyFa: string;
  bodyEn: string;
  citation: string;
  constraints: RegulatoryConstraint["binding"];
  /** Temporal & regulatory governance metadata (Zod-validated at index build). */
  governance: RegulatoryChunkMeta;
}

export function tokenise(text: string): string[] {
  const normalised = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/\u0643/g, "ک")
    .replace(/[\u200c\u200f\u0640]/g, " ")
    .replace(/[^0-9a-z\u0600-\u06FF]+/g, " ")
    .trim();
  return normalised
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 400);
}

/** Deterministic signed feature hashing with sublinear term-frequency weighting. */
export function embed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  const frequencies = new Map<string, number>();
  for (const token of tokenise(text)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);

  frequencies.forEach((frequency, token) => {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const unsignedHash = hash >>> 0;
    const index = unsignedHash % EMBEDDING_DIM;
    const sign = (unsignedHash & 0x80000000) === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.log(frequency));
  });
  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length || a.some((value) => !Number.isFinite(value)) || b.some((value) => !Number.isFinite(value))) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA > 0 && normB > 0 ? dot / Math.sqrt(normA * normB) : 0;
}

const KB_SEED_BASE: Omit<KbDocumentSeed, "governance">[] = [
  {
    code: "CBI-QH-COMMISSION-04",
    category: "cbi-directive",
    authority: "شورای پول و اعتبار / بانک مرکزی جمهوری اسلامی ایران",
    titleFa: "سقف کارمزد تسهیلات قرض‌الحسنه ۴ درصد",
    titleEn: "Qarz-ol-Hasanah commission ceiling of 4%",
    bodyFa:
      "نرخ کارمزد انواع تسهیلات قرض‌الحسنه اعم از تک‌قسطی و اقساطی در شبکه بانکی نباید از ۴ درصد در سال تجاوز کند. هرگونه دریافت سود تحت عنوان مرابحه برای قراردادهای قرض‌الحسنه ممنوع است و صرفاً کارمزد خدمات و هزینه تمام‌شده قابل دریافت است. تسهیلات قرض‌الحسنه از شمول سپرده قانونی با نرخ ۲ درصد برخوردارند.",
    bodyEn:
      "The all-in commission on Qarz-ol-Hasanah facilities (single or instalment) may not exceed 4% per annum across the banking network. Charging profit under a Morabaha label on a QH contract is prohibited; only service commission and cost recovery is allowed. QH facilities attract a 2% statutory reserve.",
    citation: "بخشنامه شورای پول و اعتبار — نرخ کارمزد تسهیلات قرض‌الحسنه",
    constraints: [
      { field: "loanRate", op: "<=", value: 0.04 },
      { field: "contract", op: "in", value: ["qarz-hasaneh"] },
    ],
  },
  {
    code: "CBI-MORABAHA-RATE-23",
    category: "cbi-directive",
    authority: "شورای پول و اعتبار",
    titleFa: "سقف نرخ سود عقود مبادله‌ای (مرابحه) ۲۳ درصد",
    titleEn: "Morabaha / exchange-contract profit rate ceiling of 23%",
    bodyFa:
      "نرخ سود اوراق و تسهیلات مبتنی بر عقود اسلامی مبادله‌ای از جمله مرابحه، اجاره به شرط تملیک و جعاله حداکثر ۲۳ درصد در سال است. نرخ مؤثر قراردادهای میانگین حساب باید به‌صورت شفاف به مشتری اعلام شود و نرخ مؤثر کل (شامل کارمزد، مسدودی و دوره خواب) نباید از سقف مصوب فراتر رود.",
    bodyEn:
      "Profit rates on exchange-based Islamic contracts (Morabaha, Ijara, Joalah) are capped at 23% per annum. The effective all-in rate of average-balance schemes must be disclosed to the customer and may not exceed the approved ceiling once commission, blocking and sleep periods are accounted for.",
    citation: "مصوبه شورای پول و اعتبار — سقف نرخ سود عقود مبادله‌ای",
    constraints: [
      { field: "loanRate", op: "<=", value: 0.23 },
      { field: "contract", op: "in", value: ["morabaha", "mudaraba", "joalah"] },
    ],
  },
  {
    code: "CBI-STATUTORY-RESERVE",
    category: "cbi-directive",
    authority: "بانک مرکزی — اداره مقررات بانکی",
    titleFa: "نرخ سپرده قانونی بر حسب نوع سپرده",
    titleEn: "Statutory reserve ratio by deposit type",
    bodyFa:
      "نرخ سپرده قانونی برای سپرده‌های قرض‌الحسنه پس‌انداز و جاری ۲ درصد، برای سپرده‌های کوتاه‌مدت سرمایه‌گذاری ۱۰ درصد و برای سپرده‌های بلندمدت سرمایه‌گذاری تا ۱۵ درصد تعیین می‌شود. اوراق مشارکت و اوراق گام مشمول سپرده قانونی نیستند (صفر درصد). بانک مرکزی به‌ازای سپرده قانونی مسدودشده نرخ پاداش ۱ درصد پرداخت می‌کند و ضریب نقدینگی صندوق و خودپرداز حدود ۱ درصد از منابع آزاد را جذب می‌کند.",
    bodyEn:
      "Statutory reserve is 2% for QH savings/current deposits, 10% for short-term and up to 15% for long-term investment deposits, and 0% for participation bonds and Gam certificates. The CBI pays a 1% reward on blocked reserves and roughly 1% of free resources is absorbed by vault and ATM liquidity needs.",
    citation: "دستورالعمل سپرده قانونی و ضریب نقدینگی",
    constraints: [
      { field: "statutoryReserve", op: "<=", value: 0.15 },
      { field: "statutoryReserve", op: ">=", value: 0.0 },
    ],
  },
  {
    code: "CBI-LDR-LCR-SOLVENCY",
    category: "risk-rule",
    authority: "کمیته مدیریت دارایی و بدهی (ALCO)",
    titleFa: "قاعده انحلال‌پذیری: p95 LDR ≤ ۰٫۸۵ و LCR ≥ ۱٫۰۵",
    titleEn: "Solvency rule: p95 LDR ≤ 0.85 and LCR ≥ 1.05",
    bodyFa:
      "در شبیه‌سازی دوقلوی دیجیتال ALM، صدک ۹۵ نسبت خالص تسهیلات به سپرده (LDR) در هیچ ماهی از ۶۰ ماه افق شبیه‌سازی نباید از ۰٫۸۵ تجاوز کند و نسبت پوشش نقدینگی (LCR) باید همواره دست‌کم ۱٫۰۵ باشد. نقض همزمان این دو قاعده به معنای ریسک واژگونی منابع غیرقابل قبول است و محصول باید بازطراحی شود.",
    bodyEn:
      "Inside the ALM digital twin the 95th percentile of the net loan-to-deposit ratio must never exceed 0.85 across the 60-month horizon and the liquidity coverage ratio must stay at or above 1.05. Simultaneous breach implies unacceptable resource-overturning risk and forces a redesign.",
    citation: "چارچوب داخلی مدیریت نقدینگی و کفایت سرمایه",
    constraints: [
      { field: "p95Ldr", op: "<=", value: 0.85 },
      { field: "p5Lcr", op: ">=", value: 1.05 },
    ],
  },
  {
    code: "CBI-OVERTURNING-RISK",
    category: "risk-rule",
    authority: "بانک مرکزی — مدیریت ریسک",
    titleFa: "ریسک واژگونی منابع و الزام پلکانی‌سازی سررسیدها",
    titleEn: "Resource overturning risk and mandatory maturity staggering",
    bodyFa:
      "واژگونی منابع به خروج همزمان و توده‌ای سپرده‌ها در لحظه اعطای تسهیلات یا سررسید اشاره دارد. الزامات: (۱) پلکانی‌سازی دوره خواب سپرده بین طرح‌ها، (۲) نگهداری سهمی از سپرده به‌صورت مسدودی هوشمند با آزادسازی پلکانی، (۳) هدایت بخش قابل‌توجهی از تسهیلات به تأمین‌کنندگان و پذیرندگان همان بانک (حلقه بسته γ)، (۴) صف انتظار ω بین پایان دوره خواب و اعطای تسهیلات. شوک واژگونی در صدک ۹۵ نباید از آستانه تحمل ریسک درخواست‌کننده فراتر رود.",
    bodyEn:
      "Resource overturning denotes a simultaneous mass withdrawal at the disbursement or maturity moment. Mandatory mitigants: staggered deposit sleep periods across tiers, smart blocking with step-wise release, closed-loop routing of disbursed funds to merchants and suppliers banked in the same institution (gamma), and a waiting queue omega between sleep expiry and disbursement.",
    citation: "دستورالعمل پایداری و ماندگاری منابع سپرده‌ای",
    constraints: [
      { field: "overturningShock", op: "<=", value: 0.06 },
      { field: "closedLoopRetention", op: ">=", value: 0.35 },
    ],
  },
  {
    code: "CBI-TAMIN-YAR-CAP",
    category: "cbi-directive",
    authority: "بانک مرکزی — اعتبارات تولیدی",
    titleFa: "سقف ۵ میلیارد تومانی کارت اعتباری تولیدی تأمین‌یار",
    titleEn: "Tamin-Yar productive credit card cap of 5 billion Toman",
    bodyFa:
      "سقف فردی کارت‌های اعتباری زنجیره تأمین (تأمین‌یار) برای بنگاه‌های تولیدی ۵ میلیارد تومان است و تسویه باید در قالب زنجیره تأمین و صرفاً نزد تأمین‌کنندگان ثبت‌شده انجام شود. تنزیل اوراق نزد بانک عامل با نرخ مصوب عقود مبادله‌ای مجاز است.",
    bodyEn:
      "The individual ceiling of Tamin-Yar supply-chain productive credit cards is 5 billion Toman and settlement must occur inside the registered supply chain. Discounting at the issuing bank follows the approved exchange-contract rate.",
    citation: "دستورالعمل تأمین مالی زنجیره تأمین — کارت اعتباری تولیدی",
    constraints: [
      { field: "capToman", op: "<=", value: 5e9 },
      { field: "contract", op: "in", value: ["gam", "kharid-deyn", "morabaha"] },
    ],
  },
  {
    code: "CBI-GAM-CERTIFICATE",
    category: "islamic-contract",
    authority: "بانک مرکزی — اوراق بهادار اسلامی",
    titleFa: "قواعد اوراق گام (گواهی اعتبار تجاری زنجیره تأمین)",
    titleEn: "Gam certificate (supply-chain commercial credit) rules",
    bodyFa:
      "اوراق گام گواهی اعتبار تجاری است که خریدار در زنجیره تأمین صادر می‌کند و فروشنده می‌تواند آن را نزد بانک تنزیل کند یا به تأمین‌کننده بعدی منتقل نماید. سررسید حداکثر معمولاً ۱۲ تا ۲۴ ماه، نرخ تنزیل حداکثر ۱۹ درصد و انتشار منوط به فاکتور رسمی و ثبت در سامانه جامع تجارت است. اوراق گام مشمول سپرده قانونی نیست.",
    bodyEn:
      "A Gam certificate is a supply-chain commercial credit note issued by the buyer, discountable at the bank or endorsable to the next supplier. Typical tenor 12–24 months, discount rate up to 19%, issuance conditional on an official invoice registered in the trade system. Zero statutory reserve applies.",
    citation: "دستورالعمل اوراق گام — تأمین مالی زنجیره تأمین",
    constraints: [
      { field: "loanRate", op: "<=", value: 0.19 },
      { field: "statutoryReserve", op: "==", value: 0 },
    ],
  },
  {
    code: "ISLAMIC-KHARID-DEYN",
    category: "islamic-contract",
    authority: "هیئت عالی شرعی بانک مرکزی",
    titleFa: "عقد خرید دین (Factoring اسلامی)",
    titleEn: "Kharid-e-Deyn (Islamic factoring)",
    bodyFa:
      "در خرید دین، بانک اسناد تجاری مدت‌دار (چک، سفته، فاکتور رسمی، مطالبات بیمه‌ای) را با نرخ تنزیل کمتر از سررسید خریداری می‌کند. وجود دین واقعی و حال در سررسید، ممنوعیت خرید دین از غیرمدیون با نرخ بالاتر، و مستندسازی منشأ طلب الزامی است. این عقد برای مطالبات پزشکان از بیمه‌ها و کرایه‌های حمل با بارنامه رسمی کاربرد مستقیم دارد.",
    bodyEn:
      "Under Kharid-e-Deyn the bank purchases dated commercial claims (cheques, promissory notes, official invoices, insurance receivables) at a discount. A real underlying claim, documentation of origin and prohibition of purchasing from a non-debtor at a higher rate are mandatory. Directly applicable to physician insurance receivables and freight claims backed by official bills of lading.",
    citation: "آیین‌نامه عملیاتی خرید دین",
    constraints: [
      { field: "loanRate", op: "<=", value: 0.23 },
      { field: "contract", op: "in", value: ["kharid-deyn"] },
    ],
  },
  {
    code: "ISLAMIC-JOALAH",
    category: "islamic-contract",
    authority: "هیئت عالی شرعی بانک مرکزی",
    titleFa: "عقد جعاله برای خدمات و تعمیرات",
    titleEn: "Joalah contract for services and maintenance",
    bodyFa:
      "جعاله تعهد پرداخت اجرت در قبال انجام کار یا خدمت مشخص است و برای تأمین مالی خدمات درمانی، تعمیر ناوگان، و خدمات پیمانکاری به‌کار می‌رود. اجرت‌الجعاله باید پیش از شروع کار معلوم باشد و نرخ مؤثر آن از سقف عقود مبادله‌ای تجاوز نکند.",
    bodyEn:
      "Joalah is a commitment to pay a fee for a specified act or service and is used for medical services, fleet maintenance and contracting. The fee must be determined ex-ante and its effective rate must respect the exchange-contract ceiling.",
    citation: "آیین‌نامه عقود اسلامی — جعاله",
    constraints: [
      { field: "loanRate", op: "<=", value: 0.23 },
      { field: "contract", op: "in", value: ["joalah"] },
    ],
  },
  {
    code: "CBI-SAMAT-CLEARANCE",
    category: "compliance",
    authority: "بانک مرکزی — سامانه‌های نظارتی",
    titleFa: "استعلام سامات، چک برگشتی و سامانه مؤدیان",
    titleEn: "SAMAT inquiry, bounced-cheque clearance and tax verification",
    bodyFa:
      "پیش از اعطای هرگونه تسهیلات: (۱) استعلام سامانه سامات برای احراز عدم سوءسابقه و سقف تسهیلات و تعهدات، (۲) رفع سوءاثر از چک‌های برگشتی مطابق قانون جدید چک و استعلام صیاد، (۳) احراز ارائه اظهارنامه مالیاتی و ثبت در سامانه مؤدیان برای متقاضیان حقوقی و صاحبان مشاغل، (۴) احراز هویت و تطبیق فهرست اشخاص تحریمی و مبارزه با پولشویی.",
    bodyEn:
      "Before any disbursement: SAMAT inquiry for credit history and exposure ceilings, clearance of bounced cheques and Sayad inquiry under the new cheque law, tax-return filing verification in the taxpayers' system for corporates and self-employed applicants, and full KYC/AML screening.",
    citation: "بخشنامه‌های نظارتی اعتبارسنجی و مبارزه با پولشویی",
    constraints: [
      { field: "complianceGate", op: "==", value: "samat-sayad-tax-kyc" },
    ],
  },
  {
    code: "CBI-CUSTOMER-PROTECTION-9",
    category: "customer-protection",
    authority: "بانک مرکزی — حمایت از حقوق مشتریان",
    titleFa: "نُه اصل حمایت از مشتریان بانکی",
    titleEn: "Nine principles of banking customer protection",
    bodyFa:
      "۱) شفافیت نرخ مؤثر و اعلام کتبی کل هزینه تسهیلات؛ ۲) ممنوعیت الزام به خرید محصول جانبی (فروش تجمیعی)؛ ۳) حق انتخاب مشتری در نوع عقد و سررسید؛ ۴) اعلام پیشین دوره خواب سپرده و شرایط مسدودی؛ ۵) امکان انتقال امتیاز میانگین حساب به بستگان درجه یک؛ ۶) رسیدگی به شکایت حداکثر ظرف ۱۵ روز کاری؛ ۷) حفاظت از داده شخصی مشتری؛ ۸) ممنوعیت کارمزد مضاعف بر تسهیلات قرض‌الحسنه؛ ۹) ارائه صورت‌حساب دوره‌ای و گزارش عملکرد طرح.",
    bodyEn:
      "(1) Effective-rate transparency and written disclosure of the all-in cost; (2) prohibition of tied selling; (3) customer choice of contract and tenor; (4) prior notice of the deposit sleep period and blocking terms; (5) transferability of average-balance points to first-degree relatives; (6) complaint resolution within 15 working days; (7) personal-data protection; (8) no double commission on QH facilities; (9) periodic statements and scheme performance reporting.",
    citation: "منشور حقوق مشتریان در شبکه بانکی",
    constraints: [
      { field: "effectiveRateDisclosure", op: "==", value: "mandatory" },
      { field: "pointTransferability", op: "==", value: "first-degree-relatives" },
    ],
  },
  {
    code: "CBI-AFFORDABILITY-40",
    category: "risk-rule",
    authority: "کمیته اعتباری — توان بازپرداخت",
    titleFa: "سقف ۴۰ درصدی قسط به درآمد خالص ماهانه",
    titleEn: "40% installment-to-net-monthly-income ceiling",
    bodyFa:
      "مجموع اقساط ماهانه تسهیلات اعطایی به هر شخص حقیقی نباید از ۴۰ درصد درآمد خالص ماهانه احراز شده او تجاوز کند. احراز درآمد از طریق فیش حقوقی، گردش حساب، اظهارنامه مالیاتی، یا رتبه‌بندی رفتاری پذیرنده انجام می‌شود.",
    bodyEn:
      "Total monthly instalments granted to an individual may not exceed 40% of the verified net monthly income, evidenced by payslips, account turnover, tax returns or behavioural merchant grading.",
    citation: "دستورالعمل اعتبارسنجی مشتریان حقیقی",
    constraints: [
      { field: "installmentToIncome", op: "<=", value: 0.4 },
    ],
  },
  {
    code: "CBI-AVERAGE-BALANCE-TRANSPARENCY",
    category: "cbi-directive",
    authority: "بانک مرکزی — مقررات سپرده‌ای",
    titleFa: "شفافیت طرح‌های میانگین حساب و معادل عملیاتی",
    titleEn: "Average-balance scheme transparency and actuarial equivalence",
    bodyFa:
      "در طرح‌های مبتنی بر میانگین حساب، بانک باید رابطه دوره خواب سپرده (τ_d)، ضریب تسهیلات (α)، سررسید بازپرداخت (τ_l) و نرخ سود/کارمزد (r_l) را به‌گونه‌ای تنظیم کند که معادل عملیاتی (NPV) جریان‌های نقد بانک در نرخ مانع داخلی منفی نباشد و نرخ مؤثر کل به مشتری اعلام شود. سهم مسدودی (β) باید در قرارداد صریح و آزادسازی آن پلکانی و قابل استعلام باشد.",
    bodyEn:
      "For average-balance schemes the bank must calibrate the sleep period, loan multiplier, repayment tenor and contract rate so that the NPV of the bank's cash flows at the internal hurdle rate is non-negative, and disclose the all-in effective rate. The blocked share must be explicit in the contract with a step-wise, queryable release schedule.",
    citation: "دستورالعمل طرح‌های سپرده‌گذاری میانگینی",
    constraints: [
      { field: "npvBankRial", op: ">=", value: 0 },
      { field: "blockedRatio", op: "<=", value: 0.55 },
    ],
  },
  {
    code: "CBI-RATE-CEILING-287",
    category: "cbi-directive",
    authority: "شورای پول و اعتبار",
    titleFa: "سقف مطلق نرخ ۲۸٫۷ درصد برای سپرده‌های تضمینی خاص",
    titleEn: "Absolute 28.7% ceiling for specific guaranteed instruments",
    bodyFa:
      "بالاترین نرخ قابل پرداخت/دریافت در شبکه بانکی برای ابزارهای خاص (از جمله سپرده‌های تضمینی مبتنی بر شمش و گواهی سپرده کالایی) تا ۲۸٫۷ درصد مجاز است و هر نرخ بالاتر نیازمند مصوبه جدید شورای پول و اعتبار است.",
    bodyEn:
      "The highest rate payable/receivable in the network for specific instruments (including bullion-backed guaranteed deposits and commodity deposit certificates) is 28.7%; anything higher requires a fresh Money and Credit Council approval.",
    citation: "مصوبه نرخ سود سپرده و تسهیلات",
    constraints: [
      { field: "loanRate", op: "<=", value: 0.287 },
      { field: "depositRate", op: "<=", value: 0.287 },
    ],
  },
  {
    code: "CBI-POS-MERCHANT-GRADING",
    category: "cbi-directive",
    authority: "شرکت پرداخت و شبکه شاپرک",
    titleFa: "رتبه‌بندی پذیرندگان و اعتبار شبانه (Pay-No)",
    titleEn: "Merchant grading and overnight credit (Pay-No pattern)",
    bodyFa:
      "اعطای اعتبار فوری به پذیرندگان بر پایه رتبه عملکردی (A/B/C) و گردش تسویه پایانه مجاز است؛ برای پذیرندگان درجه A و B تا ۵۰۰ میلیون تومان و درجه C تا ۲۰۰ میلیون تومان اعتبار یک‌شبه با تسویه روز کاری بعد. ضریب وزنی منبع گردش پذیرندگان ۱٫۵ و کارمزد پذیرندگی درآمد غیرمشاع بانک محسوب می‌شود.",
    bodyEn:
      "Instant credit to merchants based on performance grade (A/B/C) and terminal settlement turnover is permitted: up to 500M Toman for grades A/B and 200M Toman for grade C as overnight credit settled the next working day. Merchant settlement float carries a source weight of 1.5 and acquirer interchange is non-joint fee income.",
    citation: "دستورالعمل اعتباردهی به پذیرندگان پایانه فروش",
    constraints: [
      { field: "sourceKappa", op: "==", value: 1.5 },
      { field: "capToman", op: "<=", value: 500e6 },
    ],
  },
  {
    code: "CBI-HEALTHCARE-BNPL",
    category: "product-rule",
    authority: "شبکه بانکی — اعتبار سلامت",
    titleFa: "اعتبار مصرفی سلامت (چشم‌پزشکی و دندانپزشکی)",
    titleEn: "Healthcare BNPL (ophthalmology & dentistry)",
    bodyFa:
      "اعتبار خرد درمانی از ۲۰ تا ۲۰۰ میلیون تومان برای خدمات چشم‌پزشکی، دندانپزشکی و تجهیزات کلینیک با بازپرداخت ۶ تا ۳۶ ماه مجاز است. تسویه مستقیم نزد مرکز درمانی طرف قرارداد انجام می‌شود تا حلقه بسته منابع حفظ شود و تجهیزات کلینیک در قالب مرابحه یا جعاله تأمین مالی می‌شود.",
    bodyEn:
      "Healthcare micro-credit between 20M and 200M Toman for ophthalmology, dentistry and clinic equipment with 6–36 month repayment is permitted. Settlement is made directly to the contracted medical centre to preserve the closed loop; clinic equipment is financed under Morabaha or Joalah.",
    citation: "بسته اعتباری سلامت خانواده",
    constraints: [
      { field: "capToman", op: "<=", value: 200e6 },
      { field: "closedLoopRetention", op: ">=", value: 0.6 },
    ],
  },
  {
    code: "CBI-FREIGHT-BOL",
    category: "product-rule",
    authority: "سازمان راهداری و بانک عامل",
    titleFa: "تأمین مالی کرایه حمل با اتکای بارنامه ثبت‌شده",
    titleEn: "Freight wage financing backed by registered bills of lading",
    bodyFa:
      "اعطای اعتبار به رانندگان ناوگان جاده‌ای صرفاً بر پایه بارنامه الکترونیکی ثبت‌شده در سامانه راهداری و به میزان حداکثر ۷۰ درصد مبلغ کرایه مجاز است. تسویه از محل حساب وکالتی کرایه و در لحظه تحویل بار انجام می‌شود و کیف پول راننده به‌عنوان منبع کم‌هزینه در همان بانک نگهداری می‌گردد.",
    bodyEn:
      "Credit to road-fleet drivers is permitted only against a bill of lading registered in the road-transport system, up to 70% of the freight value. Settlement occurs from the escrowed freight account upon delivery and the driver wallet is retained in-house as a low-cost resource.",
    citation: "طرح حمایت از ناوگان حمل‌ونقل جاده‌ای",
    constraints: [
      { field: "loanToClaimRatio", op: "<=", value: 0.7 },
      { field: "contract", op: "in", value: ["kharid-deyn", "joalah"] },
    ],
  },
  {
    code: "CBI-MULTIMODE-FUND-RATIOS",
    category: "product-rule",
    authority: "صندوق‌های قرض‌الحسنه و بانک عامل",
    titleFa: "ماتریس نسبت‌های چندطرحی صندوق‌های درمانی",
    titleEn: "Multi-mode ratio matrix of medical welfare funds",
    bodyFa:
      "ماتریس مرجع: ضریب ۲٫۵ با مسدودی ۵٪؛ ضریب ۲٫۰ با آزادسازی ۵۰٪ از اقساط؛ ضریب ۱٫۸ با مسدودی ۳۵٪؛ ضریب ۱٫۰ بدون مسدودی؛ ضریب ۰٫۸ بدون مسدودی و با اولویت اعطا. این ماتریس مبنای پلکانی‌سازی طرح‌ها در بسته‌های چندطرحی است تا ریسک واژگونی منابع بین طرح‌ها توزیع شود.",
    bodyEn:
      "Reference matrix: 2.5x multiplier with 5% blocking; 2.0x with 50% instalment unlock; 1.8x with 35% blocking; 1.0x with no blocking; 0.8x with no blocking and disbursement priority. This matrix is the basis for staggering tiers in multi-mode packages so overturning risk is distributed across tiers.",
    citation: "ماتریس تسهیلات صندوق رفاه و درمان",
    constraints: [
      { field: "loanMultiplier", op: "<=", value: 2.5 },
      { field: "blockedRatio", op: "<=", value: 0.35 },
    ],
  },
  // -------------------------------------------------------------------------
  // Governance demonstration corpus: one ACTIVE collateral directive plus four
  // documents that MUST be pre-filtered out of retrieval (superseded,
  // amended, expired and not-yet-effective). Their caps are deliberately
  // detectable if leaked: 0.20/0.15 rate caps, 0.02 fee cap and a collateral
  // prohibition would each visibly distort the executable envelope.
  // -------------------------------------------------------------------------
  {
    code: "CBI-BLOCKED-DEPOSIT-COLLATERAL",
    category: "product-rule",
    authority: "بانک مرکزی — معاونت بازار",
    titleFa: "سپرده مسدودی به‌عنوان وثیقه تضمین تسهیلات",
    titleEn: "Blocked deposits as loan collateral under the approved framework",
    bodyFa:
      "سپرده‌های بلندمدت مسدودشده می‌توانند تا سقف ۷۰ درصد مبلغ سپرده به‌عنوان وثیقه تسهیلات قرض‌الحسنه و مرابحه نزد همان بانک پذیرفته شوند؛ آزادسازی وثیقه صرفاً بر پایه جدول اقساط انجام می‌گیرد. سود سپرده مسدودی در دوره مسدودی پرداخت می‌شود و مسدودی وثیقه‌ای نباید از سهم مجاز مسدودی طرح‌های میانگین حساب فراتر رود.",
    bodyEn:
      "Long-term blocked deposits may be accepted as collateral for Qarz-ol-Hasanah and Morabaha loans up to 70% of the deposit balance at the same bank; collateral release follows the instalment schedule only. Profit on blocked deposits is paid during the blocking period and collateral blocking may not exceed the permitted blocking share of average-balance schemes.",
    citation: "دستورالعمل وثیقه‌گذاری سپرده مسدودی",
    constraints: [{ field: "blockedRatio", op: "<=", value: 0.7 }],
  },
  {
    code: "CBI-BLOCKED-COLLATERAL-OLD",
    category: "product-rule",
    authority: "بانک مرکزی — معاونت بازار",
    titleFa: "ممنوعیت پیشین وثیقه‌گذاری با سپرده مسدودی",
    titleEn: "Former prohibition on blocked-deposit collateralisation",
    bodyFa:
      "پیش از بازنگری، وثیقه‌گذاری تسهیلات بر پایه سپرده مسدودی در شبکه بانکی ممنوع بود و بازپرداخت صرفاً از محل ضامن یا سایر دارایی‌ها تضمین می‌شد. این بخشنامه پس از تصویب چارچوب جدید لغو و باطل اعلام شد.",
    bodyEn:
      "Before the revision, collateralising loans with blocked deposits was prohibited across the banking network and repayment had to be guaranteed by a guarantor or other assets only. This circular was revoked after the new framework was approved.",
    citation: "بخشنامه لغو‌شده ممنوعیت سپرده مسدودی",
    constraints: [{ field: "blockedRatio", op: "==", value: 0 }],
  },
  {
    code: "CBI-RATE-CAP-20-AMENDED",
    category: "cbi-directive",
    authority: "شورای پول و اعتبار",
    titleFa: "سقف نرخ ۲۰ درصد پیش از بازنگری مصوب",
    titleEn: "Pre-revision 20% profit-rate ceiling (amended)",
    bodyFa:
      "در بازه زمانی مصوب، سقف نرخ سود تسهیلات مبتنی بر عقود مبادله‌ای ۲۰ درصد در سال بود که پس از بازنگری شورای پول و اعتبار جای خود را به سقف جدید داد و این مصوبه در وضعیت بازنگری‌شده قرار گرفت.",
    bodyEn:
      "For its effective period the profit-rate ceiling on exchange-contract facilities was 20% per annum; after Money and Credit Council revision it was replaced by the new ceiling and this provision now sits in an amended state.",
    citation: "مصوبه بازنشانی‌شده سقف نرخ ۲۰ درصد",
    constraints: [{ field: "loanRate", op: "<=", value: 0.2 }],
  },
  {
    code: "CBI-PANDEMIC-RELIEF-2020",
    category: "product-rule",
    authority: "شبکه بانکی — بسته حمایتی",
    titleFa: "بسته حمایتی دوران کرونا — کارمزد ویژه ۲ درصد",
    titleEn: "Pandemic relief package — special 2% commission",
    bodyFa:
      "در دوره حمایت ویژه، کارمزد تسهیلات حمایتی کرونا حداکثر ۲ درصد در سال تعیین شد. این مهلت پس از اتمام دوره حمایت منقضی شد و دیگر قابل استناد نیست.",
    bodyEn:
      "During the special support period the commission on pandemic relief facilities was capped at 2% per annum. The relief window has expired and the provision is no longer citable.",
    citation: "بسته حمایتی کرونا (منقضی‌شده)",
    constraints: [{ field: "loanRate", op: "<=", value: 0.02 }],
  },
  {
    code: "CBI-FUTURE-REVIEW-2099",
    category: "cbi-directive",
    authority: "شورای پول و اعتبار",
    titleFa: "طرح بازنگری آتی سقف نرخ ۱۵ درصد",
    titleEn: "Future rate-cap review proposal at 15%",
    bodyFa:
      "طرح پیشنهادی بازنگری سقف نرخ سود به ۱۵ درصد صرفاً از تاریخ تصویب آتی قابل اجرا خواهد بود و تا آن زمان نافذ نیست.",
    bodyEn:
      "The proposed revision lowering the profit-rate ceiling to 15% becomes enforceable only from its future approval date and is not in force until then.",
    citation: "طرح پیشنهادی بازنگری نرخ (آینده)",
    constraints: [{ field: "loanRate", op: "<=", value: 0.15 }],
  },
];

/**
 * Governance metadata per seed document. Every entry is Zod-validated when
 * the corpus is built, so an invalid date/status/contract type fails fast at
 * module load instead of silently disabling the pre-filter.
 */
const SEED_GOVERNANCE: Record<string, RegulatoryChunkMeta> = {
  "CBI-QH-COMMISSION-04": {
    effective_date: "2021-03-21T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "QARD_AL_HASAN",
    regulatory_caps: { maxFeeRate: 0.04 },
  },
  "CBI-MORABAHA-RATE-23": {
    effective_date: "2023-05-22T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "MURABAHA",
    regulatory_caps: { maxLoanInterestRate: 0.23, effectiveRateCap: 0.23 },
  },
  "CBI-STATUTORY-RESERVE": {
    effective_date: "2021-01-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
    regulatory_caps: { minReserveRatio: 0.1 },
  },
  "CBI-LDR-LCR-SOLVENCY": {
    effective_date: "2022-01-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-OVERTURNING-RISK": {
    effective_date: "2021-06-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-TAMIN-YAR-CAP": {
    effective_date: "2022-02-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "MURABAHA",
  },
  "CBI-GAM-CERTIFICATE": {
    effective_date: "2021-09-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "ISLAMIC-KHARID-DEYN": {
    effective_date: "2020-11-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "ISLAMIC-JOALAH": {
    effective_date: "2020-11-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "JOALAH",
  },
  "CBI-SAMAT-CLEARANCE": {
    effective_date: "2021-04-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-CUSTOMER-PROTECTION-9": {
    effective_date: "2021-06-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-AFFORDABILITY-40": {
    effective_date: "2022-01-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-AVERAGE-BALANCE-TRANSPARENCY": {
    effective_date: "2022-03-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-RATE-CEILING-287": {
    effective_date: "2023-05-22T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "SPECIAL_DEPOSIT",
    regulatory_caps: { maxLoanInterestRate: 0.287, effectiveRateCap: 0.287 },
  },
  "CBI-POS-MERCHANT-GRADING": {
    effective_date: "2022-05-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-HEALTHCARE-BNPL": {
    effective_date: "2023-01-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-FREIGHT-BOL": {
    effective_date: "2022-08-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  },
  "CBI-MULTIMODE-FUND-RATIOS": {
    effective_date: "2023-02-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
    regulatory_caps: { allowBlockedDepositCollateral: true },
  },
  "CBI-BLOCKED-DEPOSIT-COLLATERAL": {
    effective_date: "2023-01-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "SPECIAL_DEPOSIT",
    regulatory_caps: { allowBlockedDepositCollateral: true },
  },
  "CBI-BLOCKED-COLLATERAL-OLD": {
    effective_date: "2018-01-01T00:00:00.000Z",
    expiration_date: "2023-01-01T00:00:00.000Z",
    status: "SUPERSEDED",
    sharia_contract_type: "SPECIAL_DEPOSIT",
    regulatory_caps: { allowBlockedDepositCollateral: false },
  },
  "CBI-RATE-CAP-20-AMENDED": {
    effective_date: "2020-04-01T00:00:00.000Z",
    expiration_date: null,
    status: "AMENDED",
    sharia_contract_type: "MURABAHA",
    regulatory_caps: { maxLoanInterestRate: 0.2, effectiveRateCap: 0.2 },
  },
  "CBI-PANDEMIC-RELIEF-2020": {
    effective_date: "2020-04-19T00:00:00.000Z",
    expiration_date: "2021-12-21T00:00:00.000Z",
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
    regulatory_caps: { maxFeeRate: 0.02 },
  },
  "CBI-FUTURE-REVIEW-2099": {
    effective_date: "2099-01-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
    regulatory_caps: { maxLoanInterestRate: 0.15, effectiveRateCap: 0.15 },
  },
};

export const KB_SEED: KbDocumentSeed[] = KB_SEED_BASE.map((doc) => {
  const meta = SEED_GOVERNANCE[doc.code];
  if (!meta) {
    throw new Error(`KB seed "${doc.code}" is missing governance metadata`);
  }
  // Zod boundary: malformed governance fails fast at corpus build.
  return { ...doc, governance: regulatoryChunkMetaSchema.parse(meta) };
});

export interface KbVectorDocument extends KbDocumentSeed {
  id: string;
  tokens: string[];
  embedding: number[];
}

export const KB_DOCUMENTS: KbVectorDocument[] = KB_SEED.map((doc) => {
  const text = `${doc.titleFa} ${doc.titleEn} ${doc.bodyFa} ${doc.bodyEn} ${doc.authority} ${doc.category}`;
  return {
    ...doc,
    id: doc.code,
    tokens: Array.from(new Set(tokenise(text))),
    embedding: embed(text),
  };
});

const KB_HYBRID_INDEX = new HybridRagIndex<KbVectorDocument>(
  KB_DOCUMENTS.map((doc) => ({
    id: doc.id,
    title: `${doc.titleFa} ${doc.titleEn}`,
    entity: doc.authority,
    tags: `${doc.code} ${doc.category} ${doc.constraints.map((c) => c.field).join(" ")}`,
    body: `${doc.bodyFa} ${doc.bodyEn} ${doc.citation}`,
    item: doc,
  })),
);

/**
 * Hybrid BM25+ + 256D Subword Dense + RRF retrieval over the regulatory KB.
 *
 * Governance PRE-filter: only chunks that are `status === "ACTIVE"` and whose
 * effective/expiration window contains `at` are admitted to the candidate set
 * — the filter runs BEFORE BM25 and dense scoring, so superseded / amended /
 * expired / future directives can never be ranked or retrieved.
 */
export function retrieveKnowledge(
  query: string,
  topK = 6,
  boostCategories: string[] = [],
  at: Date = new Date(),
): RegulatoryConstraint[] {
  // Zod boundary: malformed retrieval inputs are rejected at the RAG
  // entrance instead of silently producing garbage rankings.
  parseOrThrow(retrievalQuerySchema, query, TypeError);
  parseOrThrow(retrievalLimitSchema, topK, RangeError);
  if (!Array.isArray(boostCategories) || boostCategories.some((c) => typeof c !== "string")) {
    throw new TypeError("boostCategories must be an array of strings");
  }
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new RangeError("at must be a valid Date");
  }
  const limit = Math.max(1, Math.min(20, Math.floor(topK)));
  const preFilter = activeDocFilter<KbVectorDocument>(at);
  const hits = KB_HYBRID_INDEX.search(query, {
    topK: limit,
    minScore: 0.04,
    boostFn: (doc) => (boostCategories.includes(doc.category) ? 0.08 : 0),
    filterFn: preFilter,
  });

  // Fallback to classic cosine+lexical if query had only stop words
  if (!hits.length) {
    const queryEmbedding = embed(query);
    const queryTokens = new Set(tokenise(query));
    return KB_DOCUMENTS.filter(preFilter).map((doc) => {
      const semantic = Math.max(0, cosine(queryEmbedding, doc.embedding));
      const overlap = doc.tokens.reduce((count, token) => count + Number(queryTokens.has(token)), 0);
      const lexical = queryTokens.size && doc.tokens.length
        ? overlap / Math.sqrt(queryTokens.size * doc.tokens.length)
        : 0;
      const boost = boostCategories.includes(doc.category) ? 0.08 : 0;
      return { doc, relevance: Math.min(1, 0.55 * semantic + 0.45 * lexical + boost) };
    })
      .filter((item) => item.relevance > 0.04)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map(({ doc, relevance }) => ({
        id: doc.id,
        code: doc.code,
        titleFa: doc.titleFa,
        titleEn: doc.titleEn,
        authority: doc.authority,
        category: doc.category,
        bodyFa: doc.bodyFa,
        bodyEn: doc.bodyEn,
        citation: doc.citation,
        relevance,
        binding: doc.constraints,
        governance: doc.governance,
      }));
  }

  return hits.map(({ item: doc, score }) => ({
    id: doc.id,
    code: doc.code,
    titleFa: doc.titleFa,
    titleEn: doc.titleEn,
    authority: doc.authority,
    category: doc.category,
    bodyFa: doc.bodyFa,
    bodyEn: doc.bodyEn,
    citation: doc.citation,
    relevance: Number(score.toFixed(4)),
    binding: doc.constraints,
    governance: doc.governance,
  }));
}

/** All hard regulatory bindings currently in force (ACTIVE + in-window). */
export function allBindings(at: Date = new Date()): { code: string; binding: RegulatoryConstraint["binding"][number] }[] {
  return KB_DOCUMENTS.filter((doc) => isChunkActiveAt(doc.governance, at)).flatMap((doc) =>
    doc.constraints.map((binding) => ({ code: doc.code, binding })),
  );
}
