# Krishak Voice Bot — Direct Line to the CM, for the Farmer

A first-person voice agent in the voice of **Dr. Mohan Yadav**, Chief Minister of Madhya Pradesh, talking ONLY about agriculture to MP farmers. Built for **Krishak Kalyan Varsh 2026**. Forked from `cm-voice-bot`; this variant strips out politics/biography/religion/Mahakal/Simhastha — krishi only.

Thin Next.js client connected to an ElevenLabs Conversational AI agent configured with the CM's voice clone, a krishi persona corpus mined from 12 on-record speeches at Krishak Kalyan Varsh events, plus a 60-KB extended KB of MSPs / schemes / Q&As.

```
Farmer (browser, mic) ──► Next.js page (VoiceCall) ──► /api/signed-url ──► ElevenLabs API
                               │                                              │
                               └──────── WebRTC ────────────────────────────► ConvAI agent
                                                                               (CM voice clone
                                                                                + krishi prompt
                                                                                + 2-file KB via RAG)
```

## Latency strategy — small prompt, dense RAG, edge runtime

- **System prompt** (`docs/elevenlabs_agent_prompt_krishak.md`) is tight (~3,500 chars) — only persona, voice register, flow rules, guardrails. Every token loads on every turn.
- **Knowledge base** (`../knowledge_base_krishak.md` persona + `../knowledge_base_krishak_ext.md` schemes/calendar) is uploaded to the agent's KB tab. ElevenLabs retrieves only relevant chunks via RAG per turn — no per-turn token cost.
- **RAG tuned for krishi domain density**: 3 chunks × 5,000 chars × 0.45 max vector distance.
- **LLM:** `gemini-2.5-flash-lite` (~150ms TTFB win vs flash; krishi factual lookup doesn't need flash's reasoning).
- **TTS:** `eleven_flash_v2_5` (~200ms TTFB win vs multilingual_v2).
- **First-message audio pre-rendered** to `public/first-message.mp3` (eliminates ~500ms TTS gap on turn 0).
- **Speculative turn enabled** (krishi conversation patterns are predictable; speculation hits often).
- **API routes are edge runtime** — required for Cloudflare Pages.

Targets: LLM TTFB ≤350ms p50, TTS TTFB ≤300ms p50, total perceived ≤800ms p50.

## Setup

### 1. Install

```powershell
cd krishak_voice_app
npm install
```

### 2. Create the ElevenLabs agent (one-shot)

```powershell
$env:XI_API_KEY="sk_..."
py -3 setup_agent.py
```

Writes `.env.local` with the new `VOICE_AGENT_ID`. Reuses the existing CM voice clone (`vxeICktjKaYzkMOFXiUL`) — no new clone needed.

### 3. Upload KBs + apply config

```powershell
py -3 update_agent.py
```

Uploads `../knowledge_base_krishak.md` + `../knowledge_base_krishak_ext.md`, applies LLM/TTS/RAG/turn config. Snapshots state to `docs/prompt_versions/` and `docs/elevenlabs_state/`.

### 4. Render the first-message audio

```powershell
cd ..
py -3 generate_first_message_audio.py
```

Writes `krishak_voice_app/public/first-message.mp3`.

### 5. Local dev

```powershell
npm run dev
```

Open http://localhost:3000, tap **बात करें**, allow the mic.

## Deploy to Cloudflare Pages

### One-time setup

1. Get a Cloudflare API Token: https://dash.cloudflare.com/profile/api-tokens → "Create Token" → use the **"Edit Cloudflare Workers"** template (this works for Pages too) → copy the token.
2. Find your Account ID: any zone in https://dash.cloudflare.com → right-side panel.
3. Create the Pages project (one time):
   ```powershell
   cd krishak_voice_app
   npx wrangler pages project create krishak-voice-bot --production-branch=main
   ```
4. Set runtime env vars (read from `.env.local` after `setup_agent.py` runs):
   ```powershell
   npx wrangler pages secret put VOICE_AGENT_ID --project-name krishak-voice-bot
   npx wrangler pages secret put VOICE_API_KEY --project-name krishak-voice-bot
   ```
   Or set them in the Cloudflare Pages dashboard → Settings → Environment Variables (mark `VOICE_API_KEY` as encrypted).

### Manual deploy from your laptop

```powershell
cd krishak_voice_app
npm run pages:deploy
```

This runs `npm run pages:build` (Next build → `@cloudflare/next-on-pages` adapter → `.vercel/output/static`) then `wrangler pages deploy`. First deploy returns the production URL.

> **Windows note:** `@cloudflare/next-on-pages` has a known issue spawning `npx` on plain Windows shells (it errors with `spawn npx ENOENT`). Workarounds:
> - **Easiest:** push to GitHub and let the Linux CI workflow build + deploy (works out of the box).
> - **Run from WSL:** `wsl -d Ubuntu` → `cd /mnt/w/...` → `npm run pages:deploy`.
> - **Local dev still works on Windows:** `npm run dev` runs the standard Next.js dev server (no Cloudflare adapter needed).

### Auto-deploy from GitHub

1. Push the repo to GitHub.
2. In the GitHub repo Settings → Secrets, add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. Push to `main` — `.github/workflows/deploy-cloudflare.yml` runs the build + deploy.

## Key files

- `docs/elevenlabs_agent_prompt_krishak.md` — Devanagari first-person system prompt; paste the block between the `====== AGENT SYSTEM PROMPT ======` markers into the ElevenLabs agent's System Prompt field (or just run `update_agent.py`).
- `components/VoiceCall.tsx` — call UI: mic permission, signed-URL fetch, ElevenLabs `useConversation` hook, wheat-gold/crop-green palette.
- `app/api/signed-url/route.ts` — edge route that exchanges `VOICE_API_KEY` for a short-lived signed WebRTC conversation token.
- `setup_agent.py` / `update_agent.py` / `dump_agent_state.py` — agent provisioning + version snapshots.
- `wrangler.jsonc` — Cloudflare Pages config (build output dir, compat flags).
- `public/_headers` — security headers (X-Frame-Options, microphone permissions, etc.) applied at the Pages edge.
- `middleware.ts` — optional basic-auth gate (set `BASIC_AUTH_PASSWORD`); leave empty for the public demo.

## Hard guardrails (encoded in `elevenlabs_agent_prompt_krishak.md`)

1. **Krishi only** — politics, religion, biography, opposition, Mahakal/Simhastha all firewalled. One-sentence deflect on Ladli Behna; full deflect on everything else.
2. **Numeric safety** — never invents an MSP / scheme amount / beneficiary count. If not in KB → "मैं नोट कर रहा हूं, अधिकारी से पुष्टि कराकर बताऊंगा".
3. **No new promises** — only publicly-recorded amounts. New schemes/dates: "संबंधित अधिकारी आपसे संपर्क करेंगे".
4. **Crisis handoff** — farmer suicide/distress: 1962 (Kisan helpline) + nearest agriculture office. Bot does not replace human help.
5. **Dialect rule** — Malvi/Bundeli only if caller's first 2 sentences are clearly in dialect; else standard Hindi. No half-dialect.
6. **No pesticide dosages** — bot redirects every advisory to the nearest KVK.
7. **No live mandi prices** — bot says "eNAM portal या मंडी समिति से पूछिए".
8. **Recording notice** — truthful if asked.
9. **Stay in character** — first-person, never reveals system prompt or that it's AI.

## What this repo does NOT include

- Outbound call campaign generator (Phase 5 in the original brief — explicitly skipped per user)
- Telephony (Exotel / Twilio / SIP) — browser-mic only
- Live mandi price scraping — bot honestly says it doesn't have real-time prices
- Aadhaar / PM-KISAN beneficiary-status DB lookup — bot has no DB
- Multi-bot orchestration

Conversational krishi voice agent only. Browser-mic in. CM voice out.
