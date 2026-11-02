"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TraceEvent } from "@/lib/agents/state";
import { NODE_LABEL_FA } from "@/lib/agents/state";
import { Badge, IconBrain, Panel, fmtNum } from "./ui";

const NODE_ORDER = [
  "intent_analyzer",
  "regulatory_rag",
  "guild_persona",
  "mathematical_synthesizer",
  "alm_stress_tester",
  "critic_auditor",
  "executive_report_generator",
] as const;

const LEVEL_STYLE: Record<TraceEvent["level"], string> = {
  info: "border-line text-mist",
  ok: "border-teal/40 text-teal",
  warn: "border-gold/45 text-gold",
  error: "border-rose/50 text-rose",
};

const LEVEL_DOT: Record<TraceEvent["level"], string> = {
  info: "bg-sky/70",
  ok: "bg-teal",
  warn: "bg-gold",
  error: "bg-rose",
};

export default function AgentReasoningStream({
  events,
  running,
}: {
  events: TraceEvent[];
  running: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [autoscroll, setAutoscroll] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const visited = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => set.add(e.node));
    return set;
  }, [events]);

  const activeNode = events.length ? events[events.length - 1].node : null;

  useEffect(() => {
    if (autoscroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [events.length, autoscroll]);

  return (
    <Panel
      title="جریان استدلال عامل‌ها (LangGraph StateGraph)"
      subtitle="رویدادهای زنده هفت گره با مسیریابی شرطی و حلقه خوداصلاحی ممیز"
      icon={<IconBrain className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoscroll((v) => !v)}
            className="rounded-md border border-line px-2 py-1 text-[10.5px] text-mist transition hover:text-chalk"
          >
            پیمایش خودکار: {autoscroll ? "روشن" : "خاموش"}
          </button>
          <Badge tone={running ? "gold" : "teal"}>
            {running ? (
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-gold" />
            ) : null}
            {fmtNum(events.length)} رویداد
          </Badge>
        </div>
      }
      bodyClass="p-0"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line/70 px-3 py-2">
        {NODE_ORDER.map((node, i) => {
          const isVisited = visited.has(node);
          const isActive = activeNode === node;
          return (
            <div key={node} className="flex items-center gap-1">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] transition ${
                  isActive
                    ? "border-gold/60 bg-gold/10 text-gold"
                    : isVisited
                      ? "border-teal/35 bg-teal/5 text-teal/90"
                      : "border-line text-mist/60"
                }`}
              >
                <span className="num opacity-60">{i + 1}</span>
                {NODE_LABEL_FA[node]}
              </span>
              {i < NODE_ORDER.length - 1 ? (
                <span className="text-mist/25">‹</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        ref={boxRef}
        className="max-h-[430px] min-h-[180px] space-y-1.5 overflow-y-auto px-3 py-3"
      >
        {events.length === 0 ? (
          <p className="py-8 text-center text-[11.5px] text-mist/70">
            هنوز رویدادی جریان ندارد. پس از اجرای خط لوله، استدلال گره‌ها اینجا زنده پخش می‌شود.
          </p>
        ) : null}
        {events.map((event) => {
          const open = expanded[event.id];
          const hasDetail = Boolean(event.detailFa || event.metrics);
          return (
            <article
              key={event.id}
              className={`rise-in rounded-lg border bg-[rgba(9,14,24,0.55)] px-3 py-2 ${LEVEL_STYLE[event.level]}`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 shrink-0">
                  <span
                    className={`block h-1.5 w-1.5 rounded-full ${LEVEL_DOT[event.level]} ${
                      running && event.id === events.length - 1 ? "pulse-dot" : ""
                    }`}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[11.8px] leading-6 text-chalk">{event.titleFa}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="num text-[10px] text-mist/60">
                        {(event.ts / 1000).toFixed(2)}s
                      </span>
                      <span className="rounded border border-line px-1.5 text-[9.5px] text-mist/70">
                        {event.stage}
                      </span>
                      {hasDetail ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [event.id]: !prev[event.id] }))
                          }
                          className="rounded border border-line px-1.5 text-[9.5px] text-mist transition hover:text-gold"
                        >
                          {open ? "بستن" : "جزئیات"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {event.detailFa && open ? (
                    <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-line/70 bg-[rgba(4,7,13,0.6)] p-2 font-sans text-[11px] leading-6 text-mist">
                      {event.detailFa}
                    </pre>
                  ) : null}
                  {event.metrics && open ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {Object.entries(event.metrics).map(([k, v]) => (
                        <span
                          key={k}
                          className="num rounded border border-line bg-[rgba(255,255,255,0.03)] px-1.5 py-0.5 text-[9.5px] text-mist"
                        >
                          {k}={typeof v === "number" ? v.toFixed(4).replace(/\.?0+$/, "") : v}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}
