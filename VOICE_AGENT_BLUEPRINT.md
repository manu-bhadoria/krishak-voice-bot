# Low-Latency Voice Agent Blueprint

A reproducible recipe for building first-person, persona-driven, Hindi/multilingual voice agents on ElevenLabs ConvAI with sub-second LLM TTFB and a clean frontend. Distilled from building the CM Dr. Mohan Yadav voice bot.

**Baseline achieved:** LLM TTFB **~400 ms avg** (p95 ~660 ms), TTS TTFB **~350–500 ms**, total perceived response time **~800–1200 ms** from user speech-end to first agent audio byte, across multi-turn calls.

---

## Table of Contents

1. [What this pattern is (and isn't)](#1-what-this-pattern-is-and-isnt)
2. [Architecture](#2-architecture)
3. [Latency budget and optimization priority](#3-latency-budget-and-optimization-priority)
4. [Model and runtime choices](#4-model-and-runtime-choices)
5. [System prompt design](#5-system-prompt-design)
6. [Knowledge base strategy (two-tier)](#6-knowledge-base-strategy-two-tier)
7. [RAG tuning](#7-rag-tuning)
8. [Output length and context drift control](#8-output-length-and-context-drift-control)
9. [TTS safety for Indic languages](#9-tts-safety-for-indic-languages)
10. [Frontend — zero-latency rules](#10-frontend--zero-latency-rules)
11. [Guardrail patterns (political / safety / honesty)](#11-guardrail-patterns)
12. [Prompt versioning (never lose history)](#12-prompt-versioning-never-lose-history)
13. [Observability — latency dashboard](#13-observability--latency-dashboard)
14. [Deploy pipeline (Netlify + GitHub Actions)](#14-deploy-pipeline)
15. [Quickstart — building a new bot in a day](#15-quickstart--building-a-new-bot-in-a-day)
16. [Checklist of canonical values](#16-checklist-of-canonical-values)

---

## 1. What this pattern is (and isn't)

### Is
- A **voice-only call experience**. User taps a button, bot speaks in character, user speaks back. One decisive moment.
- **First-person persona**. The agent speaks AS a named individual with a documented corpus — not as a helpful assistant.
- **Thin web client** (Next.js) that hands off to a ConvAI provider over WebRTC. All ML runs on the provider side.
- **RAG-grounded** for facts. The agent never invents numbers or policy positions.
- **Guardrail-heavy**. Honesty, political firewall, no-new-promises, crisis handoff, recording notice.

### Isn't
- A chatbot. No text bubbles. No "How can I help?" message list.
- Feature-rich app. No dashboards visible to the caller, no multi-step flows, no forms.
- Multi-agent orchestration. One agent, one voice, one conversation.
- Self-hosted ML. Don't run your own LLM/TTS for a voice agent — round-trip latency will eat you alive. Use a ConvAI provider.

---

## 2. Architecture

```
Caller (browser mic)
     │
     │  WebRTC audio stream (LiveKit under the hood)
     ▼
Next.js App (thin client)                ElevenLabs ConvAI
     │                                   ┌────────────────────────┐
     │  GET /api/signed-url              │  ASR (Scribe v2)       │
     │  (server route, uses xi-api-key)  │  LLM (Gemini Flash)    │
     │                                   │  RAG (e5-mistral-7b)   │
     └─────── conversation token ───────►│  TTS (Turbo v2_5)      │
                                         │  Voice clone           │
                                         └────────────────────────┘
```

**Three separation boundaries that matter:**
1. **API key never reaches the browser.** Server-only route `/api/signed-url` exchanges the xi-api-key for a short-lived WebRTC conversation token (JWT valid ~15 min).
2. **ML lives entirely on the ConvAI side.** The client app only handles UI + mic permission + token handshake + call-state rendering.
3. **Prompt + KB live on the agent config.** Not in the client, not in the deploy bundle. Only artefacts for reproducibility.

**Files that carry the pattern:**
- `cm_voice_app/app/api/signed-url/route.ts` — token handshake (20 lines)
- `cm_voice_app/components/VoiceCall.tsx` — call UI (single React component using `@elevenlabs/react`'s `useConversation` hook)
- `cm_voice_app/docs/elevenlabs_agent_prompt_cm.md` — the system prompt, paste-ready into ElevenLabs
- `cm_voice_app/setup_agent.py` — one-shot creation script (idempotent-ish; use once per new agent)
- `cm_voice_app/update_agent.py` — maintenance script that PATCHes prompt + KB + config while auto-snapshotting versions

---

## 3. Latency budget and optimization priority

Every user-visible latency decomposes into this stack:

```
[user finishes speaking] →
  ASR trailing latency         ~50–150 ms
  Turn detection / VAD         ~100–300 ms
  RAG retrieval                ~400–900 ms (parallelizable with LLM prefill)
  LLM prefill + TTFB           ~400–1500 ms  (the biggest lever)
  TTS TTFB                     ~250–600 ms   (second biggest)
  Network + audio decode       ~100–200 ms
[user hears first agent syllable]
```

**Target total: sub-1000 ms from speech-end to first audio byte.** We achieved 800–1200 ms consistently.

### Priority order for optimization (highest impact first)

| # | Lever | Typical gain | How |
|---|---|---|---|
| 1 | **LLM model choice** | 500–2000 ms | Pick a streaming, low-TTFB model. Gemini 2.5 Flash Lite beats gpt-5.x here. Avoid thinking/reasoning models. |
| 2 | **System prompt size** | 100–250 ms | Every token in the prompt is re-processed every turn. Keep under 7K chars. |
| 3 | **Output token cap** | 300–1000 ms perceived | `max_tokens: 300`. Shorter reply = less TTS duration = user hears "done" sooner. |
| 4 | **`speculative_turn: true`** | 200–500 ms perceived | Agent starts generating while user is still speaking. Cached if prediction aligns. |
| 5 | **RAG chunk cap** | 100–400 ms | `max_retrieved_rag_chunks_count: 6`, `max_documents_length: 8000`. |
| 6 | **TTS model choice** | 100–200 ms | `eleven_turbo_v2_5` over older models. `eleven_flash_v2_5` shaves another 75–150 ms if quality trade is acceptable. |
| 7 | **Frontend preload** | 150–300 ms one-time | `<link rel="preload" fetchPriority="high">` for portrait, system fonts, no blocking network on mount. |
| 8 | **WebRTC (not WebSocket)** | 100–200 ms jitter | `connectionType: "webrtc"` — has AEC, jitter buffer, PLC built in. |

### Don't touch (or touch last)
- Temperature below 0.3 — robotic voice.
- Reasoning effort / thinking budget — pure latency penalty with no quality gain for conversational agents.
- Reducing KB size — retrieval is already capped at 6 chunks; shrinking docs hurts recall without helping speed.

---

## 4. Model and runtime choices

### LLM — `gemini-2.5-flash-lite`

**Why:**
- Sub-500 ms TTFB streaming.
- Handles Hindi + English code-switching cleanly.
- Supports large context window so conversation history doesn't truncate mid-call.
- Cheap per token.

**Why not:**
- `gpt-5.x`: 1.5–3 s TTFB, not worth it for conversational pacing.
- Gemini Pro: better reasoning, 2× slower. Only use if task requires actual reasoning (math, coding, multi-hop inference).
- Claude: not natively integrated in ElevenLabs at time of writing. Skip for ConvAI.
- Anything with "thinking" / "reasoning" mode: fatal for voice UX.

**Set `thinking_budget: 0` explicitly** — in the ConvAI config, Gemini models default to some reasoning budget that silently kills latency. Zero it.

### TTS — `eleven_turbo_v2_5`

**Why:**
- ~250–400 ms TTFB on Hindi.
- Multi-lingual, handles Devanagari natively.
- Voice clone fidelity holds up.

**Alternatives to A/B:**
- `eleven_flash_v2_5` — 75 ms TTFB, slightly less expressive. Worth testing for speed-critical calls.
- `eleven_multilingual_v2` — better at rare languages but 500+ ms TTFB. Skip.

### Voice settings
```python
"stability": 0.45,         # not too rigid, not too warbly
"similarity_boost": 0.85,  # keep close to clone
"style": 0.3,              # subtle expressiveness, no melodrama
"use_speaker_boost": True
```

### ASR — `elevenlabs` provider, `pcm_16000`

Default is fine. `quality: "high"` adds ~50 ms but improves Hindi accent robustness — worth it. Scribe v2 handles Hindi-English code-switching well.

### Conversation config
```python
"turn": {
    "turn_timeout": 7,            # seconds of user silence before agent replies. 7 respects pauses.
    "speculative_turn": True,     # pre-generate while user speaks. Biggest perceived-latency win.
    "turn_eagerness": "normal",   # "aggressive" risks cutting users off.
},
"conversation": {
    "max_duration_seconds": 600,  # 10-minute hard cap.
}
```

---

## 5. System prompt design

### Golden rules

1. **Target under 7,000 characters of Devanagari / 3,500 English words.** Every char is re-processed per turn. The v4 CM prompt lives at 6,981 chars.
2. **Structure must be skimmable** — `### SECTION HEADERS`, numbered critical rules, clear conversation flow. LLMs follow structure, not prose.
3. **Lead with identity, not rules.** First 500 chars = who you are in first person. Then personality. Then rules.
4. **Numbered rules with "0-tier" for absolutes.** Rules 0, 0a, 0b for non-negotiables. Rules 1–14 for flow.
5. **Critical rules at the top AND bottom.** Some models attend to beginning, some to end. Repeat the non-negotiables.
6. **Include conversation flow as a 7-step blueprint.** Greeting → listen → ack → question → answer → commit → close.
7. **Every answer template should be a 1–2 sentence example, not a paragraph.** The LLM mirrors length.
8. **Anchor delivery markers.** "Start every answer with देखिए भैया" becomes a reliable opener if stated this explicitly.

### What goes IN the system prompt
- Identity (who you are, 1 paragraph)
- Personality & voice (bullets with concrete markers — filler words, tone, things-to-avoid)
- Signature phrases (short bullet list with 5–10 phrases)
- Response length rule (proportional to question; hard upper bound)
- Critical guardrails (political firewall, honesty-under-challenge, crisis handoff)
- Conversation flow (numbered steps)
- Reference to the knowledge base (tells the LLM the KB exists and when to lean on it)

### What does NOT belong in the system prompt
- Biography details beyond identity
- Long fact tables (schemes, numbers, stakeholders)
- Verbatim quotable lines
- Scenario-specific answer templates
- Controversy playbooks
- Regional or demographic playbooks

All of these live in the knowledge base and are retrieved via RAG only when relevant. Putting them in the prompt is the #2 source of latency bloat in every voice agent.

### Example rule that worked

```
Rule 0: Awadhi/Braj चौपाई-दोहे (तुलसीदास/सूरदास/कबीर) कभी नहीं।
        संस्कृत श्लोक केवल जब कॉलर सीधे मांगे — KB की "Sanskrit Whitelist"
        से ही, प्रति कॉल एक, तुरंत हिंदी अर्थ।
```

Concrete banned items by name + concrete allowed alternative + frequency cap + KB reference + follow-up rule. This is the template.

---

## 6. Knowledge base strategy (two-tier)

Keep the system prompt lean by offloading everything else into **two KB files** uploaded to ElevenLabs as `type: file`, `usage_mode: auto`.

### File 1 — `knowledge_base.md` (persona corpus, ~40 KB)

- Biography with specifics that might be asked for
- Signature phrases / verbatim quotes the bot is allowed to reuse
- Speaking style markers
- Q&A bank for top 20 likely questions, written in first person
- People to invoke respectfully, people to never attack
- Numbers cheat-sheet
- "Never say" list

### File 2 — `knowledge_base_ext.md` (reference material, ~90 KB)

- Organization structure (cabinet / departments / regions)
- Policy fact sheets (one section per department, with current numbers)
- Flagship scheme catalog
- Latest news / ongoing initiatives (date-stamped; refresh every 3 months)
- **Controversy playbook** — 50+ entries of "if asked X, reframe with Y"
- Regional playbooks
- Opposition handling guide
- Relationships matrix
- Curated quote whitelist (Sanskrit shlokas / canonical quotes)

### Why split into two files
- Logical separation = better chunking = better RAG relevance.
- File 1 is persona-gravity. File 2 is fact-retrieval.
- When the user asks "who is your sister?" RAG hits file 1. When they ask "what's the Ladli Behna amount?" RAG hits file 2.
- Both files should cross-reference each other (headers match).

### Canonical structure for KB entries

```
### Topic title
> Retrieval trigger: describe when RAG should surface this chunk.
> Rules the bot must follow when using this content.

**Facts:**
- bullet with number + source
- bullet with number + source

**Bot-ready answer template (2-4 sentences):**
> *"Exact sentences the bot can speak in first person with minor adaptation."*
```

Making the bot-ready templates explicit cuts rendering time — the LLM picks up the template, adapts 1–2 words, delivers.

### Upload mechanics

```python
# One file = one document_id. Keep them small-ish (~50–100 KB each).
POST /v1/convai/knowledge-base/file   (multipart/form-data)
→ returns { "id": "document_id" }

# Attach to agent:
PATCH /v1/convai/agents/{agent_id}
body: {
  "conversation_config": {
    "agent": {
      "prompt": {
        "knowledge_base": [
          {"type": "file", "id": "doc_1", "name": "persona", "usage_mode": "auto"},
          {"type": "file", "id": "doc_2", "name": "extended", "usage_mode": "auto"}
        ],
        "rag": { "enabled": true, ... }
      }
    }
  }
}
```

---

## 7. RAG tuning

ElevenLabs ConvAI exposes these RAG knobs on `agent.prompt.rag`:

### Canonical values that worked

```python
{
  "enabled": True,
  "embedding_model": "e5_mistral_7b_instruct",
  "max_retrieved_rag_chunks_count": 6,   # was 20 default — 6 is enough
  "max_documents_length": 8000,           # was 50000 default — cap injection cost
  "max_vector_distance": 0.5,             # was 0.6 — tighter match, less noise
}
```

### Why these numbers

- **6 chunks**: at ~200 tokens per chunk, that's ~1200 tokens of retrieved context per turn. Plenty for one conversation turn. Going higher adds prefill cost without lifting answer quality.
- **8000 chars `max_documents_length`**: hard cap on total injected content. Protects against runaway when 6 chunks happen to all be large.
- **Vector distance 0.5**: strict enough to drop weak matches. If you see RAG noise in responses (unrelated tangents), tighten to 0.45.
- **e5_mistral_7b_instruct embeddings**: ~300–500 ms retrieval. Lighter embedding models exist but recall drops noticeably for multilingual.

### When to tune

- If RAG latency creeps above 800 ms consistently → lower `max_documents_length` to 6000.
- If bot missing relevant info → loosen vector distance to 0.55 before adding chunks.
- Fresh KB uploads take 1–3 cold calls to warm the index. Don't panic-tune during warmup.

---

## 8. Output length and context drift control

Long calls drift. On a 29-turn call we observed LLM TTFB creep from 400 ms → 1500 ms as conversation history accumulated in the prefill.

### Controls

1. **`max_tokens: 300`** on the agent. Hard cap on LLM output. Combined with a prompt rule saying "length proportional to question", this keeps replies in the 1–6 sentence range.
2. **Explicit response-length rule in the prompt**:
   ```
   - Small-talk → 1–2 sentences
   - Medium topic → 2–4 sentences
   - Substantive topic → 4–6 sentences
   - Never more than 7 in one turn; offer "और क्या विशेष जानना चाहेंगे?" instead.
   ```
3. **`speculative_turn: true`** — pre-generates on user speech. Not a drift cap, but hides the cost.
4. **`max_duration_seconds: 600`** — 10-minute hard cap prevents pathological cases.

### What ElevenLabs does NOT expose (as of 2026-04)
- Explicit conversation-history truncation / rolling window.
- Summarization of older turns.

Workaround: the max_tokens cap keeps per-turn additions small, so even 20-turn calls stay manageable.

---

## 9. TTS safety for Indic languages

**Problem**: ElevenLabs Hindi TTS butchers archaic dialects and partial quotations. Sanskrit works surprisingly well; Awadhi, Braj, and half-chaupais do not.

### Rules

1. **Ban Awadhi / Braj / medieval-Hindi couplets.** Tulsidas, Surdas, Kabir, Meera — do not quote. The phonetic drift from standard Hindi trips the model.
2. **Sanskrit is OK — curated, complete, common.** Single-line from Gita / Upanishad / major shanti mantras. Never partial.
3. **Phonetic respelling for risky shlokas.** Words with avagraha `ऽ`, heavy conjuncts like `ङ्गो`, `र्ध्र`, or Vedic accents get broken into safer graphemes:
   - `सङ्गोऽस्त्वकर्मणि` → `संगो अस्त्व-कर्मणि`
   - `कश्चिद्दुःखभाग्भवेत्` → `कश्चिद् दुःख-भाग्-भवेत्`
4. **"Dr." abbreviation.** Write **"डॉक्टर"** in full, not **"डॉ."** — TTS reads the latter as "do".
5. **English tech acronyms in Devanagari-wrapped context** pronounce fine: MSP, NEP, UPSC, GIS. Keep them.
6. **Partial quotes mid-sentence trigger garble.** If you must quote, quote a full line with punctuation pause after.

### Mandatory delivery protocol for any quoted material

1. Short pause before (comma or `...`).
2. Speak slightly slower (prompt says "15–20% slower").
3. Pause at `।` (half-line), longer pause at `॥` (full).
4. Immediately transition: *"इसका अर्थ है..."* or *"हमारे शास्त्रों में कहा गया है कि..."*.
5. Then Hindi gloss in 1–2 sentences.

---

## 10. Frontend — zero-latency rules

The voice bot's job is audio. The frontend's job is to **not delay the audio.**

### Non-negotiables

1. **No external font fetches.** Use system font stack. Corporate proxies and VPNs sometimes return HTML for Google Fonts URLs, which Firefox blocks entirely. System fonts have none of this risk.
   ```css
   font-family: 'Nirmala UI', 'Kohinoor Devanagari', 'Noto Sans Devanagari',
                -apple-system, BlinkMacSystemFont, sans-serif;
   ```
2. **Preload the hero image.** In `<head>`:
   ```html
   <link rel="preload" as="image" href="/portrait.jpg" fetchPriority="high" />
   ```
3. **No network calls on page mount.** `/api/signed-url` fires on button click, not on load.
4. **All animations via transform / opacity only.** Ban `box-shadow` animations, `width`/`height` animations, anything that triggers layout.
5. **No analytics / tag managers** in the same bundle as the call UI. If you must, lazy-load after first interaction.
6. **Keep the bundle under 250 KB first-load JS.** The CM bot ships 242 KB first-load for `/`.

### Canonical state machine for the call UI

```
idle → (click) → connecting → connected [listening | speaking] → (end) → idle
```

Four states. Three buttons (talk, mute, end). No modals, no onboarding, no toasts.

### Minimum viable VoiceCall component

```tsx
"use client";
import { ConversationProvider, useConversation } from "@elevenlabs/react";

function CallUI() {
  const { status, isSpeaking, startSession, endSession } = useConversation();

  async function start() {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const { conversationToken } = await (await fetch("/api/signed-url")).json();
    startSession({ conversationToken, connectionType: "webrtc" });
  }

  const connected = status === "connected";
  return connected
    ? <button onClick={endSession}>समाप्त</button>
    : <button onClick={start}>बात करें</button>;
}

export const VoiceCall = () => (
  <ConversationProvider><CallUI /></ConversationProvider>
);
```

Thirty lines. Everything else is cosmetic.

### Signed-URL server route (verbatim, 20 lines)

```ts
import { NextResponse } from "next/server";
export async function GET() {
  const agentId = process.env.VOICE_AGENT_ID;
  const apiKey = process.env.VOICE_API_KEY;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
    { headers: { "xi-api-key": apiKey! }, cache: "no-store" }
  );
  if (!res.ok) return NextResponse.json({ error: "token fetch failed" }, { status: 502 });
  const data = await res.json();
  return NextResponse.json({ conversationToken: data.token });
}
```

---

## 11. Guardrail patterns

Every production voice agent needs these. Encode each as a **named section in the system prompt** with example deflection language.

### A. Honesty under challenge ("are you AI?")
- **Never** confirm "I am human".
- **Never** flatly deny "I am AI".
- Use a graceful reframe: *"यह CM कार्यालय की सीधी लाइन है। आपकी बात रिकॉर्ड हो रही है। बताइए..."*
- If caller presses ≥3 times: acknowledge it's a voice-in-the-CM's-style direct line for efficient reach, without claiming humanity.

### B. Political firewall
- List the topics that trigger deflection: caste, religion-based divisive questions, EVM, sub-judice court cases, centre-vs-state friction, cabinet expansion, future postings.
- Single canned response: *"देखिए भैया, इस विषय पर मैं टिप्पणी नहीं करूंगा। आइए आपके काम की बात करें।"*

### C. No new promises
- The bot can restate publicly-on-record positions only.
- New scheme / new date / new amount / new posting / new transfer — always: *"मैं नोट कर रहा हूं, अधिकारियों तक पहुंचा दी जाएगी।"*

### D. Crisis handoff (non-negotiable)
- Triggers: suicide, medical emergency, violence, imminent danger to life.
- Response: immediate **108 (ambulance)** and **112 (police)** referral. Do not hang up; do not delegate; do not philosophize.
- **Scope narrowly** to human life — don't fire on pet illnesses, civil complaints, or hypotheticals. We learned this the hard way.

### E. Recording notice
- If asked: acknowledge truthfully. *"जी, यह कॉल रिकॉर्ड हो रही है ताकि आपकी बात अधिकारियों तक सही पहुंचे।"*

### F. Opponents
- Institutional critique OK ("वंश परंपरा", "corruption legacy").
- Personal attacks banned.
- List specific people the bot must always refer to respectfully (e.g. predecessors).

### G. Shrewd-politician controversy playbook
Structure every hot-take answer as **Acknowledge → Reframe → Pivot**:
1. Acknowledge concern ("देखिए भैया, आपकी बात सही है कि...").
2. Reframe ("हम लगातार प्रयास कर रहे हैं कि...").
3. Pivot to a concrete delivery number ("लाडली बहना में 1.27 करोड़ बहनें...").

Never end an answer on a defensive beat.

---

## 12. Prompt versioning (never lose history)

**Every PATCH to the live agent must snapshot** both the outgoing prompt AND the current-live prompt into a versioned archive. Otherwise you will lose work.

### Pattern (from `update_agent.py`)

```python
def snapshot(label, agent_id, config, outgoing_prompt=None):
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H%M%SZ")
    live = config["conversation_config"]["agent"]["prompt"].get("prompt", "")
    content = f"""# Prompt snapshot — {label}

- captured_at_utc: {ts}
- agent_id: {agent_id}
- llm: ...
- rag: ...

## LIVE PROMPT
{live}

## OUTGOING PROMPT
{outgoing_prompt or '(no change in this run)'}
"""
    path = VERSIONS_DIR / f"{ts}_{label}.md"
    path.write_text(content, encoding="utf-8")
```

### Workflow
1. Before any PATCH: `snapshot("pre-update", ...)` — captures what's currently live.
2. PATCH prompt / KB / RAG.
3. After PATCH: `snapshot("post-update", ...)` — captures what's now live.
4. Commit the pair to git.

### Why this matters
- ElevenLabs has no built-in version history exposed via API.
- A bad PATCH can erase a week of prompt refinement.
- Rollback = read the most recent good snapshot, extract the `## LIVE PROMPT` block, PATCH it back.
- Git history + snapshots = reproducible agent state.

---

## 13. Observability — latency dashboard

You can't improve what you don't measure. Build a minimal internal dashboard.

### ElevenLabs API surface

- `GET /v1/convai/conversations?agent_id=...` — list of conversation summaries.
- `GET /v1/convai/conversations/{id}` — full turn-by-turn metrics.

### Metrics exposed per turn

| Field | Meaning |
|---|---|
| `conversation_turn_metrics.metrics.convai_llm_service_ttfb` | LLM time to first byte (the big one) |
| `convai_llm_service_ttf_sentence` | LLM time to first complete sentence |
| `convai_llm_service_tt_last_sentence` | End-of-generation time |
| `convai_tts_service_ttfb` | TTS first byte |
| `convai_asr_trailing_service_latency` | ASR settle time (user turns) |
| `rag_retrieval_info.rag_latency_secs` | RAG lookup time |
| `rag_retrieval_info.chunks[]` | Which chunks were retrieved |
| `llm_usage.model_usage.{model}.input.tokens` | Input tokens that turn |
| `llm_usage.model_usage.{model}.output_total.tokens` | Output tokens |
| `interrupted` | Whether user barged in |
| `metadata.cost` | Credits burned (top-level) |

### Dashboard views to build
- **Fleet KPIs:** total calls, avg LLM TTFB, avg TTS TTFB, avg RAG, total credits — top banner.
- **Call list:** per-call avg + p95 for each metric, color-coded (<1.5 s green, <2.5 s yellow, >2.5 s red).
- **Call detail:** per-turn rows with message preview + latency bars + token counts.
- **Config capture card:** LLM model, TTS model, RAG usage count, language — so you notice when production config drifts from what you pushed.

See `cm_voice_app/lib/elevenlabs.ts` + `cm_voice_app/app/dashboard/` for a ~200-line reference implementation.

---

## 14. Deploy pipeline

### Host: Netlify (Next.js plugin)

- `netlify.toml` with:
  ```toml
  [build]
    base = "cm_voice_app"
    command = "npm run build"
    publish = ".next"
  [[plugins]]
    package = "@netlify/plugin-nextjs"
  [build.environment]
    NODE_VERSION = "20"
  ```
- Secrets via `netlify env:set` or UI. **Never in git.**
- Security headers in toml: `X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: microphone=(self)`.

### Auto-deploy via GitHub Actions (not Netlify's native Git integration)

Why: Netlify's native Git integration needs the Netlify GitHub App installed via a browser OAuth dance. GitHub Actions with a Netlify PAT works headlessly.

```yaml
name: Deploy to Netlify
on:
  push:
    branches: [main]
  workflow_dispatch: {}
concurrency:
  group: netlify-deploy
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: cm_voice_app/package-lock.json
      - name: Install deps
        working-directory: cm_voice_app
        run: npm ci --prefer-offline --no-audit
      - name: Deploy
        run: |
          npx --yes netlify-cli@22 deploy \
            --build --prod \
            --site=${{ secrets.NETLIFY_SITE_ID }} \
            --auth=${{ secrets.NETLIFY_AUTH_TOKEN }}
```

### Common deploy gotchas
- Next.js in subfolder → set `base` in netlify.toml; `publish` is relative to base (use `".next"`, not `"cm_voice_app/.next"` in this context).
- `netlify deploy --build` does NOT auto-`npm install` in CI mode. Add an explicit `npm ci` step.
- Dev server lock on `.next/trace` breaks subsequent CLI deploys. Kill the dev process first.

### Environment variable checklist
```
VOICE_AGENT_ID       = agent_...
VOICE_API_KEY        = sk_...   (mark as secret in Netlify UI)
BASIC_AUTH_PASSWORD  = ""       (optional; set to gate the entire site)
```

Mirror these into GitHub Actions secrets:
```
NETLIFY_AUTH_TOKEN   (from ~/.netlify/Config/config.json user token)
NETLIFY_SITE_ID      (from netlify sites:create output)
```

---

## 15. Quickstart — building a new bot in a day

Assumes: ElevenLabs account, GitHub account, ~6 hours of focused work, source material about the persona.

### Hour 1 — Persona corpus
- Collect 5–10 hours of on-record interviews / speeches of the target persona.
- Auto-transcribe via `youtube-transcript-api` or Whisper. (See `scraper.py` as reference.)
- For each source: distil into a per-source intel brief (format, date, topics, signature quotes, personality markers, data points).
- Synthesise into `knowledge_base.md` (persona — ~40 KB) and `knowledge_base_ext.md` (facts + controversy + regional — ~80 KB).

### Hour 2 — Voice clone
- Record or source 2–5 minutes of clean audio samples of the persona (single speaker, ≥16kHz, no music).
- Create ElevenLabs Instant Voice Clone.
- Test a couple of Hindi/target-language sentences in the dashboard — check for mispronunciations. Refine samples if needed.

### Hour 3 — System prompt (v1)
- Copy the structure from `cm_voice_app/docs/elevenlabs_agent_prompt_cm.md`.
- Replace identity, personality, signature phrases, critical rules, first message.
- Target under 6,500 chars on first draft.

### Hour 4 — Agent creation + KB upload
- Run `setup_agent.py` (with your voice ID and token) — creates the agent, writes `.env.local`.
- Run `update_agent.py` — uploads both KB files, enables RAG with canonical tuning, sets `max_tokens: 300`, `speculative_turn: true`.

### Hour 5 — Frontend scaffold
- Copy the `cm_voice_app/` directory wholesale.
- Replace: portrait image, name in hero, color palette, copy in `page.tsx`.
- Update `app/layout.tsx` metadata.
- `npm install && npm run dev` — test locally.

### Hour 6 — Deploy + first test call
- Netlify: create site, set env vars, push to GitHub, watch Actions run.
- Make a test call. Watch the dashboard.
- Iterate: trim prompt if LLM TTFB >800 ms; tighten RAG if retrieval >700 ms; fix pronunciation via phonetic respells in KB.

### Day 2 — Polish
- Add controversy playbook entries as you discover weak spots.
- Snapshot each prompt change via `update_agent.py`.
- A/B TTS model (`eleven_turbo_v2_5` vs `eleven_flash_v2_5`).
- Decide on dashboard access (basic auth, separate URL, or internal team-only).

---

## 16. Checklist of canonical values

**ElevenLabs agent config:**
- [x] `llm: gemini-2.5-flash-lite`
- [x] `thinking_budget: 0`
- [x] `temperature: 0.5`
- [x] `max_tokens: 300`
- [x] `tts.model_id: eleven_turbo_v2_5`
- [x] `tts.stability: 0.45`, `similarity_boost: 0.85`, `style: 0.3`
- [x] `asr.quality: "high"`, `provider: "elevenlabs"`, `user_input_audio_format: "pcm_16000"`
- [x] `turn.turn_timeout: 7`
- [x] `turn.speculative_turn: true`
- [x] `turn.turn_eagerness: "normal"`
- [x] `conversation.max_duration_seconds: 600`
- [x] `platform_settings.call_limits.agent_concurrency_limit: -1`

**RAG config:**
- [x] `enabled: true`
- [x] `embedding_model: e5_mistral_7b_instruct`
- [x] `max_retrieved_rag_chunks_count: 6`
- [x] `max_documents_length: 8000`
- [x] `max_vector_distance: 0.5`

**System prompt:**
- [x] Under 7,000 chars
- [x] Rule 0 with absolute constraints
- [x] First-person identity paragraph
- [x] Personality / voice section with concrete markers
- [x] Signature phrases list (5–15 items)
- [x] Response length rule (proportional, hard cap)
- [x] Honesty-under-challenge template
- [x] Political firewall template
- [x] Crisis handoff scoped to human life only
- [x] 7-step conversation flow
- [x] TTS safety directives (if Indic)
- [x] First message in a separate block (also fed to `agent.first_message` field)

**Knowledge base:**
- [x] Two files: persona + extended
- [x] Uploaded as `type: file`, `usage_mode: auto`
- [x] Re-upload on every prompt change (embeddings stay fresh)
- [x] Each entry has: retrieval trigger, facts, bot-ready answer template

**Frontend:**
- [x] System fonts (no Google Fonts)
- [x] `<link rel="preload">` for hero image
- [x] No network calls on mount
- [x] Animations via transform/opacity only
- [x] Under 250 KB first-load JS
- [x] `connectionType: "webrtc"`
- [x] API key server-only via `/api/signed-url`

**Versioning:**
- [x] `docs/prompt_versions/` with pre- and post- snapshot for every PATCH
- [x] Snapshots include LLM, temp, first_message, RAG config, KB attachment list, full prompt text

**Deploy:**
- [x] Netlify with `@netlify/plugin-nextjs`
- [x] Secrets in env vars (never in git)
- [x] Security headers including `Permissions-Policy: microphone=(self)`
- [x] GitHub Actions auto-deploy on push to main
- [x] Concurrency group cancels in-flight runs

**Observability:**
- [x] Internal `/dashboard` surface with fleet KPIs + per-call drill-down
- [x] Per-turn metrics: LLM TTFB, TTS TTFB, RAG, tokens, cost
- [x] Config capture on each call detail (catches silent config drift)

---

## Appendix — Files to copy verbatim

These files from this repo drop into a new project with minimal edits:

```
cm_voice_app/app/api/signed-url/route.ts        # token handshake (rename paths only)
cm_voice_app/components/VoiceCall.tsx           # call UI (swap portrait + name)
cm_voice_app/middleware.ts                      # optional basic-auth gate
cm_voice_app/setup_agent.py                     # one-shot agent creation
cm_voice_app/update_agent.py                    # maintenance PATCH + snapshot
cm_voice_app/app/dashboard/page.tsx             # latency list view
cm_voice_app/app/dashboard/[id]/page.tsx        # per-call drill-down
cm_voice_app/app/api/metrics/conversations/     # dashboard API
cm_voice_app/lib/elevenlabs.ts                  # typed API helpers + aggregations
netlify.toml                                    # build + headers
.github/workflows/deploy-netlify.yml            # auto-deploy on push
set_gh_secret.py                                # libsodium-encrypt GitHub repo secrets via API
```

Files to rewrite per-bot:
```
cm_voice_app/docs/elevenlabs_agent_prompt_*.md  # system prompt (identity + rules)
knowledge_base.md                               # persona corpus
knowledge_base_ext.md                           # extended facts + controversy playbook
cm_voice_app/app/page.tsx                       # hero + name + portrait reference
cm_voice_app/app/layout.tsx                     # title + preload asset path
cm_voice_app/public/*.jpg                       # portrait
```

---

*End of blueprint. When in doubt: shorter prompt, leaner RAG, stricter rules, more KB. The bot speaks better when the scaffolding speaks less.*
