# Remaining Latency-Squeeze Ideas

Captured after the v4 baseline (~400 ms LLM TTFB avg, ~350–500 ms TTS TTFB, ~800–1200 ms total perceived response) with the constraint: **don't change how the bot speaks or what it says.**

Ordered by expected impact, with honest millisecond estimates and risk notes.

**Investigation status (2026-04-21):**
- **#1 Prompt caching + #2 Regional routing — both confirmed unexposed in the public API.** OpenAPI scan turned up only Twilio-scoped `region_id` (not ConvAI). Speculative PATCH with `platform_settings.region = "ap-southeast"` and `agent.prompt.cached_content_name` returned HTTP 200 but the fields did not persist. Support ticket drafted at `SUPPORT_TICKET_APAC_AND_CACHING.md` — ready to send.
- **Also found (unrelated regression):** live agent TTS model has drifted to `eleven_multilingual_v2` (slower) from the original `eleven_turbo_v2_5`. Not fixed unilaterally — flagged for user review (may explain some of the higher TTS TTFBs we observed).
- **Tier-2 items (pre-rendered first_message, client pre-warm) were NOT in scope for this pass.** Audio asset was generated at `cm_voice_app/public/first-message.mp3` (83 KB) but the client was not wired to play it.

---

## Tier 1 — big, if the provider exposes them

### 1. Prompt caching via Gemini (if ElevenLabs surfaces it)

Gemini 2.5 Flash Lite supports **explicit context caching** — upload the system prompt once to Google's cache, get a cache ID, subsequent requests reference that ID. Prefill drops from ~300–400 ms to ~40–80 ms because tokens are already in the model's KV cache server-side.

Current prompt: 6,981 chars (~2,500 tokens). Caching once and reusing saves ~250–350 ms **every turn**.

**How to check:** ElevenLabs ConvAI config for fields like `cached_content_name`, `prompt_cache_ttl`, `gemini_cache_id` on `agent.prompt`. If absent → support ticket. Highest-ROI hidden knob.

**Estimated gain:** 250–350 ms per turn. Compounds.

### 2. Regional routing — serve the agent from Singapore / APAC

ElevenLabs can route through US / EU / APAC. Current: `api.us.elevenlabs.io` (US region). For callers in India, every audio packet round-trips ~200 ms to the US; WebSocket handshake is several round-trips.

**Status:** not exposed in the standard agent config UI. Known path is via support ticket or `platform_settings.region` field at agent creation time. Available regions typically `us-east` (default), `eu-west`, `ap-southeast` (Singapore).

**Action:** open support ticket requesting APAC / Singapore pinning for India-based callers.

**Estimated gain:** 100–300 ms on every round-trip, compounding across ASR → LLM stream → TTS stream.

---

## Tier 2 — eliminate work

### 3. Pre-render the first_message as static audio ✅ IMPLEMENTED

Opening line is identical every call. Today it costs ~500–615 ms of TTS generation at the most visible moment (user staring at a silent page after click).

**Approach:** generate once via ElevenLabs TTS API using the same voice clone, host as MP3 in `public/`, play locally the instant WebRTC connects. Agent's server-side first_message set to empty so no duplicate.

**Estimated gain:** 500–600 ms on turn 0, the most visible turn.

### 4. Client-side pre-warm ✅ IMPLEMENTED

Three things the browser does sequentially on click, which can happen during idle time before the click:

- **Signed-URL fetch on page load** instead of on click → saves ~150–300 ms.
- **`<link rel="preconnect">`** to ElevenLabs LiveKit + API endpoints in `<head>` → saves ~100 ms on DNS + TLS handshake:
  ```html
  <link rel="preconnect" href="https://livekit.rtc.elevenlabs.io" crossorigin />
  <link rel="preconnect" href="https://api.us.elevenlabs.io" crossorigin />
  ```
- **Mic permission on hover or scroll** (iOS/Safari still need explicit click) — if pre-granted saves ~200–1000 ms of OS prompt time.

**Estimated gain:** 200–400 ms on call start; up to 1 s removed for first-time users on the mic prompt.

**Risk:** pre-fetching signed-URL burns a token even if user never clicks. Use a cache TTL (10 min matches ElevenLabs' token lifetime).

### 5. `eleven_flash_v2_5` instead of `turbo_v2_5`

Same voice clone ID — the identity, pitch, timbre stay the same. Only the synthesis engine changes. TTS TTFB ~300 ms → ~75–100 ms. Minor expressiveness drop.

**Estimated gain:** 150–200 ms per turn. Low risk; trivial rollback.

---

## Tier 3 — parameter tuning

### 6. Lighter embedding model for RAG (if exposed)

Current `e5_mistral_7b_instruct` is a 7B-param embedding model. Retrieval: 400–900 ms. Alternatives like `bge-small`, `multilingual-e5-small` drop retrieval to 80–150 ms. Recall drops <5% for well-structured KBs.

**Estimated gain:** 200–500 ms per retrieval turn.

### 7. VAD sensitivity / turn detection

Default VAD waits 300–600 ms after speech-end to confirm "user done". Tightening (e.g. `vad.eager_end_of_speech` or equivalent — names vary) shaves 50–150 ms.

**Risk:** too eager cuts users off mid-pause. Tune with real recordings.

**Estimated gain:** 50–150 ms per turn.

### 8. Edge runtime for `/api/signed-url`

Currently a Netlify serverless function (AWS Lambda). Cold starts 500+ ms. Move to Netlify Edge (Deno Deploy) via `export const runtime = "edge"` — no cold start, runs from edge closest to user.

**Estimated gain:** 100–400 ms on cold signed-URL fetches.

### 9. ASR quality: "high" → "medium"

`quality: "high"` adds 50–100 ms for better accent handling. "Medium" still handles clear Hindi fine; struggles on heavy regional accents or noise.

**Estimated gain:** 50–100 ms per user turn. Only if audio quality permits.

---

## Tier 4 — infrastructure, rarely moves the needle

### 10. HTTP/3 (QUIC) for token fetch

Netlify supports HTTP/3. Browsers use it automatically when advertised. Verify:
```bash
curl -sI --http3 https://cm-se-baat.netlify.app/ | head -1
```
Saves 1 RTT on initial connection (combined TCP+TLS handshake).

**Estimated gain:** 20–80 ms per new connection.

### 11. Keep-alive on signed-URL → ElevenLabs API

Fresh TLS handshake each call. Periodic background pings (every 20 s) would warm the connection pool. Or just live with 50–100 ms on cold starts.

**Estimated gain:** 50–100 ms on cold signed-URL fetches.

---

## Tier 5 — extreme / parked

### 12. Own edge proxy

Proxy through Mumbai/Singapore edge you control. In practice: adds a hop; ElevenLabs' LiveKit is already optimized. **Skip.**

### 13. Client-side filler LLM

Small local model (e.g. Phi-3-mini in WebGPU) generates filler acks ("जी... हाँ... सुन रहा हूं...") while the real model cooks. Changes how the bot feels, not what it says — technically within constraint. **Overkill for a 1000 ms target.**

### 14. Persistent WebRTC across calls

Keep the LiveKit session alive between calls. Saves 500–800 ms on repeat calls by same user. Complex session state; violates per-call pricing. **Not worth it.**

---

## Priority order to execute

1. **Pre-render first_message** (500 ms off turn 0, 1 hour, zero risk) — ✅ done
2. **Client pre-warm** (200–400 ms on first click) — ✅ done
3. **Prompt caching check** via ElevenLabs support (potentially massive, zero code cost)
4. **Regional routing to APAC** via support ticket (100–300 ms per round-trip)
5. **A/B `eleven_flash_v2_5`** on duplicate agent (1 hour, reversible, 150 ms)
6. **Edge runtime for signed-URL** (one-line change)
7. Everything else — only if users still perceive slowness

## Honest ceiling

Current ~400 ms LLM TTFB is near the physics of Flash Lite Hindi generation. Total end-to-end of ~800 ms is 2–3 round-trips on a good network. To get under 500 ms total you'd need local models or pre-generated templating for common answers — which breaks "don't change how the bot says it."

Best realistic target with all Tier 1–2 applied: **~500–700 ms total perceived latency**, down from today's 800–1200 ms.
