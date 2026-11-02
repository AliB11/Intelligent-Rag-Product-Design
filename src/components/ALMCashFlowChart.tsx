"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AlmResult, ProductGenerationRequest } from "@/lib/domain/types";
import { Badge, IconChart, Panel, fmtNum, fmtPct } from "./ui";

const BT = 1e10; // میلیارد تومان

const tooltipStyle = {
  background: "rgba(6,10,18,0.96)",
  border: "1px solid #24344f",
  borderRadius: 10,
  fontSize: 11,
  color: "#e7eef8",
  direction: "rtl" as const,
  fontFamily: "Vazirmatn, sans-serif",
};

const axisTick = { fill: "#8ea0bd", fontSize: 10, fontFamily: "Vazirmatn" };

export default function ALMCashFlowChart({
  alm,
  request,
}: {
  alm: AlmResult | null;
  request: ProductGenerationRequest | null;
}) {
  if (!alm) return null;
  const m = alm.metrics;

  const balanceData = alm.monthly.map((row, i) => ({
    t: row.t,
    deposits: row.deposits / BT,
    loans: row.loans / BT,
    hqla: row.hqla / BT,
    blocked: row.blockedDeposits / BT,
    cum: row.cumulativeCashFlow / BT,
    ldrP95: alm.ldrP95[i] ?? row.ldr,
    lcrP5: alm.lcrP5[i] ?? row.lcr,
  }));

  const incomeData = alm.monthly.map((row) => ({
    t: row.t,
    joint: (row.jointIncome + row.treasuryIncome) / BT,
    fee: row.feeIncome / BT,
    cost: (row.depositCost + row.opex + row.expectedLoss) / BT,
    net: row.netIncome / BT,
  }));

  const flowData = alm.monthly.map((row) => ({
    t: row.t,
    originations: row.newOriginations / BT,
    installments: row.installmentsIn / BT,
    withdrawals: row.withdrawals / BT,
    closedLoop: row.closedLoopInflow / BT,
  }));

  const ldrCeiling = request?.ldrCeiling ?? 0.85;
  const lcrFloor = request?.lcrFloor ?? 1.05;

  return (
    <div className="space-y-3">
      <Panel
        title="دوقلوی دیجیتال ALM — پویایی منابع، مصارف و انباشت نقدینگی"
        subtitle={`افق ${fmtNum(alm.horizonMonths)} ماهه · ${fmtNum(alm.monteCarloRuns)} مسیر مونت‌کارلو · بذر ${alm.seed}`}
        icon={<IconChart className="h-4 w-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={m.p95Ldr <= ldrCeiling ? "teal" : "rose"}>
              p95 LDR {fmtPct(m.p95Ldr)}
            </Badge>
            <Badge tone={m.p5Lcr >= lcrFloor ? "teal" : "rose"}>
              p5 LCR {fmtNum(m.p5Lcr, 2)}
            </Badge>
            <Badge tone="gold">شوک واژگونی {fmtPct(m.overturningShock)}</Badge>
          </div>
        }
      >
        <div dir="ltr" className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={balanceData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="gDep" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#35d6a4" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#35d6a4" stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="gLoan" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e0b25c" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#e0b25c" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" tick={axisTick} stroke="#24344f" />
              <YAxis tick={axisTick} stroke="#24344f" width={54} />
              <YAxis yAxisId="cum" orientation="right" tick={axisTick} stroke="#24344f" width={54} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#8ea0bd" }} />
              <Area
                type="monotone"
                dataKey="deposits"
                name="منابع سپرده (میلیارد تومان)"
                stroke="#35d6a4"
                fill="url(#gDep)"
                strokeWidth={1.8}
              />
              <Area
                type="monotone"
                dataKey="loans"
                name="مانده تسهیلات (میلیارد تومان)"
                stroke="#e0b25c"
                fill="url(#gLoan)"
                strokeWidth={1.8}
              />
              <Line
                type="monotone"
                dataKey="hqla"
                name="HQLA"
                stroke="#4ea8de"
                strokeWidth={1.4}
                dot={false}
              />
              <Line
                yAxisId="cum"
                type="monotone"
                dataKey="cum"
                name="انباشت جریان نقد خالص"
                stroke="#8b7cf6"
                strokeWidth={1.8}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="نسبت خالص تسهیلات به سپرده (LDR)" subtitle="میانگین و صدک ۹۵ در برابر سقف انحلال‌پذیری">
          <div dir="ltr" className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={balanceData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" tick={axisTick} stroke="#24344f" />
                <YAxis tick={axisTick} stroke="#24344f" width={44} domain={[0, 1.1]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine
                  y={ldrCeiling}
                  stroke="#f4695c"
                  strokeDasharray="4 3"
                  label={{ value: `ceiling ${ldrCeiling}`, fill: "#f4695c", fontSize: 10, position: "insideTopRight" }}
                />
                <ReferenceLine y={0.8} stroke="#e0b25c" strokeDasharray="2 4" />
                <Line type="monotone" dataKey="ldrP95" name="p95 LDR" stroke="#f4695c" strokeWidth={1.8} dot={false} />
                <Line type="stepAfter" dataKey="deposits" hide name="." stroke="none" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10.5px] text-mist">
            خط چین طلایی: آستانه هشدار داخلی ۰٫۸۰ — خط سرخ: سقف الزام‌آور ۰٫۸۵
          </p>
        </Panel>

        <Panel title="نسبت پوشش نقدینگی (LCR)" subtitle="میانگین و صدک ۵ در برابر کف ۱٫۰۵">
          <div dir="ltr" className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={alm.monthly.map((r, i) => ({
                  t: r.t,
                  lcr: r.lcr,
                  lcrP5: alm.lcrP5[i] ?? r.lcr,
                }))}
                margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
              >
                <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" tick={axisTick} stroke="#24344f" />
                <YAxis tick={axisTick} stroke="#24344f" width={44} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine
                  y={lcrFloor}
                  stroke="#f4695c"
                  strokeDasharray="4 3"
                  label={{ value: `floor ${lcrFloor}`, fill: "#f4695c", fontSize: 10, position: "insideBottomRight" }}
                />
                <Line type="monotone" dataKey="lcr" name="LCR میانگین" stroke="#35d6a4" strokeWidth={1.8} dot={false} />
                <Line type="monotone" dataKey="lcrP5" name="LCR صدک ۵" stroke="#4ea8de" strokeWidth={1.4} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10.5px] text-mist">
            ماه‌های نقض: {fmtNum(m.monthsInBreachLcr, 1)} (LCR) و {fmtNum(m.monthsInBreachLdr, 1)} (LDR)
          </p>
        </Panel>

        <Panel title="ترکیب درآمد مشاع و غیرمشاع" subtitle="درآمد تسهیلات و خزانه‌داری در برابر درآمد کارمزدی">
          <div dir="ltr" className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={incomeData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" tick={axisTick} stroke="#24344f" />
                <YAxis tick={axisTick} stroke="#24344f" width={48} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="joint" name="درآمد مشاع + خزانه" stackId="a" fill="#e0b25c" fillOpacity={0.75} />
                <Bar dataKey="fee" name="درآمد غیرمشاع (کارمزد)" stackId="a" fill="#8b7cf6" fillOpacity={0.8} />
                <Line type="monotone" dataKey="net" name="درآمد خالص" stroke="#35d6a4" strokeWidth={1.8} dot={false} />
                <Line type="monotone" dataKey="cost" name="هزینه منابع و عملیاتی" stroke="#f4695c" strokeWidth={1.2} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10.5px] text-mist">
            NIM کل {fmtPct(m.nim)} — مشاع {fmtPct(m.nimJoint)} — غیرمشاع {fmtPct(m.nimNonJoint)}
          </p>
        </Panel>

        <Panel title="جریان نقد کوهورت‌ها و بازچرخش حلقه بسته" subtitle="اعطا، اقساط، خروج منابع و بازگشت γ">
          <div dir="ltr" className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={flowData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" tick={axisTick} stroke="#24344f" />
                <YAxis tick={axisTick} stroke="#24344f" width={48} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="originations" name="اعطای تسهیلات" fill="#e0b25c" fillOpacity={0.6} />
                <Bar dataKey="withdrawals" name="خروج منابع" fill="#f4695c" fillOpacity={0.55} />
                <Line type="monotone" dataKey="installments" name="اقساط دریافتی" stroke="#35d6a4" strokeWidth={1.6} dot={false} />
                <Line type="monotone" dataKey="closedLoop" name="بازگشت حلقه بسته γ" stroke="#4ea8de" strokeWidth={1.6} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel
        title="توزیع شوک واژگونی منابع (ریسک واژگونی) در مسیرهای مونت‌کارلو"
        subtitle={`خالص خروج نقدینگی ${fmtPct(m.netLiquidityDrainRatio)} از کل اعطا · شاخص پایداری منابع ${fmtPct(m.resourceStabilityIndex, 1)}`}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div dir="ltr" className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={alm.overturningHistogram} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" tick={axisTick} stroke="#24344f" />
                <YAxis tick={axisTick} stroke="#24344f" width={44} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="frequency" name="فراوانی" fill="#e0b25c" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 content-start">
            <MiniKpi label="اوج مانده تسهیلات" value={`${fmtNum(m.peakLoansRial / BT, 0)} م.ت`} />
            <MiniKpi label="اوج منابع سپرده" value={`${fmtNum(m.peakDepositsRial / BT, 0)} م.ت`} />
            <MiniKpi label="کل اعطای ۵ ساله" value={`${fmtNum(m.totalFacilitiesOriginatedRial / BT, 0)} م.ت`} />
            <MiniKpi label="سرمایه اقتصادی برنامه" value={`${fmtNum(m.economicCapitalRial / BT, 0)} م.ت`} />
            <MiniKpi label="تعداد فقره تسهیلات" value={fmtNum(m.facilityCount)} />
            <MiniKpi label="نسبت هزینه به درآمد" value={fmtPct(m.costOfIncome, 1)} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-tight px-3 py-2">
      <p className="text-[10.5px] text-mist">{label}</p>
      <p className="num mt-0.5 text-[14px] font-semibold text-chalk">{value}</p>
    </div>
  );
}
