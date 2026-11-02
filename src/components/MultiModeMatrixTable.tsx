"use client";

import type { CriticFinding, ProductSpec } from "@/lib/domain/types";
import { ARCHETYPE_LABEL_FA, CONTRACT_LABEL_FA } from "@/lib/domain/guildValueChain";
import { Badge, Bar, IconLayers, Panel, fmtBToman, fmtNum, fmtPct } from "./ui";

const releaseLabelFa: Record<string, string> = {
  linear: "خطی",
  midpoint: "میانی (۵۰٪ اقساط)",
  end: "در سررسید",
};

export default function MultiModeMatrixTable({
  product,
  findings = [],
}: {
  product: ProductSpec | null;
  findings?: CriticFinding[];
}) {
  if (!product) return null;

  const blockers = findings.filter((f) => f.severity === "blocker");
  const maxWeight = Math.max(...product.modes.map((m) => m.weight), 0.0001);

  return (
    <Panel
      title="ماتریس پویای چندطرحی محصول سنتزشده"
      subtitle={`${product.titleFa} — کد ${product.code} | ${product.modes.length} طرح مکمل با پلکانی‌سازی دوره خواب`}
      icon={<IconLayers className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-1.5">
          <Badge tone="gold">
            منابع هدف {fmtNum(product.targetDepositsRial / 1e13, 2)} همت
          </Badge>
          <Badge tone={blockers.length ? "rose" : "teal"}>
            {blockers.length ? `${fmtNum(blockers.length)} مانع باز` : "همه قیود برقرار"}
          </Badge>
        </div>
      }
      bodyClass="p-0"
    >
      <div className="grid grid-cols-2 gap-2 border-b border-line/70 p-3 md:grid-cols-4">
        <MiniStat label="نسبت ساختاری تسهیلات به سپرده" value={fmtNum(product.structuralLoanToDeposit, 3)} />
        <MiniStat label="نرخ مؤثر تمام‌شده منابع (CoF)" value={fmtPct(product.blendedCostOfFunds)} />
        <MiniStat label="نرخ وزنی تسهیلات" value={fmtPct(product.blendedLoanRate)} />
        <MiniStat label="ماندگاری وزنی حلقه بسته γ" value={fmtPct(product.blendedClosedLoopRetention, 1)} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line bg-[rgba(255,255,255,0.02)] text-mist">
              {[
                "طرح / کهن‌الگو",
                "عقد اسلامی",
                "سهم و حجم منبع",
                "τ_d خواب",
                "ω صف",
                "τ_l سررسید",
                "α ضریب",
                "r_l نرخ",
                "β مسدودی",
                "γ حلقه بسته",
                "δ برداشت",
                "κ منبع",
                "CoF",
                "PD×LGD",
                "سقف فردی",
                "قسط/درآمد",
                "NPV بانک",
              ].map((h) => (
                <th key={h} className="whitespace-nowrap px-2.5 py-2 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {product.modes.map((mode, i) => {
              const affordabilityOk = mode.installmentToIncome <= 0.4;
              const rateOk =
                mode.contract === "qarz-hasaneh"
                  ? mode.loanRate <= 0.04 + 1e-9
                  : mode.loanRate <= 0.23 + 1e-9;
              return (
                <tr
                  key={mode.id}
                  className="border-b border-line/50 align-top transition hover:bg-[rgba(224,178,92,0.04)]"
                >
                  <td className="min-w-[210px] px-2.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="num rounded border border-gold/35 bg-gold/10 px-1.5 text-[10px] text-gold">
                        M{i + 1}
                      </span>
                      <div>
                        <p className="text-[12px] font-medium text-chalk">{mode.nameFa}</p>
                        <p className="text-[10px] text-mist">
                          {ARCHETYPE_LABEL_FA[mode.archetype]} · {fmtNum(mode.customers)} مشتری
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2.5">
                    <Badge tone={rateOk ? "teal" : "rose"}>{CONTRACT_LABEL_FA[mode.contract]}</Badge>
                  </td>
                  <td className="min-w-[150px] px-2.5 py-2.5">
                    <p className="num text-chalk">{fmtPct(mode.weight, 1)}</p>
                    <p className="num text-[10px] text-mist">{fmtBToman(mode.depositVolumeRial)} م.ت</p>
                    <div className="mt-1 w-28">
                      <Bar value={mode.weight} max={maxWeight} tone="gold" height={4} />
                    </div>
                  </td>
                  <Cell value={`${fmtNum(mode.sleepMonths)} ماه`} />
                  <Cell value={`${fmtNum(mode.waitingMonths)} ماه`} />
                  <Cell value={`${fmtNum(mode.tenorMonths)} ماه`} />
                  <Cell value={fmtNum(mode.loanMultiplier, 2)} tone="gold" />
                  <Cell value={fmtPct(mode.loanRate, 2)} />
                  <Cell
                    value={`${fmtPct(mode.blockedRatio, 1)}`}
                    hint={releaseLabelFa[mode.blockRelease]}
                  />
                  <Cell value={fmtPct(mode.closedLoopRetention, 1)} tone="teal" />
                  <Cell value={fmtPct(mode.withdrawalFractionMean, 1)} tone="rose" />
                  <Cell value={fmtNum(mode.sourceKappa, 2)} />
                  <Cell value={fmtPct(mode.costOfFunds, 2)} />
                  <Cell
                    value={`${fmtPct(mode.pd, 2)} × ${fmtPct(mode.lgd, 0)}`}
                    hint={`EL ${fmtPct(mode.expectedLoss, 2)}`}
                  />
                  <Cell value={`${fmtNum(mode.capToman / 1e6)} م.ت`} hint={`میانگین ${fmtNum(mode.avgTicketToman)} ت`} />
                  <td className="whitespace-nowrap px-2.5 py-2.5">
                    <span className={affordabilityOk ? "num text-teal" : "num text-rose"}>
                      {fmtPct(mode.installmentToIncome, 1)}
                    </span>
                    <p className="num text-[10px] text-mist">
                      قسط {fmtNum(mode.monthlyInstallmentToman)} ت
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2.5">
                    <span className={mode.npvBankRial >= 0 ? "num text-teal" : "num text-rose"}>
                      {fmtBToman(mode.npvBankRial)} م.ت
                    </span>
                    <p className="num text-[10px] text-mist">
                      دفتر {fmtBToman(mode.loanBookRial)} م.ت
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-[rgba(224,178,92,0.05)] text-[11.5px] text-gold">
              <td className="px-2.5 py-2 font-medium">جمع / میانگین وزنی</td>
              <td className="px-2.5 py-2">{product.modes.length} عقد</td>
              <td className="num px-2.5 py-2">{fmtBToman(product.targetDepositsRial)} م.ت</td>
              <td className="num px-2.5 py-2">
                {fmtNum(
                  product.modes.reduce((a, m) => a + m.weight * m.sleepMonths, 0),
                  1,
                )}
              </td>
              <td className="num px-2.5 py-2">
                {fmtNum(
                  product.modes.reduce((a, m) => a + m.weight * m.waitingMonths, 0),
                  1,
                )}
              </td>
              <td className="num px-2.5 py-2">
                {fmtNum(
                  product.modes.reduce((a, m) => a + m.weight * m.tenorMonths, 0),
                  1,
                )}
              </td>
              <td className="num px-2.5 py-2">
                {fmtNum(
                  product.modes.reduce((a, m) => a + m.weight * m.loanMultiplier, 0),
                  2,
                )}
              </td>
              <td className="num px-2.5 py-2">{fmtPct(product.blendedLoanRate)}</td>
              <td className="num px-2.5 py-2">
                {fmtPct(
                  product.modes.reduce((a, m) => a + m.weight * m.blockedRatio, 0),
                  1,
                )}
              </td>
              <td className="num px-2.5 py-2">{fmtPct(product.blendedClosedLoopRetention, 1)}</td>
              <td className="num px-2.5 py-2">
                {fmtPct(
                  product.modes.reduce((a, m) => a + m.weight * m.withdrawalFractionMean, 0),
                  1,
                )}
              </td>
              <td className="num px-2.5 py-2">
                {fmtNum(
                  product.modes.reduce((a, m) => a + m.weight * m.sourceKappa, 0),
                  2,
                )}
              </td>
              <td className="num px-2.5 py-2">{fmtPct(product.blendedCostOfFunds)}</td>
              <td className="num px-2.5 py-2">
                {fmtPct(
                  product.modes.reduce((a, m) => a + m.weight * m.expectedLoss, 0),
                  2,
                )}
              </td>
              <td className="px-2.5 py-2">—</td>
              <td className="px-2.5 py-2">—</td>
              <td className="num px-2.5 py-2">
                {fmtBToman(product.modes.reduce((a, m) => a + m.npvBankRial, 0))} م.ت
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function Cell({
  value,
  hint,
  tone,
}: {
  value: string;
  hint?: string;
  tone?: "gold" | "teal" | "rose";
}) {
  const color =
    tone === "gold" ? "text-gold" : tone === "teal" ? "text-teal" : tone === "rose" ? "text-rose" : "text-chalk";
  return (
    <td className="whitespace-nowrap px-2.5 py-2.5">
      <span className={`num ${color}`}>{value}</span>
      {hint ? <p className="text-[9.5px] text-mist/80">{hint}</p> : null}
    </td>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-tight px-3 py-2">
      <p className="text-[10.5px] text-mist">{label}</p>
      <p className="num mt-0.5 text-[15px] font-semibold text-gold">{value}</p>
    </div>
  );
}
