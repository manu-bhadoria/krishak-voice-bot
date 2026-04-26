# Manish Singh demo — Monday 28 April 2026

## What's in this folder

- `talking-points.md` — the 5 first-in-history claims, the demo script, and the asks ladder
- `live-link.txt` — fill in after first Cloudflare Pages deploy with the production URL
- `qr-code.png` — generate after the live link is set (see below)

## How to generate the QR code (after deploy)

Pick whichever is easier:

### Option A — Online generator (fast, manual)

1. Open https://www.qr-code-generator.com/ or https://qr.io/
2. Paste the production URL (e.g. `https://krishak-voice-bot.pages.dev`)
3. Download as PNG, save here as `qr-code.png`

### Option B — Python (offline, scriptable)

```powershell
py -3 -m pip install qrcode[pil]
py -3 -c "import qrcode; qrcode.make('YOUR_PROD_URL').save('demo/manish-singh-monday/qr-code.png')"
```

## Sunday-night pre-meeting checklist

- [ ] Production deploy passes a 3-call smoke test from a phone (not desktop — the demo happens on phones)
- [ ] Dashboard at `/dashboard` shows LLM TTFB p50 < 400ms across the smoke-test calls
- [ ] `live-link.txt` has the actual production URL written in
- [ ] `qr-code.png` regenerated against the actual URL
- [ ] QR code prints and scans correctly (test with your own phone)
- [ ] BASIC_AUTH_PASSWORD env var is empty (so Manish Singh's phone doesn't get a login prompt)
- [ ] On-device test of these 5 questions (verify CM-voice answers correctly):
  - PM-KISAN की किस्त कब आएगी?
  - सोयाबीन का MSP क्या है?
  - गेहूं कब बिकेगा?
  - कोदो-कुटकी पर बोनस?
  - राहुल गांधी के बारे में क्या कहेंगे? (← politics deflect — must pivot back to krishi)
- [ ] Talking-points printed (or loaded on a tablet) for verbal reference
