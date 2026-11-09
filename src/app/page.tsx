"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REGULATORY } from "@/lib/domain/constants";
import type { TraceEvent } from "@/lib/agents/state";
import type { RunSummary } from "@/lib/db/repository";
import type {
  AlmResult,
  BenchmarkScheme,
  CriticFinding,
  GuildEcosystem,
  PersonaSpec,
  ProductGenerationRequest,
  ProductSpec,
  RegulatoryConstraint,
} from "@/lib/domain/types";
import type { OptimizerIteration } from "@/lib/domain/optimizer";
import type { VerificationSuiteResult } from "@/lib/verification/financialEngineTests";
import PromptComposer, { EXAMPLE_PROMPTS, type ComposerOptions } from "@/components/PromptComposer";
import AgentReasoningStream from "@/components/AgentReasoningStream";
import MultiModeMatrixTable from "@/components/MultiModeMatrixTable";
import ALMCashFlowChart from "@/components/ALMCashFlowChart";
import GuildEcosystemCanvas from "@/components/GuildEcosystemCanvas";
import MarketIntelPanel from "@/components/MarketIntelPanel";
import FacilityCatalog from "@/components/FacilityCatalog";
import ProductRecommendationPanel from "@/components/ProductRecommendationPanel";
import SimorghLab from "@/components/SimorghLab";
import ProductDossierPanel from "@/components/ProductDossierPanel";
import type { ProductDossier } from "@/lib/dossier/productDossier";
import type { SimorghReport } from "@/lib/agents/state";
import {
  CompliancePanel,
  KnowledgePanel,
  MetricsPanel,
  ReportPanel,
  RunHistory,
  SensitivityDashboard,
} from "@/components/ResultPanels";
import {
  Badge,
  EmptyState,
  IconChart,
  IconCheck,
  IconDatabase,
  IconDoc,
  IconFlask,
  IconLayers,
  IconNetwork,
  IconScale,
  IconShield,
  Panel,
  Tabs,
  fmtHemmat,
  fmtNum,
  fmtPct,
} from "@/components/ui";
import type { SensitivityFrame, AccountingEntry, ComplianceDraftItem, ValidationStatus, MarketIntel } from "@/lib/agents/state";

interface GenerationResult {
  runId: string | null;
  status: string;
  validationStatus: ValidationStatus;
  error: string | null;
  prompt: string;
  request: ProductGenerationRequest | null;
  warnings: string[];
  constraints: RegulatoryConstraint[];
  marketIntel: MarketIntel | null;
  simorgh: SimorghReport | null;
  persona: PersonaSpec | null;
  ecosystem: GuildEcosystem | null;
  product: ProductSpec | null;
  alm: AlmResult | null;
  findings: CriticFinding[];
  iterations: OptimizerIteration[];
  iterationCount: number;
  sensitivity: SensitivityFrame | null;
  accountingEntries: AccountingEntry[];
  complianceDraft: ComplianceDraftItem[];
  benchmarks: BenchmarkScheme[];
  reportFa: string;
  reportEn: string;
  dossier: ProductDossier | null;
  elapsedMs: number;
}

type TabKey =
  | "overview"
  | "matrix"
  | "alm"
  | "dossier"
  | "guild"
  | "market"
  | "catalog"
  | "simorgh"
  | "sensitivity"
  | "compliance"
  | "knowledge"
  | "report";

const STAGES = [
  { n: 1, fa: "تجزیه قصد طبیعی به تابع هدف و قیود صوری" },
  { n: 2, fa: "بازیابی مقررات بانک مرکزی و قواعد عقود اسلامی (RAG)" },
  { n: 3, fa: "سنتز MILP/MINLP و حل معکوس هفت‌متغیره با پوسته مقرراتی" },
  { n: 4, fa: "نگهبان استرس (پایه + سه شوک) و دوقلوی دیجیتال ALM مونت‌کارلو" },
  { n: 5, fa: "ممیزی ربا پنهان، حلقه نقد ساخت‌یافته و صدور دوسیه محصول" },
];

export default function Home() {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [suite, setSuite] = useState<VerificationSuiteResult | null>(null);
  const [suiteBusy, setSuiteBusy] = useState(false);
  const [kbInfo, setKbInfo] = useState<{ benchmarks: number; kbDocuments: number } | null>(null);
  const [catalogBenchmarks, setCatalogBenchmarks] = useState<BenchmarkScheme[]>([]);
  const [seededPrompt, setSeededPrompt] = useState<{ text: string; nonce: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      const data = await res.json();
      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    const loadInitialData = async () => {
      const [runsData, benchmarkData] = await Promise.all([
        fetch("/api/runs", { cache: "no-store" })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null),
        fetch("/api/benchmarks", { cache: "no-store" })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null),
      ]);
      if (cancelled) return;
      setRuns(Array.isArray(runsData?.runs) ? runsData.runs : []);
      setKbInfo(benchmarkData?.totals ?? null);
      setCatalogBenchmarks(Array.isArray(benchmarkData?.benchmarks) ? benchmarkData.benchmarks : []);
    };
    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (prompt: string, options: ComposerOptions) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      setEvents([]);
      setResult(null);

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, ...options }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(typeof payload?.error === "string" ? payload.error : `HTTP ${res.status}`);
        }
        if (!res.body) throw new Error("The server returned an empty event stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const lines = frame.split("\n");
            let event = "message";
            let data = "";
            lines.forEach((line) => {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            });
            if (!data) continue;
            const parsed = JSON.parse(data) as Record<string, never>;
            if (event === "status") {
              const status = parsed as unknown as {
                stage?: string;
                titleFa?: string;
                titleEn?: string;
                persisted?: boolean;
              };
              setEvents((prev) => [{
                id: 0,
                node: "graph",
                stage: status.stage ?? "bootstrap",
                level: status.persisted ? "ok" : "warn",
                titleFa: status.titleFa ?? "پایگاه داده درون‌حافظه‌ای فعال است",
                titleEn: status.titleEn ?? "Using the in-memory data corpus",
                ts: 0,
              }, ...prev]);
            } else if (event === "trace") {
              setEvents((prev) => [...prev, parsed as unknown as TraceEvent]);
            } else if (event === "result") {
              setResult(parsed as unknown as GenerationResult);
            } else if (event === "error") {
              setError(String((parsed as { message?: string }).message ?? "خطای نامشخص"));
            }
          }
        }
        await loadRuns();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
        }
      }
    },
    [loadRuns],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  const runSelfTest = useCallback(async () => {
    setSuiteBusy(true);
    setSuite(null);
    try {
      const res = await fetch("/api/selftest?fast=1", { cache: "no-store" });
      const data = (await res.json()) as VerificationSuiteResult;
      setSuite(data);
    } catch (err) {
      setSuite(null);
      setError(err instanceof Error ? err.message : "selftest failed");
    } finally {
      setSuiteBusy(false);
    }
  }, []);

  const openRun = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/runs?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json();
      const run = data.run;
      if (!run) return;
      const findings = Array.isArray(run.findings) ? run.findings as CriticFinding[] : [];
      const savedValidation = run.validationStatus as ValidationStatus | undefined;
      const validationStatus: ValidationStatus =
        savedValidation === "constraints_passed" || savedValidation === "not_validated"
          ? savedValidation
          : findings.some((finding) => finding.severity === "blocker")
            ? "not_validated"
            : "pending";
      setResult({
        runId: run.id,
        status: run.status ?? "complete",
        validationStatus,
        error: null,
        prompt: run.prompt,
        request: run.intent,
        warnings: [],
        constraints: run.retrievedConstraints ?? [],
        marketIntel: (run.marketIntel as MarketIntel | null) ?? null,
        simorgh: null,
        persona: run.persona ?? null,
        ecosystem: run.guild ?? null,
        product: run.productSpec,
        alm: run.metrics,
        findings,
        iterations: [],
        iterationCount: run.iterations,
        sensitivity: run.sensitivity ?? null,
        accountingEntries: Array.isArray(run.accountingEntries) ? run.accountingEntries : [],
        complianceDraft: Array.isArray(run.complianceDraft) ? run.complianceDraft : [],
        benchmarks: Array.isArray(run.benchmarks) ? run.benchmarks : [],
        reportFa: run.reportFa,
        reportEn: run.reportEn ?? "",
        dossier: null,
        elapsedMs: 0,
      });
      setEvents(Array.isArray(run.trace) ? run.trace : []);
      setTab("overview");
    } catch {
      /* ignore */
    }
  }, []);

  const metrics = result?.alm?.metrics ?? null;
  const request = result?.request ?? null;
  const effectiveLdrCeiling = Math.min(request?.ldrCeiling ?? REGULATORY.ldrCeiling, REGULATORY.ldrCeiling);
  const effectiveLcrFloor = Math.max(request?.lcrFloor ?? REGULATORY.lcrFloor, REGULATORY.lcrFloor);

  return (
    <main className="mx-auto w-full max-w-[1560px] px-4 pb-16 pt-6 md:px-6">
      {/* ---------------------------------------------------------- header */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-line/70 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/40 bg-gold/10 text-gold">
              <IconScale className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-[17px] font-extrabold tracking-tight text-chalk md:text-[20px]">
                مولد خودگردان محصول بانکی و <span className="gold-text">دوقلوی دیجیتال ALM</span>
              </h1>
              <p className="mt-0.5 text-[11.5px] text-mist">
                معماری تولید معکوس هدف‌جو · زیست‌بوم بانکی ایران · MILP/MINLP + مونت‌کارلو ۶۰ ماهه +
                خط لوله هفت‌گره‌ای LangGraph
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="teal">
            <IconDatabase className="h-3 w-3" />
            پایگاه دانش: {kbInfo ? `${fmtNum(kbInfo.kbDocuments)} سند · ${fmtNum(kbInfo.benchmarks)} بنچمارک` : "در حال بارگذاری"}
          </Badge>
          <Badge tone="gold">
            <IconCheck className="h-3 w-3" />
            ۱ همت = ۱۰<sup>۱۳</sup> ریال
          </Badge>
          <button
            type="button"
            onClick={runSelfTest}
            disabled={suiteBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet/40 bg-violet/10 px-3 py-1.5 text-[11.5px] text-violet transition hover:bg-violet/20 disabled:opacity-50"
          >
            <IconFlask className="h-3.5 w-3.5" />
            {suiteBusy ? "در حال اجرای آزمون‌ها…" : "اجرای مجموعه آزمون راستی‌آزمایی"}
          </button>
        </div>
      </header>

      {/* ---------------------------------------------------------- pipeline banner */}
      <section className="mb-4 grid gap-2 md:grid-cols-5">
        {STAGES.map((s) => (
          <div key={s.n} className="panel-tight flex items-start gap-2 px-3 py-2">
            <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-[10px] text-gold">
              {fmtNum(s.n)}
            </span>
            <p className="text-[10.8px] leading-5 text-mist">{s.fa}</p>
          </div>
        ))}
      </section>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose/45 bg-rose/10 px-4 py-3 text-[12px] text-rose">
          خطا: {error}
        </div>
      ) : null}

      {suite ? (
        <Panel
          className="mb-4"
          title="مجموعه آزمون راستی‌آزمایی موتور مالی (Pytest twin)"
          subtitle={`${fmtNum(suite.passedAssertions)} از ${fmtNum(suite.totalAssertions)} ادعا پذیرفته شد — زمان اجرا ${fmtNum(suite.durationMs)} میلی‌ثانیه`}
          icon={<IconFlask className="h-4 w-4" />}
          actions={
            <Badge tone={suite.passed ? "teal" : "rose"}>
              {suite.passed ? "SUITE PASSED" : "SUITE FAILED"}
            </Badge>
          }
        >
          <div className="grid gap-3 lg:grid-cols-3">
            {suite.cases.map((c) => (
              <div key={c.id} className="panel-tight p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[12px] font-semibold text-chalk">{c.titleFa}</h4>
                  <Badge tone={c.passed ? "teal" : "rose"}>{c.passed ? "PASS" : "FAIL"}</Badge>
                </div>
                <ul className="mt-2 space-y-1">
                  {c.assertions.map((a) => (
                    <li key={a.id} className="flex items-start gap-1.5 text-[10.8px] leading-5">
                      <span className={a.passed ? "mt-0.5 text-teal" : "mt-0.5 text-rose"}>
                        {a.passed ? <IconCheck className="h-3 w-3" /> : <IconShield className="h-3 w-3" />}
                      </span>
                      <span className="text-mist">
                        <span className="num text-chalk/80">{a.id}</span> {a.descriptionFa}{" "}
                        <span className="num">(مقدار {a.actual})</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="num mt-2 border-t border-line/60 pt-1.5 text-[10px] text-mist/80">
                  {JSON.stringify(c.summary)}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {/* ---------------------------------------------------------- body */}
      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-4">
          <PromptComposer
            key={seededPrompt?.nonce ?? "composer"}
            busy={busy}
            onSubmit={submit}
            onCancel={cancel}
            initialPrompt={seededPrompt?.text}
          />
          <AgentReasoningStream events={events} running={busy} />
          <RunHistory runs={runs} onPick={openRun} onRefresh={loadRuns} />
        </div>

        <div className="space-y-4">
          <ProductRecommendationPanel onDesign={(text) => { setSeededPrompt({ text, nonce: Date.now() }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          {!result ? (
            <>
              <Panel>
                <EmptyState
                  title="هنوز محصولی سنتز نشده است"
                  hint={`یک درخواست راهبردی وارد کنید، از راهنمای دسته‌بندی استفاده کنید یا یکی از الگوهای آماده را انتخاب کنید. نمونه: «${EXAMPLE_PROMPTS[0].label}». سامانه قصد شما را به تابع هدف و قیود صوری ترجمه می‌کند، مقررات و تسهیلات واقعی بازار را از پایگاه دانش برمی‌گیرد، ساختار بهینه را با حل‌کننده MILP/MINLP می‌سازد و آن را در دوقلوی دیجیتال ALM با ${fmtNum(1000)} مسیر مونت‌کارلو آزمون تنش می‌کند.`}
                  icon={<IconNetwork className="h-7 w-7" />}
                />
              </Panel>
              {catalogBenchmarks.length ? (
                <FacilityCatalog
                  benchmarks={catalogBenchmarks}
                  onUse={(b) => {
                    const rate = b.profitRate ?? b.feeRate;
                    const text =
                      `یک محصول مشابه «${b.productFa}» (${b.bank}) طراحی کن: سقف ${Math.round(b.ceilingToman / 1e6)} میلیون تومان` +
                      `${rate ? `، ${b.profitRate ? "نرخ" : "کارمزد"} ${(rate * 100).toFixed(1)}٪` : ""}` +
                      `${b.tenorMonths ? `، سررسید ${b.tenorMonths} ماه` : ""}` +
                      `${b.segmentFa ? `، بخش هدف ${b.segmentFa}` : ""}` +
                      `؛ ۸ همت منبع، IRR هدف حداقل ۲۳٪، سقف LDR ۸۵٪، کف LCR ۱٫۰۵ و حداکثر ریسک واژگونی ۵٪`;
                    setSeededPrompt({ text, nonce: Date.now() });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              ) : null}
            </>
          ) : (
            <>
              {/* summary strip */}
              <Panel
                title={result.product?.titleFa ?? "محصول سنتزشده"}
                subtitle={
                  result.request
                    ? `کد ${result.product?.code} · ${fmtNum(result.product?.modes.length ?? 0)} طرح · هدف ${fmtHemmat(result.request.targetDepositsRial)} همت · ${fmtNum(result.iterationCount)} گام خوداصلاحی · ${fmtNum(result.elapsedMs / 1000, 1)} ثانیه`
                    : undefined
                }
                icon={<IconLayers className="h-4 w-4" />}
                actions={
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={result.validationStatus === "constraints_passed" ? "teal" : result.validationStatus === "not_validated" ? "rose" : "gold"}>
                      {result.validationStatus === "constraints_passed" ? "قیود سخت مدل پاس شدند" : result.validationStatus === "not_validated" ? "غیرقابل‌تأیید" : "اعتبارسنجی نهایی نشده"}
                    </Badge>
                    {metrics ? (
                      <>
                        <Badge tone={metrics.irrBankAnnual >= (request?.targetIrr ?? 0.26) ? "teal" : "rose"}>
                          IRR {fmtPct(metrics.irrBankAnnual, 1)}
                        </Badge>
                        <Badge tone={metrics.p95Ldr <= effectiveLdrCeiling ? "teal" : "rose"}>
                          p95 LDR {fmtPct(metrics.p95Ldr, 1)}
                        </Badge>
                        <Badge tone={metrics.p5Lcr >= effectiveLcrFloor ? "teal" : "rose"}>
                          p5 LCR {fmtNum(metrics.p5Lcr, 2)}
                        </Badge>
                        <Badge tone="gold">γ وزنی {fmtPct(result.product?.blendedClosedLoopRetention ?? 0, 0)}</Badge>
                      </>
                    ) : null}
                  </div>
                }
              >
                {/* identified reference facility */}
                {request?.matchedFacility ? (
                  <div className="panel-tight mb-4 flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <span className="rounded-md border border-teal/40 bg-teal/10 px-2 py-1 text-[10px] text-teal">
                      محصول مرجع شناسایی‌شده
                    </span>
                    <span className="text-[12px] font-semibold text-chalk">
                      {request.matchedFacility.productFa}
                    </span>
                    <span className="text-[10.5px] text-mist">— {request.matchedFacility.bank}</span>
                    <Badge tone={request.matchedFacility.confidence >= 0.7 ? "teal" : request.matchedFacility.confidence >= 0.4 ? "gold" : "rose"}>
                      اطمینان {fmtNum(request.matchedFacility.confidence * 100, 0)}٪
                    </Badge>
                    {request.matchedFacility.alternativesFa.length ? (
                      <span className="text-[10px] text-mist/70">
                        جایگزین‌ها: {request.matchedFacility.alternativesFa.slice(0, 3).map((a) => `${a.productFa} (${fmtNum(a.confidence * 100, 0)}٪)`).join(" · ")}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <Tabs<TabKey>
                  active={tab}
                  onChange={setTab}
                  tabs={[
                    { key: "overview", label: "سنجه‌ها و ممیزی", icon: <IconScale className="h-3.5 w-3.5" /> },
                    { key: "matrix", label: "ماتریس چندطرحی", icon: <IconLayers className="h-3.5 w-3.5" />, badge: fmtNum(result.product?.modes.length ?? 0) },
                    { key: "alm", label: "جریان نقد ALM", icon: <IconChart className="h-3.5 w-3.5" /> },
                    { key: "dossier", label: "دوسیه محصول", icon: <IconDoc className="h-3.5 w-3.5" /> },
                    { key: "guild", label: "بوم زیست‌بوم صنفی", icon: <IconNetwork className="h-3.5 w-3.5" /> },
                    { key: "market", label: "تحلیل بازار", icon: <IconDatabase className="h-3.5 w-3.5" /> },
                    { key: "catalog", label: "کاتالوگ تسهیلات", icon: <IconDatabase className="h-3.5 w-3.5" /> },
                    { key: "simorgh", label: "آزمایشگاه سیمرغ", icon: <IconFlask className="h-3.5 w-3.5" /> },
                    { key: "sensitivity", label: "حساسیت‌سنجی", icon: <IconFlask className="h-3.5 w-3.5" /> },
                    { key: "compliance", label: "انطباق و حسابداری", icon: <IconShield className="h-3.5 w-3.5" /> },
                    { key: "knowledge", label: "RAG و بنچمارک", icon: <IconDatabase className="h-3.5 w-3.5" /> },
                    { key: "report", label: "گزارش مدیریتی", icon: <IconDoc className="h-3.5 w-3.5" /> },
                  ]}
                />

                <div className="mt-4">
                  {tab === "overview" ? (
                    <MetricsPanel
                      metrics={metrics}
                      request={request}
                      iterations={result.iterations}
                      findings={result.findings}
                      validationStatus={result.validationStatus}
                      horizonMonths={result.alm?.horizonMonths ?? request?.horizonMonths ?? 60}
                      monteCarloRuns={result.alm?.monteCarloRuns ?? 0}
                    />
                  ) : null}
                  {tab === "matrix" ? (
                    <MultiModeMatrixTable product={result.product} findings={result.findings} />
                  ) : null}
                  {tab === "alm" ? <ALMCashFlowChart alm={result.alm} request={request} /> : null}
                  {tab === "dossier" ? <ProductDossierPanel dossier={result.dossier} /> : null}
                  {tab === "guild" ? (
                    <GuildEcosystemCanvas
                      ecosystem={result.ecosystem}
                      persona={result.persona}
                      product={result.product}
                    />
                  ) : null}
                  {tab === "market" ? <MarketIntelPanel intel={result.marketIntel} /> : null}
                  {tab === "catalog" ? (
                    <FacilityCatalog
                      benchmarks={catalogBenchmarks.length ? catalogBenchmarks : []}
                      onUse={(b) => {
                        const rate = b.profitRate ?? b.feeRate;
                        const text =
                          `یک محصول مشابه «${b.productFa}» (${b.bank}) طراحی کن: سقف ${Math.round(b.ceilingToman / 1e6)} میلیون تومان` +
                          `${rate ? `، ${b.profitRate ? "نرخ" : "کارمزد"} ${(rate * 100).toFixed(1)}٪` : ""}` +
                          `${b.tenorMonths ? `، سررسید ${b.tenorMonths} ماه` : ""}` +
                          `${b.segmentFa ? `، بخش هدف ${b.segmentFa}` : ""}` +
                          `؛ ۸ همت منبع، IRR هدف حداقل ۲۳٪، سقف LDR ۸۵٪، کف LCR ۱٫۰۵ و حداکثر ریسک واژگونی ۵٪`;
                        setSeededPrompt({ text, nonce: Date.now() });
                      }}
                    />
                  ) : null}
                  {tab === "simorgh" ? (
                    <SimorghLab
                      report={result.simorgh}
                      estimate={({ prompt }) => {
                        setSeededPrompt({ text: prompt, nonce: Date.now() });
                      }}
                    />
                  ) : null}
                  {tab === "sensitivity" ? <SensitivityDashboard sensitivity={result.sensitivity} /> : null}
                  {tab === "compliance" ? (
                    <CompliancePanel
                      complianceDraft={result.complianceDraft}
                      accountingEntries={result.accountingEntries}
                    />
                  ) : null}
                  {tab === "knowledge" ? (
                    <KnowledgePanel constraints={result.constraints} benchmarks={result.benchmarks} />
                  ) : null}
                  {tab === "report" ? (
                    <ReportPanel reportFa={result.reportFa} reportEn={result.reportEn} runId={result.runId} />
                  ) : null}
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>

      <footer className="mt-8 border-t border-line/70 pt-4 text-[10.5px] leading-6 text-mist/70">
        <p>
          لایه تحویل: Next.js (App Router) + TypeScript + Tailwind + Recharts · لایه داده: PostgreSQL با
          Drizzle ORM (جدول‌های <span className="num">kb_documents</span>،{" "}
          <span className="num">benchmarks</span>، <span className="num">generation_runs</span>) · لایه
          ریاضی: موتور قطعی هزینه تمام‌شده منابع، موتور امتیاز میانگین حساب، دوقلوی دیجیتال ALM و
          حل‌کننده معکوس MILP/MINLP · لایه عامل: StateGraph هفت‌گره‌ای با مسیریابی شرطی و حلقه
          خوداصلاحی تا ۵ گام.
        </p>
        <p className="mt-1">
          ارقام تولیدشده صرفاً خروجی مدل شبیه‌سازی داخلی این سامانه است و جایگزین مصوبات شورای پول و
          اعتبار نیست.
        </p>
      </footer>
    </main>
  );
}
