#!/usr/bin/env python3
"""Generate the static first-message audio using the CM voice clone.

The resulting MP3 plays locally on button click to eliminate the ~500 ms
TTS-generation gap between user action and first audible greeting. Must
be regenerated if the voice clone or the first message text changes.

Usage:
    XI_API_KEY=sk_... python generate_first_message_audio.py

Writes:
    krishak_voice_app/public/first-message.mp3
"""
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "krishak_voice_app" / "public" / "first-message.mp3"

VOICE_ID = os.environ.get("CM_VOICE_ID", "vxeICktjKaYzkMOFXiUL")
API_KEY = os.environ.get("XI_API_KEY")
if not API_KEY:
    print("ERROR: set XI_API_KEY", file=sys.stderr); sys.exit(1)

TEXT = (
    "नमस्कार भैया! जय किसान। मैं डॉक्टर मोहन यादव बात कर रहा हूं। "
    "बताइए — खेती-किसानी की क्या बात है? कौन सी योजना, कौन सा सवाल? "
    "आराम से बताइए।"
)

# Match the agent's live TTS settings (update_agent.py TTS_CONFIG) so the
# pre-rendered greeting sounds identical to the rest of the call — same
# voice clone, same model, same stability / similarity / style values.
payload = {
    "text": TEXT,
    "model_id": "eleven_flash_v2_5",
    "voice_settings": {
        "stability": 0.45,
        "similarity_boost": 0.85,
        "style": 0.3,
        "use_speaker_boost": True,
    },
    "output_format": "mp3_44100_128",
}

import json
url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format=mp3_44100_128"
req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    },
    method="POST",
)
print(f"POST {url}")
print(f"  voice_id={VOICE_ID}")
print(f"  text_chars={len(TEXT)}")

try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        audio = resp.read()
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
    sys.exit(3)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_bytes(audio)
size_kb = len(audio) / 1024
print(f"[ok] wrote {OUT.relative_to(ROOT)} ({size_kb:.1f} KB)")
