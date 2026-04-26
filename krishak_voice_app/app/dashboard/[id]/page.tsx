"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

type Turn = {
  index: number;
  role: string;
  time_in_call_secs: number;
  message_preview: string;
  llm_ttfb?: number;
  llm_ttf_sentence?: number;
  llm_tt_last_sentence?: number;
  tts_ttfb?: number;
  tts_model?: string | null;
  rag_latency?: number;
  rag_chunks?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
  llm_model?: string;
  asr_trailing?: number;
  interrupted?: boolean;
};

type Detail = {
  conversation_id: string;
  agent_name: string | null;
  status: string;
  metadata: {
    start_time_unix_secs: number;
    call_duration_secs: number;
    cost?: number;
    main_language?: string;
    termination_reason?: string;
    rag_usage?: { usage_count?: number; embedding_model?: string };
  };
  turns: Turn[];
};

function fmtMs(n?: number) {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 1000).toFixed(0)}ms`;
}


export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/metrics/conversations/${id}`);
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        setData(j);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, [id]);

  const agentTurns = data?.turns.filter((t) => t.role === "agent") || [];
  const llmTtfbs = agentTurns.map((t) => t.llm_ttfb).filter((x): x is number => typeof x === "number");
  const avgLlm = llmTtfbs.length ? llmTtfbs.reduce((a, b) => a + b, 0) / llmTtfbs.length : undefined;
  const maxLlm = llmTtfbs.length ? Math.max(...llmTtfbs) : undefined;
  const minLlm = llmTtfbs.length ? Math.min(...llmTtfbs) : undefined;

  return (
    <div className="backdrop-hero min-h-screen">
      <header className="nav-glass fixed top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-saffron flex items-center justify-center text-white font-bold text-sm">
              म
            </div>
            <div className="leading-tight">
              <p className="text-[14px] font-semibold text-[#1e1812]">Call Details</p>
              <p className="text-[10px] text-[#80746a] font-mono">{id}</p>
            </div>
          </div>
          <Link href="/dashboard" className="text-[12px] text-[#80746a] hover:text-saffron">
            ← Back
          </Link>
        </div>
      </header>

      <main className="pt-[84px] pb-16 max-w-7xl mx-auto px-4 sm:px-6">
        {err && <div className="text-red-600 text-sm mb-4">Error: {err}</div>}
        {!data && !err && <div className="text-[#80746a]">Loading...</div>}

        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
              <KPI label="Duration" value={`${Math.floor(data.metadata.call_duration_secs / 60)}:${String(data.metadata.call_duration_secs % 60).padStart(2, "0")}`} />
              <KPI label="Agent Turns" value={agentTurns.length.toString()} />
              <KPI label="Avg LLM TTFB" value={fmtMs(avgLlm)} />
              <KPI label="Min / Max LLM" value={`${fmtMs(minLlm)} / ${fmtMs(maxLlm)}`} />
              <KPI label="Credits" value={data.metadata.cost != null ? data.metadata.cost.toLocaleString() : "—"} />
            </div>

            <div className="mb-6 surface-card rounded-lg p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#80746a] mb-2">Config captured</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div><span className="text-[#80746a]">Language:</span> <span className="font-mono text-[#1e1812]">{data.metadata.main_language || "—"}</span></div>
                <div><span className="text-[#80746a]">LLM:</span> <span className="font-mono text-[#1e1812]">{agentTurns[0]?.llm_model || "—"}</span></div>
                <div><span className="text-[#80746a]">TTS:</span> <span className="font-mono text-[#1e1812]">{agentTurns[0]?.tts_model || "—"}</span></div>
                <div><span className="text-[#80746a]">RAG calls:</span> <span className="font-mono text-[#1e1812]">{data.metadata.rag_usage?.usage_count ?? "—"}</span></div>
              </div>
            </div>

            <div className="space-y-2">
              {data.turns.map((t) => (
                <TurnRow key={t.index} turn={t} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function TurnRow({ turn }: { turn: Turn }) {
  const isAgent = turn.role === "agent";
  return (
    <div
      className={`rounded-lg border border-[#e8dcc1] p-3 ${
        isAgent ? "bg-[#fffdf7]" : "bg-[#f4e7ca]/60"
      }`}
    >
      <div className="flex items-center justify-between text-[10px] text-[#80746a] mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
              isAgent ? "bg-saffron/20 text-saffron" : "bg-[#e8dcc1] text-[#4a4035]"
            }`}
          >
            {turn.role}
          </span>
          <span className="font-mono">#{turn.index + 1}</span>
          <span className="font-mono">@ {turn.time_in_call_secs}s</span>
          {turn.interrupted && (
            <span className="text-orange-600">⚠ interrupted</span>
          )}
        </div>
        {isAgent && (
          <div className="flex items-center gap-3 font-mono">
            {turn.input_tokens != null && (
              <span>
                <span className="text-[#80746a]">in:</span>{" "}
                <span className="text-[#1e1812]">{turn.input_tokens.toLocaleString()}</span>
              </span>
            )}
            {turn.output_tokens != null && (
              <span>
                <span className="text-[#80746a]">out:</span>{" "}
                <span className="text-[#1e1812]">{turn.output_tokens}</span>
              </span>
            )}
            {turn.cost != null && turn.cost > 0 && (
              <span className="text-[#4a4035]">${turn.cost.toFixed(4)}</span>
            )}
          </div>
        )}
      </div>

      <div className="text-sm text-[#1e1812] mb-3 leading-relaxed">
        {turn.message_preview}
      </div>

      {isAgent ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px]">
          <Metric label="LLM TTFB" value={turn.llm_ttfb} bar max={5} />
          <Metric label="LLM 1st sent" value={turn.llm_ttf_sentence} bar max={5} />
          <Metric label="TTS TTFB" value={turn.tts_ttfb} bar max={2} />
          <Metric label="RAG lookup" value={turn.rag_latency} bar max={2} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          <Metric label="ASR trailing" value={turn.asr_trailing} bar max={1} />
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  bar,
  max = 5,
}: {
  label: string;
  value?: number;
  bar?: boolean;
  max?: number;
}) {
  const ms = value == null ? undefined : value * 1000;
  const color =
    ms == null ? "text-[#80746a]" : ms < 1500 ? "text-green-700" : ms < 2500 ? "text-amber-600" : "text-red-600";
  return (
    <div className="rounded border border-[#e8dcc1] bg-[#fffdf7] px-2.5 py-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[9px] uppercase tracking-wider text-[#80746a]">{label}</div>
        <div className={`font-mono text-[11px] ${color}`}>
          {value == null ? "—" : `${(value * 1000).toFixed(0)}ms`}
        </div>
      </div>
      {bar && value != null && (
        <div className="mt-1">{ttfbBar(value, max)}</div>
      )}
    </div>
  );
}

function ttfbBar(secs: number, maxSecs = 5) {
  const pct = Math.min(100, (secs / maxSecs) * 100);
  const color = secs < 1.5 ? "bg-green-600" : secs < 2.5 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full bg-[#f4e7ca] h-1 rounded-full overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card rounded-lg px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[#80746a]">{label}</div>
      <div className="text-lg font-mono mt-1 text-[#1e1812]">{value}</div>
    </div>
  );
}
