// Server-side helpers for the ElevenLabs ConvAI API.
// These read XI_API_KEY / VOICE_AGENT_ID from env; never call from the browser.

const EL_BASE = "https://api.elevenlabs.io";

export type ConversationSummary = {
  conversation_id: string;
  agent_id: string;
  agent_name: string | null;
  start_time_unix_secs: number;
  call_duration_secs: number;
  message_count: number;
  status: string;
  termination_reason: string | null;
  call_successful: string | null;
  call_summary_title: string | null;
  main_language: string | null;
  direction: string | null;
};

export type TurnMetric = {
  elapsed_time: number;
};

export type Turn = {
  role: "user" | "agent" | string;
  message: string | null;
  time_in_call_secs: number;
  interrupted: boolean;
  conversation_turn_metrics?: {
    metrics?: Record<string, TurnMetric>;
    convai_asr_provider?: string | null;
    convai_tts_model?: string | null;
  } | null;
  rag_retrieval_info?: {
    chunks?: unknown[];
    embedding_model?: string;
    retrieval_query?: string;
    rag_latency_secs?: number;
  } | null;
  llm_usage?: {
    model_usage?: Record<
      string,
      {
        input?: { tokens: number; price: number };
        input_cache_read?: { tokens: number; price: number };
        output_total?: { tokens: number; price: number };
      }
    >;
  } | null;
};

export type ConversationDetail = {
  conversation_id: string;
  agent_id: string;
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
  transcript: Turn[];
};

function getAuth() {
  const apiKey = process.env.VOICE_API_KEY;
  const agentId = process.env.VOICE_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new Error("VOICE_API_KEY or VOICE_AGENT_ID not set");
  }
  return { apiKey, agentId };
}

export async function listConversations(pageSize = 50): Promise<ConversationSummary[]> {
  const { apiKey, agentId } = getAuth();
  const res = await fetch(
    `${EL_BASE}/v1/convai/conversations?agent_id=${agentId}&page_size=${pageSize}`,
    { headers: { "xi-api-key": apiKey }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  const j = await res.json();
  return j.conversations || [];
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const { apiKey } = getAuth();
  const res = await fetch(`${EL_BASE}/v1/convai/conversations/${id}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`detail failed: ${res.status}`);
  return res.json();
}

// ---- Latency aggregation helpers ----

export type TurnLatency = {
  index: number;
  role: string;
  time_in_call_secs: number;
  message_preview: string;
  // Agent-side
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
  // User-side
  asr_trailing?: number;
  interrupted?: boolean;
};

export function extractTurnLatencies(conv: ConversationDetail): TurnLatency[] {
  return (conv.transcript || []).map((t, i) => {
    const m = t.conversation_turn_metrics?.metrics || {};
    const rag = t.rag_retrieval_info;
    const llm = t.llm_usage?.model_usage || {};
    const llmModelEntry = Object.entries(llm)[0];

    return {
      index: i,
      role: t.role,
      time_in_call_secs: t.time_in_call_secs,
      message_preview: (t.message || "").slice(0, 140),
      llm_ttfb: m["convai_llm_service_ttfb"]?.elapsed_time,
      llm_ttf_sentence: m["convai_llm_service_ttf_sentence"]?.elapsed_time,
      llm_tt_last_sentence: m["convai_llm_service_tt_last_sentence"]?.elapsed_time,
      tts_ttfb: m["convai_tts_service_ttfb"]?.elapsed_time,
      tts_model: t.conversation_turn_metrics?.convai_tts_model,
      rag_latency: rag?.rag_latency_secs,
      rag_chunks: Array.isArray(rag?.chunks) ? rag!.chunks!.length : undefined,
      input_tokens: llmModelEntry?.[1]?.input?.tokens,
      output_tokens: llmModelEntry?.[1]?.output_total?.tokens,
      cost:
        (llmModelEntry?.[1]?.input?.price || 0) +
        (llmModelEntry?.[1]?.output_total?.price || 0),
      llm_model: llmModelEntry?.[0],
      asr_trailing: m["convai_asr_trailing_service_latency"]?.elapsed_time,
      interrupted: t.interrupted,
    };
  });
}

export type CallAggregate = {
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
};

function percentile(xs: number[], p: number) {
  if (!xs.length) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function mean(xs: number[]) {
  if (!xs.length) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function aggregate(conv: ConversationDetail, summary: ConversationSummary): CallAggregate {
  const turns = extractTurnLatencies(conv);
  const agentTurns = turns.filter((t) => t.role === "agent");

  const llmTtfbs = agentTurns.map((t) => t.llm_ttfb).filter((x): x is number => typeof x === "number");
  const ttsTtfbs = agentTurns.map((t) => t.tts_ttfb).filter((x): x is number => typeof x === "number");
  const rags = agentTurns.map((t) => t.rag_latency).filter((x): x is number => typeof x === "number");
  const inputTokens = agentTurns.reduce((s, t) => s + (t.input_tokens || 0), 0);
  const outputTokens = agentTurns.reduce((s, t) => s + (t.output_tokens || 0), 0);

  return {
    conversation_id: summary.conversation_id,
    start_time_unix_secs: summary.start_time_unix_secs,
    call_duration_secs: summary.call_duration_secs,
    message_count: summary.message_count,
    agent_turns: agentTurns.length,
    avg_llm_ttfb: mean(llmTtfbs),
    p95_llm_ttfb: percentile(llmTtfbs, 95),
    avg_tts_ttfb: mean(ttsTtfbs),
    avg_rag_latency: mean(rags),
    total_input_tokens: inputTokens || undefined,
    total_output_tokens: outputTokens || undefined,
    total_cost: conv.metadata?.cost,
    summary_title: summary.call_summary_title,
    termination_reason: summary.termination_reason,
  };
}
