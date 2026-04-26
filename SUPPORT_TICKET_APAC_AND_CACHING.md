# Support Ticket Draft — ElevenLabs ConvAI

> **Status:** draft. Ready to send to ElevenLabs support as-is.

---

**To:** support@elevenlabs.io (or via the in-dashboard support form)
**Subject:** Feature request — enable Gemini prompt caching + APAC region pinning for agent `agent_1401kpna1qqne27ay7b5bdy43s4h`

---

Hi team,

We're operating a production Hindi voice agent (https://cm-se-baat.netlify.app/) on ElevenLabs ConvAI. Callers are in India. After exhausting the agent-config knobs we have access to, we've hit a baseline of ~800–1200 ms end-to-end perceived latency and need two server-side levers that don't appear to be exposed in the public API.

**Context:**

| Item | Value |
|---|---|
| Agent ID | `agent_1401kpna1qqne27ay7b5bdy43s4h` |
| Workspace | `doctoruber` (display name: *Authenticaster*) |
| Account email | nihilycho@gmail.com |
| LLM | `gemini-2.5-flash-lite` |
| System prompt size | 6,981 chars / ~2,500 tokens (static, shared across turns) |
| Observed LLM TTFB (avg) | 400–700 ms |
| Observed RAG latency | 400–900 ms |
| Caller region | India (primarily UP, MP) |
| Current RTC endpoint | `livekit.rtc.elevenlabs.io` resolves to US |

---

## Request 1 — enable Gemini explicit prompt caching

Our `conversation_turn_metrics` responses include:

```
"input_cache_read":  { "tokens": 0, "price": 0.0 },
"input_cache_write": { "tokens": 0, "price": 0.0 },
```

…on every turn. This suggests the caching billing/telemetry is wired up but the feature isn't firing for our agent.

With a static 2,500-token system prompt + KB chunks repeating across turns, explicit Gemini context caching should drop LLM TTFB by ~250–350 ms per turn (prefill collapses when tokens are already resident in the model's KV cache).

**Ask:**
- Is Gemini context caching available as an agent-level toggle, workspace feature flag, or tier upgrade?
- If available, please enable for workspace `doctoruber` / agent `agent_1401kpna1qqne27ay7b5bdy43s4h`.
- If it's automatic, any guidance on why `input_cache_read.tokens` is consistently 0 on long calls with a static prompt?

We speculatively PATCHed fields like `prompt_cache_ttl` and `cached_content_name` on the agent's `prompt` object — the PATCH returned 200 but the fields did not persist, confirming they're not part of the current schema.

---

## Request 2 — APAC / Singapore region routing

All traffic currently routes through `api.us.elevenlabs.io` and `livekit.rtc.elevenlabs.io` (US region). For India-based callers, every audio packet is a ~200 ms round-trip, and this compounds across ASR → LLM streaming → TTS streaming turns.

**Ask:**
- Do you offer `ap-southeast` (Singapore) region routing for ConvAI agents?
- If yes, please pin agent `agent_1401kpna1qqne27ay7b5bdy43s4h` to that region.
- We searched `platform_settings` and nested agent config for a `region` / `geo` / `rtc_region` field — nothing exposed. The only `region_id` in the OpenAPI schema is for Twilio telephony (not our path).

We're on the Creator tier; happy to upgrade if region pinning is gated behind Enterprise.

---

## Additional context

- We've already applied every public-API-exposed latency lever: `gemini-2.5-flash-lite`, `max_tokens: 300`, `speculative_turn: true`, `thinking_budget: 0`, RAG tuned to 6 chunks / 8000 doc length / 0.5 vector distance, trimmed system prompt from 19 KB → 7 KB, bumped `livekit-client` to `2.18.4`.
- Our dashboard at `/dashboard` on the site surfaces per-turn metrics (`convai_llm_service_ttfb`, `convai_tts_service_ttfb`, `rag_latency_secs`, token counts). Happy to share screenshots or a specific `conversation_id` for diagnostic reference (e.g. `conv_2101kpnm07d8e639n76q62qhzph0` was a healthy 15-turn call).
- We understand both requests may need operational work on your side. A timeline estimate (even "not soon") is more useful than silence.

Thanks,
Manu Bhadoria
nihilycho@gmail.com
