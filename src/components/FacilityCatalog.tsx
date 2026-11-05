"use client";

import { useMemo, useState } from "react";
import type { BenchmarkScheme } from "@/lib/domain/types";
import {
  Badge,
  EmptyState,
  IconDatabase,
  IconSearch,
  Panel,
  fmtNum,
  fmtPct,
} from "./ui";

/** Client-side facility categories (mirrors the composer wayfinder + intent parser). */
const CATEGORY_FILTERS: { key: string; label: string; match: (b: BenchmarkScheme) => boolean }[] = [
  { key: "all", label: "همه", match: () => true },
  {
    key: "scored",
    label: "امتیازی / سپرده‌محور",
    match: (b) => /نیک|نگین|مهربانی|امتیازی|نوید|اعتبار ملی/.test(`${b.productFa} ${b.notesFa}`) || /scored/i.test(b.productEn),
  },
  { key: "qh", label: "قرض‌الحسنه", match: (b) => b.contractType === "qarz-hasaneh" },
  { key: "morabaha", label: "مرابحه", match: (b) => b.contractType === "morabaha" },
  { key: "bnpl", label: "BNPL / اعتباری", match: (b) => b.contractType === "bnpl" },
  { key: "gam", label: "گام / خرید دین", match: (b) => b.contractType === "gam" || b.contractType === "kharid-deyn" },
  { key: "deposit", label: "گواهی سپرده", match: (b) => b.contractType === "mudaraba" },
  {
    key: "agri",
    label: "کشاورزی",
    match: (b) => /کشاورز|نهاده|دام|مرغ|غله|کشاورزی/.test(`${b.productFa} ${b.segmentFa} ${b.notesFa}`),
  },
  {
    key: "car",
    label: "خودرو",
    match: (b) => /خودرو|car/i.test(`${b.productFa} ${b.productEn} ${b.notesFa}`),
  },
  {
    key: "energy",
    label: "انرژی",
    match: (b) => /خورشیدی|نیروگاه|solar|ساتبا/.test(`${b.productFa} ${b.notesFa}`),
  },
  {
    key: "merchant",
    label: "پذیرندگان",
    match: (b) => /پذیرنده|POS|merchant|پی‌نو/i.test(`${b.productFa} ${b.segmentFa} ${b.productEn}`),
  },
  {
    key: "payroll",
    label: "حقوق‌بگیر / بازنشسته",
    match: (b) => /حقوق|بازنشسته|کارکنان|فرهنگیان|payroll|retiree/i.test(`${b.segmentFa} ${b.productFa} ${b.notesFa}`),
  },
];

const SOURCE_LABEL_FA: Record<string, string> = {
  bank: "بانک",
  fund: "صندوق",
  fintech: "فین‌تک",
  regulatory: "مقررات",
  press: "خبر",
};

type SortKey = "ceiling-desc" | "ceiling-asc" | "rate-desc" | "rate-asc" | "tenor-desc";

/** RAG-standard facility catalog: search + facet filters + sort over the whole KB. */
export default function FacilityCatalog({
  benchmarks,
  onUse,
}: {
  benchmarks: BenchmarkScheme[];
  onUse?: (b: BenchmarkScheme) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("ceiling-desc");

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/[\s,،]+/).filter((t) => t.length > 1);
    const categoryDef = CATEGORY_FILTERS.find((c) => c.key === category);
    let list = benchmarks.filter((b) => (categoryDef ? categoryDef.match(b) : true));
    if (tokens.length) {
      list = list.filter((b) => {
        const haystack = `${b.bank} ${b.productFa} ${b.productEn} ${b.segmentFa} ${b.segmentEn} ${b.notesFa} ${b.contractType}`.toLowerCase();
        return tokens.every((t) => haystack.includes(t));
      });
    }
    const rateOf = (b: BenchmarkScheme) => b.profitRate ?? b.feeRate ?? 0;
    const sorted = [...list];
    switch (sort) {
      case "ceiling-desc":
        sorted.sort((a, b) => b.ceilingToman - a.ceilingToman);
        break;
      case "ceiling-asc":
        sorted.sort((a, b) => a.ceilingToman - b.ceilingToman);
        break;
      case "rate-desc":
        sorted.sort((a, b) => rateOf(b) - rateOf(a));
        break;
      case "rate-asc":
        sorted.sort((a, b) => rateOf(a) - rateOf(b));
        break;
      case "tenor-desc":
        sorted.sort((a, b) => (b.tenorMonths ?? 0) - (a.tenorMonths ?? 0));
        break;
    }
    return sorted;
  }, [benchmarks, query, category, sort]);

  return (
    <Panel
      title="کاتالوگ تسهیلات بازار ایران (پایگاه دانش RAG)"
      subtitle={`${fmtNum(benchmarks.length)} محصول واقعی از شبکه بانکی، صندوق‌ها و فین‌تک‌ها — جست‌وجوی ترکیبی، فیلتر دسته‌ای و مرتب‌سازی`}
      icon={<IconDatabase className="h-4 w-4" />}
      actions={<Badge tone="teal">{fmtNum(filtered.length)} نتیجه</Badge>}
    >
      {/* search + sort controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-line bg-[rgba(4,7,13,0.6)] px-3 py-2">
          <IconSearch className="h-3.5 w-3.5 text-mist/60" />
          <input
            dir="rtl"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جست‌وجو: بانک، نام طرح، بخش هدف، عقد…"
            className="w-full bg-transparent text-[12px] text-chalk outline-none placeholder:text-mist/40"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-[10px] text-mist/60 transition hover:text-gold"
            >
              پاک‌سازی
            </button>
          ) : null}
        </div>
        <select
          dir="ltr"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-line bg-ink px-2 py-2 text-[11px] text-chalk outline-none"
        >
          <option value="ceiling-desc">سقف: بیشترین</option>
          <option value="ceiling-asc">سقف: کمترین</option>
          <option value="rate-desc">نرخ: بیشترین</option>
          <option value="rate-asc">نرخ: کمترین</option>
          <option value="tenor-desc">سررسید: طولانی‌ترین</option>
        </select>
      </div>

      {/* facet chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CATEGORY_FILTERS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={`rounded-full border px-2.5 py-1 text-[10.5px] transition ${
              category === c.key
                ? "border-gold/50 bg-gold/10 text-gold"
                : "border-line text-mist hover:border-gold/30 hover:text-chalk"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* results grid */}
      {filtered.length === 0 ? (
        <EmptyState
          title="تسهیلاتی با این فیلترها یافت نشد"
          hint="عبارت جست‌وجو یا فیلتر دسته را تغییر دهید."
          icon={<IconDatabase className="h-6 w-6" />}
        />
      ) : (
        <div className="grid max-h-[560px] gap-2 overflow-y-auto pl-1 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((b) => {
            const rate = b.profitRate ?? b.feeRate;
            return (
              <article
                key={b.code}
                className="panel-tight flex flex-col gap-1.5 p-3 transition hover:border-gold/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-[12px] font-semibold text-chalk">{b.productFa}</h4>
                    <p className="text-[10px] text-mist/70">{b.bank}</p>
                  </div>
                  <Badge tone="sky">{SOURCE_LABEL_FA[b.contractType === "qarz-hasaneh" ? "bank" : "bank"] ?? "بانک"}</Badge>
                </div>
                <div className="num grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] text-mist">
                  <span>سقف: <b className="text-chalk">{fmtNum(b.ceilingToman / 1e6, 0)} م.ت</b></span>
                  <span>
                    {b.profitRate ? "نرخ: " : b.feeRate ? "کارمزد: " : "نرخ: "}
                    <b className="text-chalk">{rate ? fmtPct(rate, 1) : "—"}</b>
                  </span>
                  {b.tenorMonths ? <span>سررسید: <b className="text-chalk">{fmtNum(b.tenorMonths)} ماه</b></span> : null}
                  {b.sleepMonths ? <span>خواب: <b className="text-chalk">{fmtNum(b.sleepMonths)} ماه</b></span> : null}
                  {b.loanToDepositRatio ? <span>ضریب: <b className="text-chalk">{fmtNum(b.loanToDepositRatio, 1)}x</b></span> : null}
                  {b.closedLoopRetention ? <span>γ: <b className="text-chalk">{fmtPct(b.closedLoopRetention, 0)}</b></span> : null}
                </div>
                <p className="line-clamp-3 text-[10px] leading-5 text-mist/80">{b.notesFa}</p>
                <p className="num mt-auto truncate border-t border-line/50 pt-1.5 text-[9px] text-mist/50" dir="ltr" title={b.code}>
                  {b.code}
                </p>
                {onUse ? (
                  <button
                    type="button"
                    onClick={() => onUse(b)}
                    className="mt-1 rounded-md border border-gold/35 bg-gold/10 px-2 py-1 text-[10px] text-gold transition hover:bg-gold/20"
                  >
                    طراحی مشابه این طرح
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
