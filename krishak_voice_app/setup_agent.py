#!/usr/bin/env python3
"""Create / update the ElevenLabs ConvAI agent for the Krishak Voice Bot.

Usage:
    XI_API_KEY=sk_... python setup_agent.py

Reads the system prompt from docs/elevenlabs_agent_prompt_krishak.md (the
block between the AGENT SYSTEM PROMPT markers), creates the agent via the
ElevenLabs API, attaches the CM voice clone, and writes .env.local with the
resulting agent id.

The two krishi knowledge base files (knowledge_base_krishak.md persona +
knowledge_base_krishak_ext.md schemes/Q&A at project root) are NOT loaded into
the system prompt — update_agent.py uploads them to the agent's Knowledge
Base tab so they are retrieved via RAG (no per-turn token cost, no latency
impact).
"""
import json
import os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent
PROMPT_FILE = ROOT / "docs" / "elevenlabs_agent_prompt_krishak.md"
ENV_FILE = ROOT / ".env.local"

# CM voice clone already provisioned in ElevenLabs — reused as-is for krishak.
VOICE_ID = os.environ.get("CM_VOICE_ID", "vxeICktjKaYzkMOFXiUL")
AGENT_NAME = "Krishak Voice Bot — Dr. Mohan Yadav (Hindi)"
FIRST_MESSAGE = "नमस्कार भैया! जय किसान। मैं डॉक्टर मोहन यादव बात कर रहा हूं। बताइए — खेती-किसानी की क्या बात है? कौन सी योजना, कौन सा सवाल? आराम से बताइए।"
LANGUAGE = "hi"

API_KEY = os.environ.get("XI_API_KEY")
if not API_KEY:
    print("ERROR: set XI_API_KEY env var", file=sys.stderr)
    sys.exit(1)

# ---- extract the system prompt block ----
md = PROMPT_FILE.read_text(encoding="utf-8")
m = re.search(
    r"=+ AGENT SYSTEM PROMPT \(paste below into ElevenLabs\) =+\s*(.*?)\s*=+ END OF AGENT SYSTEM PROMPT =+",
    md, re.S,
)
if not m:
    print(f"ERROR: could not locate AGENT SYSTEM PROMPT block in {PROMPT_FILE}", file=sys.stderr)
    sys.exit(2)
system_prompt = m.group(1).strip()
print(f"Loaded system prompt: {len(system_prompt)} chars")

# ---- ConvAI agent config ----
# llm: gemini-2.5-flash-lite — narrower krishi domain doesn't need flash's
# reasoning headroom; flash-lite shaves ~150ms TTFB vs flash.
# tts: eleven_flash_v2_5 — lowest-latency Hindi-capable model; saves ~200ms
# vs multilingual_v2. update_agent.py reapplies these every push.
# stability 0.45 + similarity 0.85 + style 0.3 = warm but stable voice.
payload = {
    "name": AGENT_NAME,
    "conversation_config": {
        "agent": {
            "prompt": {
                "prompt": system_prompt,
                "llm": "gemini-2.5-flash-lite",
                "temperature": 0.5,
            },
            "first_message": FIRST_MESSAGE,
            "language": LANGUAGE,
        },
        "tts": {
            "voice_id": VOICE_ID,
            "model_id": "eleven_flash_v2_5",
            "stability": 0.45,
            "similarity_boost": 0.85,
            "style": 0.3,
            "use_speaker_boost": True,
        },
        "asr": {
            "quality": "high",
            "provider": "elevenlabs",
            "user_input_audio_format": "pcm_16000",
        },
        "turn": {"turn_timeout": 7},
        "conversation": {"max_duration_seconds": 600},
    },
    "platform_settings": {
        "call_limits": {"agent_concurrency_limit": -1, "daily_limit_per_agent": -1},
    },
}

url = "https://api.elevenlabs.io/v1/convai/agents/create"
data = json.dumps(payload).encode("utf-8")
req = urllib.request.Request(
    url,
    data=data,
    headers={"xi-api-key": API_KEY, "Content-Type": "application/json"},
    method="POST",
)
print(f"POST {url}")
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
        result = json.loads(body)
except urllib.error.HTTPError as e:
    err_body = e.read().decode("utf-8", errors="replace")
    print(f"HTTP {e.code} {e.reason}", file=sys.stderr)
    print(err_body, file=sys.stderr)
    sys.exit(3)

print("Response:", json.dumps(result, ensure_ascii=False, indent=2)[:800])

agent_id = result.get("agent_id") or result.get("id")
if not agent_id:
    print("ERROR: no agent_id in response", file=sys.stderr)
    sys.exit(4)
print(f"\n[ok] Agent created: {agent_id}")

env_lines = [
    f'VOICE_AGENT_ID="{agent_id}"',
    f'VOICE_API_KEY="{API_KEY}"',
    'BASIC_AUTH_PASSWORD=""',
]
ENV_FILE.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
print(f"[ok] Wrote {ENV_FILE}")
print("\nNext step: run `python update_agent.py` to upload knowledge_base_krishak.md +")
print("knowledge_base_krishak_ext.md, apply RAG tuning, set TTS+turn config.")
