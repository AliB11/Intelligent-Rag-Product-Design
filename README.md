<div dir="rtl">

# مولد خودگردان محصول بانکی و دوقلوی دیجیتال ALM

**سامانه تولید معکوس (Inverse Goal-Seeking) محصول بانکی برای زیست‌بوم بانکی ایران**
MILP/MINLP · مونت‌کارلو ۶۰ ماهه · خط لوله هفت‌گره‌ای LangGraph · RAG مقررات بانک مرکزی

[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22-339933?logo=nodedotjs&logoColor=white)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Next.js](https://img.shields.io/badge/Next.js-16_App_Router-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16_%2B_Drizzle-4169E1?logo=postgresql&logoColor=white)](src/db)
[![Tests](https://img.shields.io/badge/verification-33%2F33_passing-2EA043)](src/lib/verification/financialEngineTests.ts)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

## فهرست

1. [چرا این سامانه متفاوت است](#۱-چرا-این-سامانه-متفاوت-است)
2. [معماری پنج‌مرحله‌ای](#۲-معماری-پنج‌مرحله‌ای)
3. [موتور مالی قطعی](#۳-موتور-مالی-قطعی)
4. [خط لوله چندعاملی](#۴-خط-لوله-چندعاملی)
5. [راه‌اندازی سریع](#۵-راه‌اندازی-سریع)
6. [مجموعه آزمون راستی‌آزمایی](#۶-مجموعه-آزمون-راستی‌آزمایی)
7. [مرجع API](#۷-مرجع-api)
8. [پایگاه داده](#۸-پایگاه-داده)
9. [ساختار مخزن](#۹-ساختار-مخزن)
10. [نگاشت به معماری مرجع Python](#۱۰-نگاشت-به-معماری-مرجع-python)

---

<div dir="rtl">

## ۱) چرا این سامانه متفاوت است

شبیه‌سازهای متعارف بانکی **رو به جلو** کار می‌کنند: کاربر نرخ سود سپرده، ضریب تسهیلات و سررسید را
دستی وارد می‌کند و یک خروجی ایستگاهی می‌بیند.

این سامانه **معکوس** کار می‌کند. ورودی، هدف راهبردی است:

> «۲۰ همت منبع جذب کن، IRR بانک حداقل ۲۶٪، p95 نسبت تسهیلات به سپرده حداکثر ۸۵٪،
> کف پوشش نقدینگی ۱٫۰۵، ریسک واژگونی منابع زیر ۶٪ — برای پزشکان متخصص.»

سامانه خودش **تابع هدف و قیود صوری** را می‌سازد، مقررات را بازیابی می‌کند، ساختار بهینه را
حل می‌کند، آن را در دوقلوی دیجیتال ALM آزمون تنش می‌دهد، و اگر موجه نبود خودش را اصلاح می‌کند —
تا پنج گام.

### قاعده بنیادین معماری

> **مدل‌های زبانی هیچ عدد مالی محاسبه نمی‌کنند.**

هر ریال، هر نرخ، هر صدک و هر سنجه ریسک از موتور قطعی `src/lib/domain/` بیرون می‌آید و
**بازتولیدپذیر** است (یک بذر ⇒ یک خروجی، در حد ۱۰⁻¹²). مدل زبانی فقط قصد کاربر را تجزیه می‌کند،
وزن‌های هدف را انتخاب می‌کند و متن استدلال را می‌سازد.

## ۲) معماری پنج‌مرحله‌ای

| مرحله | کار | پیاده‌سازی |
| :---: | --- | --- |
| **۱** | تجزیه قصد طبیعی (فارسی/انگلیسی) به تابع هدف و قیود صوری | `intentParser.ts` |
| **۲** | بازیابی سقف‌های بانک مرکزی و قواعد عقود اسلامی | `rag/knowledgeBase.ts` (embedding ۱۲۸ بُعدی + جست‌وجوی ترکیبی) |
| **۳** | سنتز ساختار تک‌طرحی یا چندطرحی با MILP/MINLP | `optimizer.ts` |
| **۴** | آزمون تنش مونت‌کارلو در دوقلوی دیجیتال ALM | `almSimulator.ts` |
| **۵** | صدور مشخصات، ماتریس، داشبورد حساسیت و پیش‌نویس انطباق | `agents/graph.ts` + `agents/reportGenerator.ts` |

## ۳) موتور مالی قطعی

### ۳.۱ هزینه تمام‌شده مؤثر منابع (`cost_of_funds`)

```text
CoF_m = ( r_d,m − RR_m · r_CB_reward ) / ( 1 − RR_m + LR_m ) + θ_OpEx + θ_EL,m
θ_EL,m = PD_m × LGD_m
```

سپرده قانونی پیش‌فرض: قرض‌الحسنه پس‌انداز و جاری **۲٪**، کوتاه‌مدت **۱۰٪**، بلندمدت **۱۵٪**،
اوراق مشارکت و گام **۰٪** · پاداش بانک مرکزی **۱٪** · ضریب نقدینگی صندوق و خودپرداز **۱٪** ·
هزینه عملیاتی **۳٫۵٪**.

### ۳.۲ موتور امتیاز و میانگین موزون (`point_engine`)

```text
B̄_m = (1/N_d) Σ B_m,t · κ_source ,   N_d = 30 · τ_d,m          κ: خرد ۱٫۰ | POS ۱٫۵ | حقوق ۱٫۳
L_m = α_m · B̄_m   subject to L_max,m
NPV_bank,m = Σ_{t=1..τ_d} B̄(1−RR)(r_treasury − CoF)/(1+r_h/12)^t
             − L_m(1 − γ_m − β_m)
             + Σ_{k=1..τ_l} [PMT(r_l/12, τ_l, L_m) − Release_k(β_m·B̄)] / (1+r_h/12)^(τ_d+ω+k)  ≥ 0
```

معادل عملیاتی (NPV) در هر طرح باید نامنفی باشد؛ `solveBreakEvenLoanRate` کوچک‌ترین نرخ مجاز
داخل سقف مصوب را برمی‌گرداند و `installmentAffordability` قید «قسط ≤ ۴۰٪ درآمد خالص» را اعمال می‌کند.

### ۳.۳ دوقلوی دیجیتال ALM و ریسک واژگونی منابع

چرخه کوهورت‌ها در افق ۶۰ ماهه: خواب سپرده `τ_d` ← صف انتظار `ω` ← اعطای تسهیلات ← بازپرداخت `τ_l`.

* **δ_m** کسر برداشت آزاد در لحظه اعطا ~ **بتا** (۱۰۰۰ مسیر مونت‌کارلو)
* **β_m** سهم مسدودی هوشمند، با آزادسازی **خطی / میانی (۵۰٪ اقساط) / در سررسید**
* **γ_m** ماندگاری حلقه بسته: سهم تسهیلات که نزد پذیرندگان و تأمین‌کنندگان همان بانک تسویه شده و
  بلافاصله به‌صورت سپرده جاری کم‌هزینه به بدهی بانک بازمی‌گردد
* خروجی هر ماه: `LDR(t) = مانده تسهیلات / (سپرده × (1−RR وزنی))`، `LCR(t) = HQLA / خروج تنیده ۳۰ روزه`،
  درآمد **مشاع** و **غیرمشاع**، `IRR_bank`, `ROI`, `ROE`, `NIM` و شاخص پایداری منابع

**قاعده انحلال‌پذیری:** صدک ۹۵ `LDR(t)` هرگز > **۰٫۸۵** و صدک ۵ `LCR(t)` هرگز < **۱٫۰۵**.

### ۳.۴ حل‌کننده معکوس

```text
max_X   λ₁·IRR_bank(X) + λ₂·CustomerAdoptionScore(X)
        − λ₃·max_t( max(0, LDR(t) − 0.80)² )
        − λ₄·OverturningShock(X)

s.t.    Σ_m D_m = D_target  (مثلاً ۲۰ همت)
        سقف کارمزد قرض‌الحسنه ۴٪ | سقف نرخ مرابحه ۲۳٪ | سقف مطلق ۲۸٫۷٪
        PMT ≤ ۴۰٪ درآمد خالص ماهانه پرسونا
        p95 LDR ≤ 0.85 , p5 LCR ≥ 1.05
```

چهار زیرمسئله: **(A)** انتخاب صحیح کهن‌الگوها (متغیرهای ۰/۱) · **(B)** تخصیص آبشاری LP وزن‌ها
با `Σw = 1` · **(C)** جست‌وجوی ساختاری بذردار + بازجستجوی مختصاتی روی `{τ_d, α, τ_l, r_l, β, ω, γ}`
· **(D)** حلقه خوداصلاحی ممیز تا ۵ گام (افزایش β/γ، تمدید ω، **پلکانی‌سازی** τ_d، کاهش α، تمدید τ_l).

## ۴) خط لوله چندعاملی

گره‌های `StateGraph` با مسیریابی شرطی:

```text
intent_analyzer ──▶ regulatory_rag ──┬─(persona شناسایی شد)──▶ guild_persona ──┐
                                     └───────────────────────────────────────┤
                                             ◀──────────────────────────────┤
                                     ┌──── mathematical_synthesizer ◀───────┘
                                     ▼
                              alm_stress_tester ──▶ critic_auditor
                                     ▲                   │
                                     └── (blocker && iteration < 5) ──┘
                                                         │ otherwise
                                                         ▼
                                          executive_report_generator ──▶ END
```

همه رویدادهای گره‌ها به‌صورت زنده با **Server-Sent Events** به رابط کاربری پخش می‌شوند.

## ۵) راه‌اندازی سریع

### پیش‌نیازها

| ابزار | نسخه |
| --- | --- |
| Node.js | 22 (`.nvmrc`) |
| PostgreSQL | 14+ (پیشنهادی: ایمیج `pgvector/pgvector:pg16`) |
| npm | 10+ |

```bash
git clone https://github.com/<org>/alm-digital-twin.git
cd alm-digital-twin

npm ci
cp .env.example .env                 # DATABASE_URL را تنظیم کنید
npm run db:push                        # بازبینی و همگام‌سازی طرح پایگاه داده

npm run dev                          # http://localhost:3000
```

بذرگذاری پایگاه دانش (۱۸ سند مقرراتی و ۲۷ بنچمارک واقعی بانکی) در نخستین فراخوانی API به‌صورت
idempotent انجام می‌شود.

### با Docker

```bash
docker compose up --build -d         # postgres + app روی پورت ۳۰۰۰
docker compose --profile tools run --rm db-push  # همگام‌سازی افزایشی طرح داده
curl localhost:3000/api/health
```

### کلیدهای میان‌بر (`make help`)

| دستور | کار |
| --- | --- |
| `make ci` | کل خط لوله CI به‌صورت محلی: lint + typegen + typecheck + build + verify-fast |
| `make verify` | مجموعه کامل آزمون؛ TC1 با ۱۰۰۰ و TC2 با ۴۰۰ مسیر مونت‌کارلو |
| `make verify-fast` | نسخه سریع مناسب CI |
| `make smoke` | آزمون دود سرور در حال اجرا |
| `make db-push` / `make db-studio` | همگام‌سازی و بازبینی داده |

## ۶) مجموعه آزمون راستی‌آزمایی

`node scripts/verify.mjs` — آزمون‌های قطعی TypeScript، بدون نیاز به دیتابیس یا شبکه.

| آزمون | ادعاها |
| --- | --- |
| **TC0** لایه واحد + قطعیت | نرمال‌سازی ارقام فارسی/عربی و درصد/اعشار · اولویت مقدار صریح Composer · فرمول و حل معکوس CoF · سازگاری PMT/NPV/IRR · نقطه‌موتور و صدک‌ها · تخصیص LP · بازتولیدپذیری مالی |
| **TC-CORRECTION** اصلاح‌گر | جهت اصلاح LDR/LCR واقعاً سنجه شبیه‌سازی‌شده را بهتر می‌کند · تعداد مسیر درخواستی حفظ می‌شود · شمار نامعتبر رد می‌شود · بذر حساسیت بازتولیدپذیر و مؤثر است |
| **TC-GRAPH** کنترل اجرا | بودجه گام‌های گراف از حلقه نامحدود جلوگیری می‌کند · لغو پیش از اجرا و هنگام شبیه‌سازی مونت‌کارلو آزموده می‌شود |
| **TC1** محصول ۲۰ همتی چندطرحی | حداقل ۴ طرح · برابری Σ منابع با هدف · IRR، LDR، LCR، واژگونی و توان بازپرداخت · ALM نهایی با دقیقاً تعداد مسیر درخواستی · گزارش وضعیت اعتبارسنجی صریح |
| **TC2** زیست‌بوم حلقه‌بسته پزشکی | شناسایی پزشک/دندان‌پزشک · زیست‌بوم سه‌جانبه · حفظ حلقه منابع · کنترل هم‌زمان LDR/LCR · اسناد حسابداری و انطباق · تعداد مسیر ALM دقیق |

```console
$ node scripts/verify.mjs --fast
SUITE PASSED — 47/47 assertions

  TC1  irrBankAnnual = 0.2903  p95Ldr = 0.6467  p5Lcr = 1.392  overturning = 0.0201
  TC2  irrBankAnnual = 0.2947  p95Ldr = 0.4843  p5Lcr = 1.392  overturning = 0.0192
```

For the standard final ALM, the requested run count is never silently reduced.
If correction retries still leave a hard blocker, the result is marked
`not_validated`; the suite also checks that sensitivity sweeps honor their seed.

## ۷) مرجع API

| متد | مسیر | شرح |
| --- | --- | --- |
| `GET` | `/api/health` | سلامت سرویس و وضعیت صریح persistence (PostgreSQL یا حافظه) |
| `POST` | `/api/generate` | اجرای خط لوله کامل؛ پاسخ **SSE** با فریم‌های `status`, `trace`, `result`, `done` |
| `GET` | `/api/benchmarks?q=` | پایگاه دانش مقرراتی + ثبت بنچمارک بانکی ایران |
| `GET` | `/api/runs` / `/api/runs?id=` | تاریخچه اجراها / ردپای کامل حسابرسی یک اجرا |
| `GET` | `/api/selftest?fast=1` | اجرای مجموعه آزمون راستی‌آزمایی |

### نمونه

```bash
curl -N -X POST localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "یک بسته ۴ طرحی میانگین حساب برای جذب ۲۰ همت منبع با IRR حداقل ۲۶٪، سقف LDR ۸۵٪، کف LCR ۱٫۰۵ و حداکثر ریسک واژگونی ۶٪",
    "candidates": 26,
    "runs": 1000,
    "withSensitivity": true
  }'
```

بدنه پاسخ `result` شامل: `request` (قصد تجزیه‌شده و وزن‌های λ)، `constraints` (قیود الزام‌آور بازیابی‌شده)،
`ecosystem` (زیست‌بوم سه‌جانبه صنفی)، `product` (ماتریس چندطرحی)، `alm` (سنجه‌ها، سری ماهانه، پاکت‌های صدکی،
هیستوگرام واژگونی)، `findings` (یافته‌های ممیز)، `sensitivity`، `accountingEntries`، `complianceDraft`
و `reportFa` / `reportEn`.

## ۸) پایگاه داده

| جدول | نقش |
| --- | --- |
| `kb_documents` | فروشنده برداری اسناد مقرراتی (توکن‌ها + بردار ۱۲۸ بُعدی + قیود الزام‌آور) |
| `benchmarks` | ثبت بنچمارک محصولات بانکی ایران با پارامترهای ساختاری |
| `generation_runs` | ردپای کامل حسابرسی: قصد، قیود، ساختار، سنجه‌ها، حساسیت و رویدادهای گره‌ها |

طرح داده در `src/db/schema.ts` (Drizzle ORM) تعریف شده و با `npx drizzle-kit push` اعمال می‌شود.

## ۹) ساختار مخزن

```text
.
├── .github/workflows/ci.yml     کیفیت + آزمون + build + تصویر Docker
├── src/
│   ├── lib/
│   │   ├── domain/              موتور مالی قطعی (بدون LLM، بدون I/O شبکه)
│   │   │   ├── constants.ts     سیستم واحدها (۱ همت = ۱۰¹³ ریال) و حدود مقرراتی
│   │   │   ├── financial.ts     PRNG بذردار، بتا/گاما، IRR/NPV/PMT، صدک
│   │   │   ├── costOfFunds.ts   هزینه تمام‌شده منابع + حل معکوس
│   │   │   ├── pointEngine.ts   میانگین موزون، امتیاز، مسدودی، NPV بانک
│   │   │   ├── almSimulator.ts  دوقلوی دیجیتال ALM و ریسک واژگونی منابع
│   │   │   ├── optimizer.ts     حل‌کننده معکوس MILP/MINLP + ممیز + حساسیت
│   │   │   ├── intentParser.ts  تجزیه قصد طبیعی فارسی/انگلیسی
│   │   │   ├── guildValueChain.ts  پرسونا و زیست‌بوم سه‌جانبه حلقه بسته
│   │   │   └── types.ts         اسکیماهای سخت‌گیرانه دامنه
│   │   ├── agents/              StateGraph هفت‌گره‌ای + گزارش مدیریتی
│   │   ├── rag/                 فروشنده برداری + ثبت بنچمارک بانکی
│   │   ├── verification/        مجموعه آزمون راستی‌آزمایی
│   │   └── db/                  لایه ماندگاری و بذرگذاری
│   ├── app/                     رابط RTL فارسی + مسیرهای API
│   ├── components/              آهنگساز درخواست، جریان عامل‌ها، ماتریس، نمودارها، بوم صنف
│   └── db/schema.ts             جدول‌های PostgreSQL
├── scripts/                     verify.mjs · smoke.mjs
├── docs/                        معماری، موتور مالی، مرجع API، نگاشت Python
├── Dockerfile · docker-compose.yml · Makefile
└── .env.example
```

## ۱۰) نگاشت به معماری مرجع Python

سند [docs/PYTHON_WORKSPACE_MAP.md](docs/PYTHON_WORKSPACE_MAP.md) نگاشت یک‌به‌یک هر ماژول درخواستی
در معماری مرجع (FastAPI، LangGraph، Celery، ChromaDB، OR-Tools) به دوقلوی TypeScript اجراشده در
این مخزن را نشان می‌دهد.

## مشارکت

راهنمای کامل در [CONTRIBUTING.md](CONTRIBUTING.md) — مهم‌ترین قاعده: **مدل زبانی هرگز عدد مالی
محاسبه نمی‌کند** و سامانه باید بازتولیدپذیر بماند.

## مجوز و سلب مسئولیت

[MIT](LICENSE). این مخزن ابزار پژوهشی، آموزشی و طراحی داخلی محصول است. حدود مقرراتی بذرداری‌شده
کالیبراسیون نمونه‌اند و پیش از هر استفاده عملیاتی باید با بخشنامه‌های روز بانک مرکزی و شورای پول و
اعتبار راستی‌آزمایی شوند. خروجی مدل جایگزین مصوبات قانونی یا مشاوره سرمایه‌گذاری نیست.

</div>
