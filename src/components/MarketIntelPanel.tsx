"use client";

import type { MarketIntel } from "@/lib/agents/state";
import { ARCHETYPE_LABEL_FA } from "@/lib/domain/guildValueChain";
import {
  Badge,
  EmptyState,
  IconNetwork,
  Panel,
  fmtNum,
  fmtPct,
} from "./ui";

const SOURCE_LABEL_FA: Record<string, string> = {
  bank: "وب‌سایت بانک",
  fund: "صندوق",
  fintech: "فین‌تک",
  regulatory: "مقررات",
  press: "منابع خبری",
};

/** Market-fit analysis panel: real analogs + the priors injected into the solver. */
export default function MarketIntelPanel({ intel }: { intel: MarketIntel | null }) {
  if (!intel || !intel.analogs.length) {
    return (
      <Panel title="تحلیل تطبیقی بازار" icon={<IconNetwork className="h-4 w-4" />}>
        <EmptyState
          title="تحلیل بازار برای این درخواست در دسترس نیست"
          hint="پس از اجرای خط لوله، نزدیک‌ترین محصولات واقعی بازار و میانه‌های ساختاری تزریق‌شده به حل‌کننده اینجا نمایش داده می‌شود."
          icon={<IconNetwork className="h-6 w-6" />}
        />
      </Panel>
    );
  }

  const priors = Object.values(intel.priors);
  const maxScore = Math.max(...intel.analogs.map((a) => a.score), 1);

  return (
    <div className="space-y-4">
      <Panel
        title="محصولات واقعی هم‌خانواده بازیابی‌شده از ثبت‌نام بازار"
        subtitle={`${fmtNum(intel.analogCount)} آنالوگ · پوشش تطبیق ${fmtPct(intel.coverage, 0)} · میانه ساختاری این نمونه‌ها به‌عنوان اولویت نمونه‌گیری MILP/MINLP تزریق شد`}
        icon={<IconNetwork className="h-4 w-4" />}
        actions={<Badge tone={intel.coverage > 0.5 ? "teal" : intel.coverage > 0.25 ? "gold" : "rose"}>
          پوشش بازار {fmtPct(intel.coverage, 0)}
        </Badge>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-right text-[11px]">
            <thead>
              <tr className="border-b border-line/70 text-mist/80">
                <th className="px-2 py-2 font-medium">بانک / مؤسسه</th>
                <th className="px-2 py-2 font-medium">محصول</th>
                <th className="px-2 py-2 font-medium">بخش هدف</th>
                <th className="px-2 py-2 font-medium">الگوی موتور</th>
                <th className="num px-2 py-2 font-medium">τ_d</th>
                <th className="num px-2 py-2 font-medium">α (بازار)</th>
                <th className="num px-2 py-2 font-medium">β</th>
                <th className="num px-2 py-2 font-medium">γ</th>
                <th className="num px-2 py-2 font-medium">نرخ/کارمزد</th>
                <th className="px-2 py-2 font-medium">منبع</th>
                <th className="px-2 py-2 font-medium">تطابق</th>
              </tr>
            </thead>
            <tbody>
              {intel.analogs.map((a) => (
                <tr key={a.code} className="border-b border-line/40 align-top">
                  <td className="px-2 py-2 text-chalk">{a.bank}</td>
                  <td className="px-2 py-2">
                    <span className="text-chalk">{a.productFa}</span>
                    <span className="num block text-[10px] text-mist/70">{a.productEn}</span>
                  </td>
                  <td className="px-2 py-2 text-mist">{a.segmentFa}</td>
                  <td className="px-2 py-2 text-mist">{ARCHETYPE_LABEL_FA[a.archetype as keyof typeof ARCHETYPE_LABEL_FA] ?? a.archetype}</td>
                  <td className="num px-2 py-2 text-mist">{a.params.sleepMonths} ماه</td>
                  <td className="num px-2 py-2 text-mist">
                    {fmtNum(a.params.loanMultiplier, 2)}
                    {(a.loanToDepositRatio ?? 0) > 2.6 ? (
                      <span className="block text-[9.5px] text-gold/80">بازار: {fmtNum(a.loanToDepositRatio!, 1)}x (سقف موتور محافظه‌کارانه‌تر است)</span>
                    ) : null}
                  </td>
                  <td className="num px-2 py-2 text-mist">{fmtPct(a.params.blockedRatio, 0)}</td>
                  <td className="num px-2 py-2 text-mist">{fmtPct(a.params.closedLoopRetention, 0)}</td>
                  <td className="num px-2 py-2 text-mist">
                    {a.profitRate ? fmtPct(a.profitRate, 1) : a.feeRate ? `کارمزد ${fmtPct(a.feeRate, 1)}` : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone="sky">{SOURCE_LABEL_FA[a.sourceType] ?? a.sourceType}</Badge>
                    <span className="mt-1 block max-w-[220px] text-[9.5px] leading-4 text-mist/60" dir="ltr">
                      {a.sourceRef}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-gold">{a.score.toFixed(1)}</span>
                    {a.reasonsFa.length ? (
                      <span className="block text-[9.5px] leading-4 text-mist/70">{a.reasonsFa.slice(0, 2).join("، ")}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] leading-5 text-mist/70">
          امتیاز تطابق نسبی است (بیشینه {maxScore.toFixed(1)})؛ ستون α مقدار واقعی بازار است و در صورت فراتر رفتن از
          سقف محافظه‌کارانه موتور، صرفاً برای استخراج میانه داخل بازه مجاز برش خورده و در گزارش علامت‌گذاری می‌شود.
        </p>
      </Panel>

      {priors.length ? (
        <Panel
          title="اولویت‌های ساختاری تزریق‌شده به حل‌کننده (میانه بازار)"
          subtitle="نمونه‌گیری کاندیدهای MILP/MINLP به‌جای بازه یکنواخت، حول این میانه‌های واقعی متمرکز شده است"
          icon={<IconNetwork className="h-4 w-4" />}
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {priors.map((prior) => (
              <div key={prior.archetype} className="panel-tight p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[12px] font-semibold text-chalk">
                    {ARCHETYPE_LABEL_FA[prior.archetype] ?? prior.archetype}
                  </h4>
                  <Badge tone="teal">{fmtNum(prior.analogCount)} آنالوگ</Badge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] text-mist">
                  <div className="flex justify-between"><dt>میانه τ_d</dt><dd className="num text-chalk">{fmtNum(prior.median.sleepMonths, 1)} ماه</dd></div>
                  <div className="flex justify-between"><dt>میانه τ_l</dt><dd className="num text-chalk">{fmtNum(prior.median.tenorMonths, 0)} ماه</dd></div>
                  <div className="flex justify-between"><dt>میانه ω</dt><dd className="num text-chalk">{fmtNum(prior.median.waitingMonths, 1)} ماه</dd></div>
                  <div className="flex justify-between"><dt>میانه α</dt><dd className="num text-chalk">{fmtNum(prior.median.loanMultiplier, 2)}</dd></div>
                  <div className="flex justify-between"><dt>میانه β</dt><dd className="num text-chalk">{fmtPct(prior.median.blockedRatio, 0)}</dd></div>
                  <div className="flex justify-between"><dt>میانه γ</dt><dd className="num text-chalk">{fmtPct(prior.median.closedLoopRetention, 0)}</dd></div>
                  <div className="flex justify-between"><dt>میانه δ</dt><dd className="num text-chalk">{fmtPct(prior.median.withdrawalFraction, 0)}</dd></div>
                  <div className="flex justify-between"><dt>میانه r_d</dt><dd className="num text-chalk">{fmtPct(prior.median.depositRate, 1)}</dd></div>
                  <div className="flex justify-between"><dt>میانه r_l</dt><dd className="num text-chalk">{fmtPct(prior.median.loanRate, 1)}</dd></div>
                  <div className="flex justify-between"><dt>عقد غالب بازار</dt><dd className="text-chalk">{prior.contractHint ?? "—"}</dd></div>
                </dl>
                <p className="num mt-2 border-t border-line/60 pt-1.5 text-[9.5px] leading-4 text-mist/70" dir="ltr">
                  {prior.analogCodes.join(" · ")}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
