"use client";

import { useState } from "react";
import type { recommendProducts } from "@/lib/domain/recommendation";
import { Panel, fmtNum } from "./ui";

type ResponseData = ReturnType<typeof recommendProducts>;
export default function ProductRecommendationPanel({ onDesign }: { onDesign: (prompt: string) => void }) {
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [income, setIncome] = useState("");
  const [sleep, setSleep] = useState("");
  const [debt, setDebt] = useState("");
  const [deposit, setDeposit] = useState("");
  const [yieldPct, setYieldPct] = useState("");
  const [guarantee, setGuarantee] = useState("");
  const [data, setData] = useState<ResponseData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, ...(amount ? { amountToman: Number(amount) * 1e6 } : {}), ...(income ? { monthlyIncomeToman: Number(income) * 1e6 } : {}), ...(sleep !== "" ? { maxSleepMonths: Number(sleep) } : {}), ...(debt !== "" ? { existingInstallmentToman: Number(debt) * 1e6 } : {}), ...(deposit !== "" ? { availableDepositToman: Number(deposit) * 1e6 } : {}), ...(yieldPct !== "" ? { alternativeYield: Number(yieldPct) / 100 } : {}), ...(guarantee ? { availableGuarantees: [guarantee] } : {}) }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "خطا در دریافت پیشنهادها");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : "خطا در دریافت پیشنهادها"); } finally { setBusy(false); }
  }
  return <Panel>
    <div className="space-y-4" dir="rtl">
      <div><h2 className="text-lg font-bold">مقایسه و پیشنهاد تسهیلات</h2><p className="mt-1 text-sm text-slate-500">نیاز خود را شرح دهید تا طرح‌های موجود در پایگاه پژوهشی با ذکر منبع و محدودیت‌ها مقایسه شوند. از وارد کردن کد ملی، شماره حساب و اطلاعات محرمانه خودداری کنید.</p></div>
      <form onSubmit={submit} className="grid gap-3">
        <label className="text-sm">شرح نیاز <textarea required maxLength={2000} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="مثلاً وام خرید کالا بدون ضامن" className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2" /></label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-xs">مبلغ (میلیون تومان)<input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2" /></label>
          <label className="text-xs">درآمد ماهانه (میلیون تومان)<input type="number" min="0" step="any" value={income} onChange={(e) => setIncome(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2" /></label>
          <label className="text-xs">حداکثر خواب (ماه)<input type="number" min="0" step="1" value={sleep} onChange={(e) => setSleep(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2" /></label>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs">اقساط ماهانه فعلی (میلیون تومان)<input type="number" min="0" step="any" value={debt} onChange={(e) => setDebt(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2" /></label>
          <label className="text-xs">سپرده قابل استفاده (میلیون تومان)<input type="number" min="0" step="any" value={deposit} onChange={(e) => setDeposit(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2" /></label>
          <label className="text-xs">بازده سالانه جایگزین برای سناریو (درصد)<input type="number" min="0" max="100" step="any" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} placeholder="اختیاری، مثلاً ۲۶" className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2" /></label>
          <label className="text-xs">تضمین در دسترس<select value={guarantee} onChange={(e) => setGuarantee(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2"><option value="">مشخص نشده</option><option value="none">فاقد ضمانت‌های دیگر</option><option value="official-guarantor">ضامن رسمی</option><option value="sayad-cheque">چک صیادی</option><option value="sana-safteh">سفته الکترونیک</option><option value="wealth-collateral">وثیقه دارایی</option><option value="deposit-block">سپرده مسدود</option><option value="payroll-deduction">کسر از حقوق</option></select></label>
        </div>
        <button disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "در حال جست‌وجو…" : "مقایسه طرح‌ها"}</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {data && <div className="space-y-3"><p className="text-xs leading-6 text-amber-700">{data.disclaimer}</p>{(data.profile.amountToman || data.profile.monthlyIncomeToman) && <p className="text-xs">مبنای مقایسه: مبلغ {data.profile.amountToman ? `${fmtNum(data.profile.amountToman / 1e6)} میلیون تومان` : "نامشخص"}، درآمد ماهانه {data.profile.monthlyIncomeToman ? `${fmtNum(data.profile.monthlyIncomeToman / 1e6)} میلیون تومان` : "نامشخص"}. اعداد تشخیص‌داده‌شده را بررسی کنید.</p>}{data.results.length === 0 && <p>مورد مرتبطی پیدا نشد؛ شرح نیاز را تغییر دهید.</p>}{data.results.map((item) => <article key={item.code} className="rounded-lg border border-slate-200 p-3 text-sm"><h3 className="font-bold">{item.productFa} — {item.bank}</h3><p className="mt-1">سقف: {fmtNum(item.ceilingToman / 1e6)} میلیون تومان | مدت: {item.tenorMonths ?? "نامشخص"} ماه | خواب: {item.sleepMonths ?? "نامشخص"} ماه</p>{item.nominalRate !== null && <p>نرخ اسمی / کارمزد ثبت‌شده: {fmtNum(item.nominalRate * 100, 2)}٪</p>}{item.opportunityCostToman !== null && <p>سناریوی بازده جایگزین در دوره خواب: {fmtNum(item.opportunityCostToman)} تومان</p>}{item.estimatedMonthlyPaymentToman !== null && <p>قسط ماهانه تقریبی: {fmtNum(item.estimatedMonthlyPaymentToman)} تومان</p>}<p className="mt-1 text-xs leading-6">{item.notesFa}</p><p className="mt-1 text-xs text-slate-500">منبع ثبت‌شده: {item.sourceRef.startsWith("https://") ? <a href={item.sourceRef} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">صفحه منبع</a> : item.sourceRef} {item.observedAt && ` (مشاهده: ${item.observedAt})`} | واژه‌های منطبق: {item.evidence.matchedTerms.join("، ") || "شباهت متنی"}</p>{item.warnings.map((w) => <p key={w} className="text-xs text-amber-700">⚠ {w}</p>)}<button type="button" onClick={() => onDesign(`یک محصول بانکی مشابه «${item.productFa}» (${item.bank}) با سقف ${Math.round(item.ceilingToman / 1e6)} میلیون تومان برای ${item.segmentFa} طراحی کن`)} className="mt-2 rounded border border-blue-700 px-3 py-1 text-xs text-blue-700">طراحی محصول مشابه</button></article>)}{data.knowledge.length > 0 && <details className="rounded-lg border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-semibold">اسناد بازیابی‌شده مرتبط</summary><ul className="mt-2 space-y-2">{data.knowledge.map((doc) => <li key={doc.code}>{doc.titleFa} <span className="text-xs text-slate-500">— {doc.citation}</span></li>)}</ul><p className="mt-2 text-xs text-slate-500">ارتباط متن به معنی اعتبار یا شمول حقوقی نیست؛ منبع رسمی و به‌روز را بررسی کنید.</p></details>}</div>}
    </div>
  </Panel>;
}
