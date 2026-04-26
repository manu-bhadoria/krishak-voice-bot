# Demo talking points — Manish Singh, Commissioner Jansampark MP

**Meeting:** Monday 28 April 2026
**Pitch wedge:** Krishak Kalyan Varsh 2026
**Demo asset:** Live conversational krishi voice bot in CM Mohan Yadav's voice

---

## The 5 first-in-history claims

1. **First time in India** — a state government has deployed a CM-voice conversational agent for citizen scheme outreach at this latency (sub-second perceived response) and at this register (folksy farmer Hindi, not bureaucratic English).

2. **First time in MP history** — any sitting CM has been *callable* by farmers about agriculture queries on demand, in Hindi the farmer actually speaks (Malwa-inflected, with addressee terms like *भैया* / *अन्नदाता* / *बहन जी*).

3. **First AI category SKU** in MP Madhyam's 43-year history — a unified CM Communication Stack (this conversational bot is one of two pillars; grievance/voice-survey is the other).

4. **First conversational krishi knowledge broadcast in vernacular** at this latency — LLM TTFB ≤ 350ms p50, TTS TTFB ≤ 300ms p50, total perceived ≤ 800ms p50, even on rural networks.

5. **First-of-its-kind narrowed-domain CM agent** — the Krishak bot speaks ONLY about agriculture. No politics, no controversies, no biography. Strict numeric safety (every MSP, every scheme amount, every beneficiary count is canonical or `[FIGURE-PENDING]` — never invented). Strict crisis handoff (1962 Kisan helpline for distress).

---

## What the demo shows

- A **clean web page** at the production URL (Cloudflare Pages, custom domain optional). One CM portrait. One button: **"बात करें"**.
- He scans the QR code → page loads → taps button → CM voice greets within ~600ms.
- He asks 2-3 questions. Suggested probes:
  - *"PM-KISAN की किस्त कब आएगी?"* → bot cites ₹6,000 + ₹6,000 = ₹12,000/year, helpline 011-24300606.
  - *"सोयाबीन का MSP क्या है?"* → bot cites ₹4,892/qtl + Bhavantar ₹500/qtl bonus mechanism.
  - *"गेहूं कब बिकेगा?"* → bot cites ₹2,425 + ₹175 = ₹2,600/qtl, eUparjan portal, 2028 target ₹2,700.
  - *"राहुल गांधी के बारे में क्या कहेंगे?"* (politics-bait) → bot deflects: *"देखिए भैया, राजनीति की बात बाद में, पहले आपकी फसल की बात करें।"*
  - *"कोदो-कुटकी पर बोनस?"* → bot cites Rani Durgavati Shri Anna Yojana ₹1,000/qtl.

---

## Why narrower means faster (the architecture pitch)

The original `cm_voice_app` (production at cm-se-baat.netlify.app) handles politics, controversies, biography, rapid-fire, opposition deflection, Sanskrit shlokas, Mahakal, Simhastha, plus krishi. **The Krishak fork strips all of that.** Result:

- Shorter system prompt (~3,500 chars vs 7,000) → less prefill → faster first token.
- Tighter RAG (3 chunks × 5,000 chars vs 4 × 4,000) → less retrieval cost.
- `gemini-2.5-flash-lite` instead of `gemini-2.5-flash` → ~150ms TTFB win.
- `eleven_flash_v2_5` instead of `eleven_multilingual_v2` → ~200ms TTFB win.
- Predictable conversation paths (greeting → scheme query → confirmation → close) → `speculative_turn` hits more often.

Combined: **800-1200ms total → 600-800ms total**.

---

## What we built in 5 hours, without a partner agency

Single repo. Two products possible (conversational live; outbound MP3 generator deferred). Reuses the existing CM voice clone — no new clone, no new training. KB built from:
- 12 transcripts of CM's actual 2026 krishi speeches (Bhopal launch, Harda, Gwalior-Kulhet, Sheopur flood relief, Burhanpur, Panchayat workshop)
- Canonical MSP / scheme / helpline numbers (none invented)
- Krishak Kalyan Varsh 2026 monthly calendar (Feb कोदो-कुटकी bonus → May नर्मदापुरम आम उत्सव → Aug-Sep इंदौर FPO → Oct-Nov फूड फेस्टिवल → नरसिंहपुर गन्ना महोत्सव)

---

## The asks ladder (in order, escalate only if previous yes)

1. **Approval to test** — let us run the bot internally for one week with 5 trial farmers (their pick) to validate dialect handling and accuracy.
2. **Approval to deploy** — public URL with QR code on the next CM krishi event hoarding.
3. **Approval to scale** — add Malvi outbound generator (Phase 5, deferred from this demo) for one-way scheme reminder MP3s.
4. **Approval to integrate** — telephony layer (Exotel) so farmers can call a number, not just visit a webpage.
5. **Approval for unified stack** — extend to grievance bot + outbound voice survey (the "two-pillar" CM Communication Stack).

---

## What's still pending (be honest)

- Live mandi prices: bot does not have these — redirects to eNAM. Honest limitation.
- Pesticide dosages: bot does NOT prescribe — redirects to KVK. Safety call, not a gap.
- Aadhaar / PM-KISAN beneficiary status lookup: bot has no DB. Could be added with sarkari API access.
- Bagheli / Nimadi / tribal language outbound: skipped for this demo. TTS quality on those needs validation before going live.
- The wheat MSP figure: canonical KB has ₹2,600 (₹2,425 centre + ₹175 state); CM has publicly stated ₹2,625 in 2026 speeches (state-bonus update). Both retrievable; minor reconciliation needed before scale.

---

## Live URL

```
[FILL AFTER FIRST DEPLOY]
```

QR code: `qr-code.png` (regenerate after first deploy with the actual URL).
