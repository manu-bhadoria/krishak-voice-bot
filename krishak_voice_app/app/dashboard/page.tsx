"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Call = {
  conversation_id: string;
  start_time_unix_secs: number;
  call_duration_secs: number;
  message_count: number;
  agent_turns: number;
  avg_llm_ttfb?: number;
  p95_llm_ttfb?: number;
  avg_tts_ttfb?: number;
  avg_rag_latency?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cost?: number;
  summary_title?: string | null;
  termination_reason?: string | null;
  error?: string;
};

function fmtSecs(n?: number) {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 1000).toFixed(0)} ms`;
}
function fmtDur(n: number) {
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtTime(unix: number) {
  return new Date(unix * 1000).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function ttfbColor(ms?: number) {
  if (ms == null) return "text-[#80746a]";
  if (ms < 1500) return "text-green-700";
  if (ms < 2500) return "text-amber-600";
  return "text-red-600";
}

export default function DashboardPage() {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/metrics/conversations?limit=20");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setCalls(d.calls);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Fleet-wide aggregates
  const agg = calls && calls.length
    ? (() => {
        const ll = calls.map((c) => c.avg_llm_ttfb).filter((x): x is number => typeof x === "number");
        const tt = calls.map((c) => c.avg_tts_ttfb).filter((x): x is number => typeof x === "number");
        const rr = calls.map((c) => c.avg_rag_latency).filter((x): x is number => typeof x === "number");
        const cost = calls.reduce((s, c) => s + (c.total_cost || 0), 0);
        const tok = calls.reduce((s, c) => s + (c.total_input_tokens || 0), 0);
        const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
        return {
          fleet_llm: avg(ll),
          fleet_tts: avg(tt),
          fleet_rag: avg(rr),
          total_cost: cost,
          total_tokens: tok,
          total_calls: calls.length,
        };
      })()
    : null;

  return (
    <div className="backdrop-hero min-h-screen">
      <header className="nav-glass fixed top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-saffron flex items-center justify-center text-white font-bold text-sm">
              कृ
            </div>
            <div className="leading-tight">
              <p className="text-[14px] font-semibold text-[#1e1812]">Latency Dashboard</p>
              <p className="text-[10px] text-[#80746a]">Krishak Voice Bot — Dr. Mohan Yadav</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-[12px] text-[#80746a] hover:text-saffron transition-colors">
              ← कॉल पेज
            </Link>
            <button
              onClick={load}
              disabled={refreshing}
              className="text-[12px] text-saffron hover:opacity-80 disabled:opacity-50"
            >
              {refreshing ? "..." : "↻ Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="pt-[84px] pb-16 max-w-7xl mx-auto px-4 sm:px-6">
        {agg && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <KPI label="Calls" value={agg.total_calls.toString()} />
            <KPI
              label="Avg LLM TTFB"
              value={fmtSecs(agg.fleet_llm)}
              hint={agg.fleet_llm && agg.fleet_llm > 2 ? "slow" : "good"}
              color={ttfbColor(agg.fleet_llm ? agg.fleet_llm * 1000 : undefined)}
            />
            <KPI label="Avg TTS TTFB" value={fmtSecs(agg.fleet_tts)} />
            <KPI label="Avg RAG" value={fmtSecs(agg.fleet_rag)} />
            <KPI label="Total Credits" value={agg.total_cost.toLocaleString()} />
          </div>
        )}

        {err && <div className="text-red-600 text-sm mb-4">Error: {err}</div>}

        <div className="rounded-lg border border-[#e8dcc1] overflow-hidden surface-card">
          <table className="w-full text-[12px]">
            <thead className="bg-[#f4e7ca] text-[#80746a] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Start</th>
                <th className="text-left px-3 py-2">Summary</th>
                <th className="text-right px-3 py-2">Dur</th>
                <th className="text-right px-3 py-2">Turns</th>
                <th className="text-right px-3 py-2">Avg LLM</th>
                <th className="text-right px-3 py-2">p95 LLM</th>
                <th className="text-right px-3 py-2">Avg TTS</th>
                <th className="text-right px-3 py-2">Avg RAG</th>
                <th className="text-right px-3 py-2">Tokens In</th>
                <th className="text-right px-3 py-2">Credits</th>
              </tr>
            </thead>
            <tbody>
              {calls === null && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-[#80746a]">
                    Loading...
                  </td>
                </tr>
              )}
              {calls && calls.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-[#80746a]">
                    No calls yet.
                  </td>
                </tr>
              )}
              {calls?.map((c, i) => (
                <tr
                  key={c.conversation_id}
                  className={`border-t border-[#e8dcc1] surface-row-hover ${
                    i % 2 ? "surface-row-alt" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-[#4a4035]">{fmtTime(c.start_time_unix_secs)}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/${c.conversation_id}`}
                      className="text-saffron font-medium hover:underline"
                    >
                      {c.summary_title || c.conversation_id.slice(-8)}
                    </Link>
                    {c.termination_reason && c.termination_reason !== "Client disconnected: 1000" && (
                      <span className="ml-2 text-[10px] text-[#80746a]">
                        {c.termination_reason.slice(0, 30)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-[#4a4035] font-mono">
                    {fmtDur(c.call_duration_secs)}
                  </td>
                  <td className="px-3 py-2 text-right text-[#4a4035] font-mono">
                    {c.agent_turns || c.message_count}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${ttfbColor(
                      c.avg_llm_ttfb ? c.avg_llm_ttfb * 1000 : undefined
                    )}`}
                  >
                    {fmtSecs(c.avg_llm_ttfb)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${ttfbColor(
                      c.p95_llm_ttfb ? c.p95_llm_ttfb * 1000 : undefined
                    )}`}
                  >
                    {fmtSecs(c.p95_llm_ttfb)}
                  </td>
                  <td className="px-3 py-2 text-right text-[#4a4035] font-mono">
                    {fmtSecs(c.avg_tts_ttfb)}
                  </td>
                  <td className="px-3 py-2 text-right text-[#4a4035] font-mono">
                    {fmtSecs(c.avg_rag_latency)}
                  </td>
                  <td className="px-3 py-2 text-right text-[#4a4035] font-mono">
                    {c.total_input_tokens?.toLocaleString() || "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[#4a4035] font-mono">
                    {c.total_cost != null ? c.total_cost.toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-[10px] text-[#80746a] leading-relaxed">
          LLM TTFB = time from request to first streamed token. TTS TTFB = time from text to first audio byte.
          RAG = knowledge-base retrieval. Colors: &lt; 1.5s green, 1.5–2.5s yellow, &gt; 2.5s red.
        </p>
      </main>
    </div>
  );
}

function KPI({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="surface-card rounded-lg px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[#80746a]">{label}</div>
      <div className={`text-lg font-mono mt-1 ${color || "text-[#1e1812]"}`}>{value}</div>
      {hint && <div className="text-[9px] text-[#80746a] mt-0.5">{hint}</div>}
    </div>
  );
}
