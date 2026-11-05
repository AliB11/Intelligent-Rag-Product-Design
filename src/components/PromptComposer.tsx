"use client";

import { useState } from "react";
import type { IntentOverrides } from "@/lib/domain/intentParser";
import { IconPlay, IconStop, IconBrain, Panel, Badge, fmtNum } from "./ui";

export interface ComposerOptions {
  candidates: number;
  runs: number;
  withSensitivity: boolean;
  intentOverrides: IntentOverrides;
}

type ExamplePrompt = {
  label: string;
  prompt: string;
  controls: { hemmat: number; irr: number; ldr: number; lcr: number; overturn: number };
};

/**
 * Facility-category wayfinder — derived from the rade.ir loan taxonomy and the
 * 60+ product market registry. Clicking a chip fills a category-aware template
 * so the user never faces a blank prompt, no matter how large the KB grows.
 */
export const FACILITY_CATEGORIES: {
  key: string;
  label: string;
  hint: string;
  controls: { hemmat: number; irr: number; ldr: number; lcr: number; overturn: number };
  template: string;
}[] = [
  {
    key: "scored-credit",
    label: "امتیازی / سپرده‌محور",
    hint: "الگوی نیک، نگین، مهربانی",
    controls: { hemmat: 9, irr: 24, ldr: 85, lcr: 1.05, overturn: 4 },
    template:
      "یک بسته اعتبار امتیازی سپرده‌محور روی الگوی نیک‌وام، نگین فراپویا و مهربانی طراحی کن: امتیاز حساب به‌ازای مبلغ و مدت سپرده‌گذاری، ماتریس ضریب وام تا ۳۲۰٪ معدل، نردبان کارمزد ۰/۲/۴٪ و نردبان نرخ ۵ تا ۲۳ درصد با انتظار طولانی‌تر؛ {HEMMAT} همت منبع کم‌هزینه با ماندگاری بالا، IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و حداکثر ریسک واژگونی {OVERTURN}٪",
  },
  {
    key: "cat-car",
    label: "خودرو",
    hint: "وام خودرو، ناوگان سنگین و سبک",
    controls: { hemmat: 7, irr: 22, ldr: 85, lcr: 1.05, overturn: 5 },
    template:
      "یک بسته تسهیلات خودرو برای {HEMMAT} همت منبع طراحی کن: پوشش خودروی سواری، ناوگان سنگین و ناوگان خدمات با وثیقه خودرو؛ نرخ مرابحه ۱۸ تا ۲۳ درصد، بازپرداخت ۳۶ تا ۸۴ ماه با کسر از حقوق یا چک؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "cat-housing",
    label: "مسکن و تعمیرات",
    hint: "خرید، ساخت و جعاله تعمیر",
    controls: { hemmat: 15, irr: 21, ldr: 85, lcr: 1.05, overturn: 5 },
    template:
      "یک بسته تسهیلات مسکن برای {HEMMAT} همت منبع طراحی کن: خرید خانه، ساخت مسکن و جعاله تعمیرات با سپرده‌گذاری بلندمدت ۱۰ تا ۱۲ ماهه؛ نرخ ۲۱ تا ۲۳ درصد و بازپرداخت تا ۱۲۰ ماه؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "cat-marriage",
    label: "ازدواج و فرزندآوری",
    hint: "قرض‌الحسنه دولتی و بانکی",
    controls: { hemmat: 3, irr: 8, ldr: 85, lcr: 1.05, overturn: 5 },
    template:
      "یک بسته قرض‌الحسنه ازدواج و فرزندآوری برای {HEMMAT} همت منبع طراحی کن: کارمزد حداکثر ۴ درصد (سقف قانونی)، سقف ۳۰۰ میلیون تومان فردی، بازپرداخت ۶۰ ماهه با کسر از حقوق؛ هدف پوشش صندوق دولتی و منابع بانک؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "cat-agri",
    label: "کشاورزی و دام",
    hint: "نهاده، غلات، دام و طیور",
    controls: { hemmat: 6, irr: 23, ldr: 85, lcr: 1.05, overturn: 5 },
    template:
      "یک بسته تأمین مالی کشاورزی برای {HEMMAT} همت منبع طراحی کن: خرید نهاده و دام، تولید غلات و تسویه در محل خرید تضمینی محصول (خرید دین/گام)؛ نرخ تا ۲۰ درصد، بازپرداخت فصلی ۱۲ تا ۳۶ ماه؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "cat-energy",
    label: "انرژی خورشیدی",
    hint: "نیروگاه خانگی و تجاری با یارانه ساتبا",
    controls: { hemmat: 4, irr: 17, ldr: 85, lcr: 1.05, overturn: 4 },
    template:
      "یک بسته تسهیلات نیروگاه خورشیدی برای {HEMMAT} همت منبع طراحی کن: نیروگاه‌های خانگی ۵ تا ۱۰ کیلوواتی و تجاری تا ۲۰۰ کیلووات با یارانه سود ساتبا و خرید تضمینی برق؛ نرخ ۱۴ درصد و بازپرداخت ۶۰ ماهه؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "cat-retiree",
    label: "بازنشستگان",
    hint: "کسر از حقوق بازنشستگی",
    controls: { hemmat: 2, irr: 8, ldr: 85, lcr: 1.05, overturn: 4 },
    template:
      "یک بسته تسهیلات بازنشستگان برای {HEMMAT} همت منبع طراحی کن: وام خرد ۶۰ تا ۲۰۰ میلیون تومانی با کسر مستقیم از حقوق بازنشستگی، کارمزد حداکثر ۴ درصد و بازپرداخت ۱۶ تا ۲۴ ماه؛ دروازه رتبه اعتباری و سن زیر ۷۷ سال؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "cat-student",
    label: "دانشجویی",
    hint: "تحصیلی و معیشت دانشجو",
    controls: { hemmat: 2, irr: 8, ldr: 85, lcr: 1.05, overturn: 4 },
    template:
      "یک بسته تسهیلات دانشجویی برای {HEMMAT} همت منبع طراحی کن: وام تحصیلی و معیشتی با کارمزد حداکثر ۴ درصد، بازپرداخت پس از فراغت از تحصیل، و اعتبار خرید اقساطی لوازم تحصیل؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "merchant-float",
    label: "پذیرندگان POS",
    hint: "اعتبار یک‌شبه و سرمایه در گردش",
    controls: { hemmat: 12, irr: 28, ldr: 85, lcr: 1.05, overturn: 4 },
    template:
      "برای پذیرندگان پایانه فروش و درگاه‌های پرداخت یک محصول چندطرحی طراحی کن که {HEMMAT} همت شناور تسویه جذب کند، اعتبار یک‌شبه فوری بر پایه رتبه عملکردی بدهد، IRR حداقل {IRR}٪ و ریسک واژگونی منابع زیر {OVERTURN}٪ با بیشترین ماندگاری حلقه بسته ممکن؛ سقف LDR {LDR}٪ و کف LCR {LCR}",
  },
  {
    key: "supply-chain",
    label: "زنجیره تأمین",
    hint: "اوراق گام، خرید دین، تأمین‌یار",
    controls: { hemmat: 10, irr: 24, ldr: 85, lcr: 1.05, overturn: 6 },
    template:
      "یک ساختار چندطرحی برای زنجیره تأمین صنایع با اوراق گام و خرید دین طراحی کن: {HEMMAT} همت منبع، هدف ROE حداقل ۳۰٪، حلقه بسته تأمین‌کننده-تولیدکننده-توزیع، حداکثر LDR {LDR}٪، حداقل LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "salary-float",
    label: "حقوق‌بگیران",
    hint: "شناوری حقوق و اعتبار سازمانی",
    controls: { hemmat: 8, irr: 23, ldr: 85, lcr: 1.05, overturn: 4 },
    template:
      "یک بسته اعتباری حقوق‌بگیران برای {HEMMAT} همت منبع طراحی کن: شناوری حقوق به‌عنوان منبع کم‌هزینه، اعتبار مصرفی با کسر از حقوق، قرض‌الحسنه کارکنان و مرابحه مصرفی؛ نرخ تا ۲۳ درصد، بازپرداخت ۳۶ تا ۴۸ ماه؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
  {
    key: "cat-sme",
    label: "خوداشتغالی و SME",
    hint: "اشتغال‌زایی و تجهیز کارگاه",
    controls: { hemmat: 5, irr: 21, ldr: 85, lcr: 1.05, overturn: 5 },
    template:
      "یک بسته تسهیلات خوداشتغالی و اشتغال‌زایی برای {HEMMAT} همت منبع طراحی کن: تجهیز کارگاه، سرمایه در گردش کسب‌وکارهای خرد با کارمزد ترجیحی و بازپرداخت متناسب با جریان درآمد؛ IRR حداقل {IRR}٪، سقف LDR {LDR}٪، کف LCR {LCR} و واژگونی حداکثر {OVERTURN}٪",
  },
];

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    label: "۲۰ همت — ماتریس ۴ طرحی میانگین حساب",
    controls: { hemmat: 20, irr: 26, ldr: 85, lcr: 1.05, overturn: 6 },
    prompt:
      "یک بسته بانکی ۴ طرحی پلکانی مبتنی بر میانگین حساب طراحی کن تا ۲۰ همت منبع جذب شود؛ هدف نرخ بازده داخلی بانک حداقل ۲۶٪، سقف نسبت خالص تسهیلات به سپرده ۸۵٪، کف نسبت پوشش نقدینگی ۱٫۰۵ و حداکثر ریسک واژگونی منابع ۶٪ با ترکیب قرض‌الحسنه خرد، مرابحه، شتاب‌دهنده پذیرندگان POS و لنگر شناوری شرکتی",
  },
  {
    label: "پزشکان متخصص و کلینیک دندانپزشکی — حلقه بسته B2B2C",
    controls: { hemmat: 6, irr: 25, ldr: 85, lcr: 1.05, overturn: 2 },
    prompt:
      "برای پزشکان متخصص و کلینیک‌های دندانپزشکی یک بسته تخصصی حلقه بسته B2B2C طراحی کن: ۶ همت منبع، هدف IRR حداقل ۲۵٪، حداکثر نسبت تسهیلات به سپرده ۸۵٪، حداقل پوشش نقدینگی ۱٫۰۵، ریسک واژگونی منابع نزدیک صفر، با تأمین مالی تجهیزات کلینیک از زنجیره تأمین و اعتبار مصرفی بیمار (BNPL) و تسویه مستقیم نزد مراکز درمانی طرف قرارداد",
  },
  {
    label: "پذیرندگان POS و اعتبار یک‌شبه (الگوی پی‌نو)",
    controls: { hemmat: 12, irr: 28, ldr: 85, lcr: 1.05, overturn: 4 },
    prompt:
      "برای پذیرندگان پایانه فروش و درگاه‌های پرداخت یک محصول چندطرحی طراحی کن که ۱۲ همت شناور تسویه جذب کند، اعتبار یک‌شبه فوری بر پایه رتبه عملکردی بدهد، IRR حداقل ۲۸٪ و ریسک واژگونی منابع زیر ۴٪ با بیشترین ماندگاری حلقه بسته ممکن",
  },
  {
    label: "زنجیره تأمین صنعتی با اوراق گام",
    controls: { hemmat: 10, irr: 26, ldr: 85, lcr: 1.05, overturn: 6 },
    prompt:
      "یک ساختار چندطرحی برای زنجیره تأمین صنایع با اوراق گام و خرید دین طراحی کن: ۱۰ همت منبع، هدف ROE حداقل ۳۰٪، حلقه بسته تأمین‌کننده-تولیدکننده-توزیع، حداکثر LDR ۸۵٪ و حداقل LCR ۱٫۰۵",
  },
  {
    label: "اقشار آسیب‌پذیر و روستایی (شمول مالی)",
    controls: { hemmat: 4, irr: 22, ldr: 85, lcr: 1.05, overturn: 5 },
    prompt:
      "برای اقشار آسیب‌پذیر، روستاییان و زنان سرپرست خانوار یک بسته قرض‌الحسنه چندطرحی با اولویت شمول مالی طراحی کن؛ ۴ همت منبع، کارمزد حداکثر ۴٪، مسدودی حداقل، IRR هدف ۲۲٪ و تحمل ریسک واژگونی ۵٪",
  },
  {
    label: "اعتبار امتیازی سپرده‌محور (الگوی نیک/نگین/مهربانی)",
    controls: { hemmat: 9, irr: 24, ldr: 85, lcr: 1.05, overturn: 4 },
    prompt:
      "یک بسته اعتبار امتیازی سپرده‌محور روی الگوی نیک‌وام، نگین فراپویا و مهربانی طراحی کن: امتیاز حساب به‌ازای مبلغ و مدت سپرده‌گذاری، ماتریس ضریب وام تا ۳۲۰٪ معدل، نردبان کارمزد ۰/۲/۴٪ و نردبان نرخ ۵ تا ۲۳ درصد با انتظار طولانی‌تر؛ ۹ همت منبع کم‌هزینه با ماندگاری بالا، IRR حداقل ۲۴٪، سقف LDR ۸۵٪، کف LCR ۱٫۰۵ و حداکثر ریسک واژگونی ۴٪",
  },
];

interface Props {
  busy: boolean;
  onSubmit: (prompt: string, options: ComposerOptions) => void;
  onCancel: () => void;
  initialPrompt?: string;
}

export default function PromptComposer({ busy, onSubmit, onCancel, initialPrompt = "" }: Props) {
  const [prompt, setPrompt] = useState(initialPrompt || EXAMPLE_PROMPTS[0].prompt);
  const [hemmat, setHemmat] = useState(20);
  const [irr, setIrr] = useState(26);
  const [ldr, setLdr] = useState(85);
  const [lcr, setLcr] = useState(1.05);
  const [overturn, setOverturn] = useState(6);
  const [candidates, setCandidates] = useState(26);
  const [runs, setRuns] = useState(1000);
  const [withSensitivity, setWithSensitivity] = useState(true);
  const [intentOverrides, setIntentOverrides] = useState<IntentOverrides>({});

  const setIntentOverride = <K extends keyof IntentOverrides>(key: K, value: IntentOverrides[K]) => {
    setIntentOverrides((current) => ({ ...current, [key]: value }));
  };

  const selectExample = (example: ExamplePrompt) => {
    setPrompt(example.prompt);
    setIntentOverrides({});
    setHemmat(example.controls.hemmat);
    setIrr(example.controls.irr);
    setLdr(example.controls.ldr);
    setLcr(example.controls.lcr);
    setOverturn(example.controls.overturn);
  };

  /** Facility-category wayfinder: fill a smart template with live slider values. */
  const selectCategory = (category: (typeof FACILITY_CATEGORIES)[number]) => {
    const filled = category.template
      .replace(/\{HEMMAT\}/g, String(category.controls.hemmat))
      .replace(/\{IRR\}/g, String(category.controls.irr))
      .replace(/\{LDR\}/g, String(category.controls.ldr))
      .replace(/\{LCR\}/g, String(category.controls.lcr))
      .replace(/\{OVERTURN\}/g, String(category.controls.overturn));
    setPrompt(filled);
    setIntentOverrides({});
    setHemmat(category.controls.hemmat);
    setIrr(category.controls.irr);
    setLdr(category.controls.ldr);
    setLcr(category.controls.lcr);
    setOverturn(category.controls.overturn);
  };

  const compose = () => {
    onSubmit(prompt, {
      candidates,
      runs,
      withSensitivity,
      intentOverrides,
    });
  };

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
    onChange: (v: number) => void,
    digits = 0,
  ) => (
    <label className="panel-tight block px-3 py-2">
      <div className="flex items-center justify-between text-[11px] text-mist">
        <span>{label}</span>
        <span className="num text-gold">
          {fmtNum(value, digits)} {unit}
        </span>
      </div>
      <input
        type="range"
        dir="ltr"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-1 w-full cursor-pointer appearance-none rounded-full bg-[rgba(255,255,255,0.1)] accent-[#e0b25c]"
      />
    </label>
  );

  return (
    <Panel
      title="آهنگساز درخواست راهبردی (Goal-Seeking Prompt Composer)"
      subtitle="اهداف کلان، حجم منابع، حدود سودآوری و تحمل ریسک را به زبان طبیعی وارد کنید؛ سامانه قیود و تابع هدف را خودش استخراج می‌کند."
      icon={<IconBrain className="h-4 w-4" />}
      actions={
        busy ? (
          <Badge tone="gold">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-gold" />
            در حال حل معکوس…
          </Badge>
        ) : (
          <Badge tone="teal">آماده</Badge>
        )
      }
    >
      <div className="space-y-3">
        {/* Facility-category wayfinder (rade.ir loan taxonomy over 60+ products) */}
        <div>
          <p className="mb-1.5 text-[10px] text-mist/70">
            راهنمای دسته‌بندی: یک خانواده تسهیلاتی را انتخاب کنید تا قالب هوشمند با اهداف پیشنهادی پر شود
          </p>
          <div className="flex flex-wrap gap-1.5">
            {FACILITY_CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                type="button"
                disabled={busy}
                title={cat.hint}
                onClick={() => selectCategory(cat)}
                className="group rounded-lg border border-line bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5 text-left text-[10.5px] text-mist transition hover:border-gold/40 hover:text-gold disabled:opacity-40"
              >
                <span className="block font-medium text-chalk group-hover:text-gold">{cat.label}</span>
                <span className="block text-[9px] leading-4 text-mist/60">{cat.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex.label}
              type="button"
              disabled={busy}
              onClick={() => selectExample(ex)}
              className="rounded-full border border-line bg-[rgba(255,255,255,0.02)] px-2.5 py-1 text-[10.5px] text-mist transition hover:border-gold/40 hover:text-gold disabled:opacity-40"
            >
              {ex.label}
            </button>
          ))}
        </div>

        <textarea
          dir="rtl"
          value={prompt}
          disabled={busy}
          onChange={(e) => {
            setPrompt(e.target.value);
            setIntentOverrides({});
          }}
          rows={6}
          className="w-full resize-y rounded-xl border border-line bg-[rgba(4,7,13,0.75)] p-3 text-[12.5px] leading-7 text-chalk outline-none transition placeholder:text-mist/50 focus:border-gold/50 focus:ring-1 focus:ring-gold/25"
          placeholder="مثلاً: یک محصول ۴ طرحی برای جذب ۲۰ همت منبع با IRR حداقل ۲۶٪ و سقف LDR برابر ۸۵٪ طراحی کن…"
        />

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {slider("منابع هدف", hemmat, 1, 60, 1, "همت", (value) => {
            setHemmat(value);
            setIntentOverride("targetDepositsHemmat", value);
          })}
          {slider("حداقل IRR بانک", irr, 15, 45, 0.5, "٪", (value) => {
            setIrr(value);
            setIntentOverride("targetIrr", value / 100);
          }, 1)}
          {slider("سقف LDR", ldr, 60, 95, 1, "٪", (value) => {
            setLdr(value);
            setIntentOverride("ldrCeiling", value / 100);
          })}
          {slider("کف LCR", lcr, 1, 1.6, 0.01, "", (value) => {
            setLcr(value);
            setIntentOverride("lcrFloor", value);
          }, 2)}
          {slider("تحمل واژگونی منابع", overturn, 1, 15, 0.5, "٪", (value) => {
            setOverturn(value);
            setIntentOverride("maxOverturningShock", value / 100);
          }, 1)}
          {slider("کاندیدهای ساختاری", candidates, 8, 60, 2, "", setCandidates)}
        </div>
        <p className="text-[10px] leading-5 text-mist/70">
          اهداف موجود در متن آزاد مبنا هستند؛ با جابه‌جایی هر اسلایدر، همان هدف به‌صورت صریح بر متن اولویت می‌گیرد.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="panel-tight flex items-center gap-2 px-3 py-2 text-[11px] text-mist">
              <span>مسیرهای مونت‌کارلو</span>
              <select
                dir="ltr"
                value={runs}
                disabled={busy}
                onChange={(e) => setRuns(Number(e.target.value))}
                className="num rounded-md border border-line bg-ink px-2 py-1 text-[11px] text-chalk outline-none"
              >
                {[200, 400, 1000, 2000].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => setWithSensitivity((v) => !v)}
              className={`panel-tight px-3 py-2 text-[11px] transition ${
                withSensitivity
                  ? "border-gold/40 text-gold"
                  : "text-mist hover:text-chalk"
              }`}
            >
              داشبورد حساسیت‌سنجی: {withSensitivity ? "روشن" : "خاموش"}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {busy ? (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose/40 bg-rose/10 px-4 py-2 text-[12px] text-rose transition hover:bg-rose/20"
              >
                <IconStop className="h-3.5 w-3.5" />
                توقف
              </button>
            ) : null}
            <button
              type="button"
              onClick={compose}
              disabled={busy || prompt.trim().length < 8}
              className="relative inline-flex items-center gap-2 overflow-hidden rounded-lg border border-gold/50 bg-gradient-to-b from-gold/25 to-gold/10 px-5 py-2 text-[12.5px] font-semibold text-gold transition hover:from-gold/35 hover:to-gold/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconPlay className="h-3.5 w-3.5" />
              اجرای خط لوله پنج‌مرحله‌ای
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
