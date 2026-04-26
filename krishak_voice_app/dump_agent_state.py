#!/usr/bin/env python3
"""Dump the full ElevenLabs agent + voice + knowledge-base + conversation
state to docs/elevenlabs_state/ for repo-side auditability.

Usage:
    XI_API_KEY=sk_... python dump_agent_state.py

What it writes:
    docs/elevenlabs_state/agent.json               — full agent config
    docs/elevenlabs_state/voice.json               — voice config (CM clone)
    docs/elevenlabs_state/knowledge_base.json      — KB docs list (metadata)
    docs/elevenlabs_state/conversations.json       — list (summaries, 50 most recent)
    docs/elevenlabs_state/conversations/<id>.json  — full per-call transcript + metrics
    docs/elevenlabs_state/README.md                — index with capture timestamp

Safe to re-run; overwrites previous dumps. Does NOT include the XI_API_KEY
or any secret in the output — only public agent/voice/conversation state.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env.local"
OUT_DIR = ROOT / "docs" / "elevenlabs_state"
CONV_DIR = OUT_DIR / "conversations"

CONVERSATION_LIMIT = 50  # fetch this many recent calls


def load_env() -> dict:
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def http_get(url: str, api_key: str) -> dict:
    req = urllib.request.Request(url, headers={"xi-api-key": api_key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} on {url}: {body[:300]}", file=sys.stderr)
        return {"_error": {"code": e.code, "body": body}}


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> {path.relative_to(ROOT.parent)} ({path.stat().st_size:,} B)")


def main() -> int:
    env = load_env()
    api_key = os.environ.get("XI_API_KEY") or env.get("VOICE_API_KEY")
    agent_id = env.get("VOICE_AGENT_ID")
    if not api_key or not agent_id:
        print("ERROR: need XI_API_KEY/VOICE_API_KEY and VOICE_AGENT_ID", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CONV_DIR.mkdir(parents=True, exist_ok=True)

    captured_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"[{captured_at}] dumping ElevenLabs state for agent {agent_id}")

    # 1. Agent config
    print("\n[1/5] agent config")
    agent = http_get(f"https://api.elevenlabs.io/v1/convai/agents/{agent_id}", api_key)
    write_json(OUT_DIR / "agent.json", agent)

    # 2. Voice config (pull voice_id out of agent config)
    print("\n[2/5] voice config")
    voice_id = (
        agent.get("conversation_config", {})
        .get("tts", {})
        .get("voice_id")
    )
    if voice_id:
        voice = http_get(f"https://api.elevenlabs.io/v1/voices/{voice_id}", api_key)
        write_json(OUT_DIR / "voice.json", voice)
    else:
        print("  (no voice_id found in agent config)")

    # 3. Knowledge-base docs list (metadata)
    print("\n[3/5] knowledge base docs")
    kb = http_get(f"https://api.elevenlabs.io/v1/convai/knowledge-base?page_size=100", api_key)
    write_json(OUT_DIR / "knowledge_base.json", kb)

    # 4. Conversation list (most recent N)
    print(f"\n[4/5] conversations list (most recent {CONVERSATION_LIMIT})")
    convos = http_get(
        f"https://api.elevenlabs.io/v1/convai/conversations?agent_id={agent_id}&page_size={CONVERSATION_LIMIT}",
        api_key,
    )
    write_json(OUT_DIR / "conversations.json", convos)

    conv_list = (convos.get("conversations") or []) if isinstance(convos, dict) else []
    print(f"  found {len(conv_list)} conversations")

    # 5. Per-conversation full transcript + metrics
    print(f"\n[5/5] per-conversation detail")
    for c in conv_list:
        cid = c.get("conversation_id")
        if not cid:
            continue
        detail = http_get(
            f"https://api.elevenlabs.io/v1/convai/conversations/{cid}",
            api_key,
        )
        write_json(CONV_DIR / f"{cid}.json", detail)

    # 6. Write a README index
    readme = OUT_DIR / "README.md"
    readme_content = f"""# ElevenLabs live state dump

- **captured_at_utc:** {captured_at}
- **agent_id:** `{agent_id}`
- **voice_id:** `{voice_id}`
- **conversations dumped:** {len(conv_list)}

## Files

| Path | Contents |
|---|---|
| `agent.json` | Full `GET /v1/convai/agents/{{id}}` — prompt, LLM/TTS/RAG/turn/ASR config, KB attachments, platform settings |
| `voice.json` | Full `GET /v1/voices/{{id}}` — voice clone metadata, `high_quality_base_model_ids`, preview URL |
| `knowledge_base.json` | Workspace-wide KB docs (metadata; file contents not included) |
| `conversations.json` | List of the {CONVERSATION_LIMIT} most recent conversations (summaries) |
| `conversations/<id>.json` | Per-call full transcript + turn-level LLM/TTS/RAG metrics |

## Refresh

```bash
XI_API_KEY=sk_... python cm_voice_app/dump_agent_state.py
```

Idempotent; overwrites previous dumps. Does not include the API key in output.
"""
    readme.write_text(readme_content, encoding="utf-8")
    print(f"\n  -> {readme.relative_to(ROOT.parent)}")

    print(f"\n[done] state dumped to {OUT_DIR.relative_to(ROOT.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
