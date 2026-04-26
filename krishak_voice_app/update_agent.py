#!/usr/bin/env python3
"""Patch the live ElevenLabs agent with the current system prompt + KB + RAG
tuning. Auto-snapshots BOTH the outgoing prompt AND the current-live prompt to
prompt_versions/ before each PATCH — no prompt is ever lost.

Usage:
    XI_API_KEY=sk_... python update_agent.py [--skip-kb] [--rag-only]
"""
import argparse
import datetime
import json
import mimetypes
import os
import re
import sys
import uuid
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent
PROJECT_ROOT = ROOT.parent
PROMPT_FILE = ROOT / "docs" / "elevenlabs_agent_prompt_krishak.md"
VERSIONS_DIR = ROOT / "docs" / "prompt_versions"
ENV_FILE = ROOT / ".env.local"

FIRST_MESSAGE = "नमस्कार भैया! जय किसान। मैं डॉक्टर मोहन यादव बात कर रहा हूं। बताइए — खेती-किसानी की क्या बात है? कौन सी योजना, कौन सा सवाल? आराम से बताइए।"

# RAG tuning — krishi domain is denser per square cm than cm_voice_app's
# politics+religion+biography surface, so 3 chunks at 5000 chars each is
# plenty. Tighter vector distance (0.45) keeps weak retrievals out — the
# numeric-safety rule is unforgiving.
RAG_CONFIG = {
    "enabled": True,
    "max_retrieved_rag_chunks_count": 3,    # krishi domain is dense
    "max_documents_length": 5000,            # cover full scheme entries
    "max_vector_distance": 0.45,             # tighter match for numeric safety
    "embedding_model": "e5_mistral_7b_instruct",
}

# Output-side: unbounded. Prompt's own 5-sentence cap governs length. 800
# is a ceiling well above 5 spelled-out Hindi sentences (numeric-safe form
# is longer than digit form on Devanagari tokenizer).
LLM_MAX_OUTPUT_TOKENS = 800

# LLM: gemini-2.5-flash-lite. Krishi factual lookup with structured RAG
# doesn't need flash's reasoning headroom; flash-lite shaves ~150ms TTFB.
# Build constraint: do not change provider/family.
LLM_MODEL = "gemini-2.5-flash-lite"
LLM_TEMPERATURE = 0.5

# TTS: eleven_flash_v2_5 — lowest-latency Hindi-capable model; ~200ms TTFB
# saved vs multilingual_v2. Voice 'vxeICktjKaYzkMOFXiUL' is an IVC clone;
# stability/similarity tuned for warm-but-stable Hindi delivery.
TTS_CONFIG = {
    "model_id": "eleven_flash_v2_5",
    "stability": 0.45,
    "similarity_boost": 0.85,
    "style": 0.3,
    "use_speaker_boost": True,
}

# Turn-detection: speculative_turn lets the agent begin generating a candidate
# response while the user is still speaking. When the user finishes, the agent
# replays the already-generated response instantly. Biggest perceived-latency
# win. turn_timeout stays at 7s so thoughtful pauses don't get cut off.
TURN_CONFIG = {
    "speculative_turn": True,   # was False
    "turn_eagerness": "normal", # kept normal — aggressive cuts mid-thought
    "turn_timeout": 7.0,        # kept — safe
}


def load_env() -> dict:
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_prompt() -> str:
    md = PROMPT_FILE.read_text(encoding="utf-8")
    m = re.search(
        r"=+ AGENT SYSTEM PROMPT \(paste below into ElevenLabs\) =+\s*(.*?)\s*=+ END OF AGENT SYSTEM PROMPT =+",
        md, re.S,
    )
    if not m:
        raise RuntimeError(f"Couldn't locate AGENT SYSTEM PROMPT block in {PROMPT_FILE}")
    return m.group(1).strip()


def http_get(url: str, api_key: str) -> dict:
    req = urllib.request.Request(url, headers={"xi-api-key": api_key})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_patch(url: str, api_key: str, payload: dict, label: str):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
        print(f"[ok] {label}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} on {label}: {body}", file=sys.stderr)
        sys.exit(4)


def snapshot(label: str, agent_id: str, config: dict, outgoing_prompt: str | None = None) -> None:
    """Save a timestamped snapshot: both a human-readable .md (prompt + meta)
    and the full agent JSON (.json) so we keep a complete, replayable record
    of every config change."""
    VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H%M%SZ")
    agent = config["conversation_config"]["agent"]
    p = agent.get("prompt", {}) or {}
    live_prompt = p.get("prompt", "")

    # Full-config JSON — the complete GET /v1/convai/agents/{id} response,
    # timestamped, never overwritten. This is the source of truth for "what
    # did the agent look like at time T?"
    json_path = VERSIONS_DIR / f"{ts}_{label.replace(' ', '_').replace('/', '-')}.json"
    json_path.write_text(
        json.dumps(config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[snapshot] {json_path.relative_to(PROJECT_ROOT)}")

    content = f"""# Prompt snapshot — {label}

- captured_at_utc: {ts}
- agent_id: {agent_id}
- label: {label}
- llm: {p.get("llm")}
- temperature: {p.get("temperature")}
- first_message: {agent.get("first_message", "")}
- language: {agent.get("language")}
- live_prompt_chars: {len(live_prompt)}
- outgoing_prompt_chars: {len(outgoing_prompt) if outgoing_prompt else 'n/a'}
- knowledge_base_docs: {len(p.get("knowledge_base", []))}
- rag: {json.dumps(p.get("rag"), ensure_ascii=False)}

---

## LIVE PROMPT (what is currently deployed)

{live_prompt}

---

## OUTGOING PROMPT (what this run is about to PATCH — if any)

{outgoing_prompt if outgoing_prompt else '(no prompt change in this run)'}
"""
    path = VERSIONS_DIR / f"{ts}_{label.replace(' ', '_').replace('/', '-')}.md"
    path.write_text(content, encoding="utf-8")
    print(f"[snapshot] {path.relative_to(PROJECT_ROOT)}")


def upload_kb_file(api_key: str, path: Path) -> str:
    boundary = f"----kb{uuid.uuid4().hex}"
    content = path.read_bytes()
    filename = path.name
    mime = mimetypes.guess_type(str(path))[0] or "text/markdown"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="name"\r\n\r\n{filename}\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/convai/knowledge-base/file",
        data=body,
        headers={
            "xi-api-key": api_key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    doc_id = result.get("id") or result.get("document_id")
    print(f"  uploaded {filename} -> {doc_id}")
    return doc_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-kb", action="store_true", help="Don't re-upload KB files")
    parser.add_argument("--rag-only", action="store_true", help="Only PATCH RAG tuning, skip prompt + KB")
    parser.add_argument("--snapshot-only", action="store_true",
                        help="Capture full agent JSON snapshot + refresh elevenlabs_state/ without PATCHing")
    args = parser.parse_args()

    env = load_env()
    api_key = os.environ.get("XI_API_KEY") or env.get("VOICE_API_KEY")
    agent_id = env.get("VOICE_AGENT_ID")
    if not api_key or not agent_id:
        print("ERROR: need XI_API_KEY/VOICE_API_KEY and VOICE_AGENT_ID", file=sys.stderr)
        return 1

    agent_url = f"https://api.elevenlabs.io/v1/convai/agents/{agent_id}"

    # Always snapshot the live prompt BEFORE any change
    outgoing_prompt = None if (args.rag_only or args.snapshot_only) else load_prompt()
    live = http_get(agent_url, api_key)
    snapshot("pre-update" if not args.snapshot_only else "snapshot-only", agent_id, live, outgoing_prompt)

    if args.snapshot_only:
        print("\n[mode] snapshot-only — no PATCH performed")
    elif args.rag_only:
        print(f"\n[mode] rag-only")
        http_patch(
            agent_url, api_key,
            {
                "conversation_config": {
                    "agent": {"prompt": {"rag": RAG_CONFIG}}
                }
            },
            "rag_config"
        )
    else:
        print(f"\nLoaded prompt: {len(outgoing_prompt)} chars")

        # Step 1: PATCH prompt + first_message + language + output-token cap + LLM model
        print("\nPATCHing first_message + system prompt + language + max_tokens + llm model...")
        http_patch(
            agent_url, api_key,
            {
                "conversation_config": {
                    "agent": {
                        "prompt": {
                            "prompt": outgoing_prompt,
                            "max_tokens": LLM_MAX_OUTPUT_TOKENS,
                            "llm": LLM_MODEL,
                            "temperature": LLM_TEMPERATURE,
                        },
                        "first_message": FIRST_MESSAGE,
                        "language": "hi",
                    }
                }
            },
            "prompt+first_message+max_tokens+llm"
        )

        # Step 1b: turn-detection tuning (speculative_turn, eagerness, timeout)
        print("\nPATCHing turn config (speculative_turn, eagerness, timeout)...")
        http_patch(
            agent_url, api_key,
            {"conversation_config": {"turn": TURN_CONFIG}},
            "turn_config"
        )

        # Step 1c: TTS model + voice retune for multilingual_v2
        print("\nPATCHing tts config (model_id + stability/similarity/style)...")
        http_patch(
            agent_url, api_key,
            {"conversation_config": {"tts": TTS_CONFIG}},
            "tts_config"
        )

        # Step 2: Re-upload KB (if requested)
        kb_entries = None
        if not args.skip_kb:
            print("\nRe-uploading KB files...")
            doc_ids = []
            for fp in [PROJECT_ROOT / "knowledge_base_krishak.md", PROJECT_ROOT / "knowledge_base_krishak_ext.md"]:
                if fp.exists():
                    doc_ids.append(upload_kb_file(api_key, fp))
            kb_entries = [
                {"type": "file", "id": d, "name": f"kb_{i}", "usage_mode": "auto"}
                for i, d in enumerate(doc_ids)
            ]

        # Step 3: PATCH KB attachments + RAG config together
        print("\nPATCHing knowledge_base + RAG tuning...")
        kb_payload = {"rag": RAG_CONFIG}
        if kb_entries is not None:
            kb_payload["knowledge_base"] = kb_entries
        http_patch(
            agent_url, api_key,
            {"conversation_config": {"agent": {"prompt": kb_payload}}},
            "knowledge_base+rag"
        )

    # Final: snapshot the post-update live state (skip re-fetch in snapshot-only)
    if not args.snapshot_only:
        live_after = http_get(agent_url, api_key)
        snapshot("post-update", agent_id, live_after)

    # Also refresh docs/elevenlabs_state/ so the repo always has the full
    # live config dumped alongside the prompt-only snapshot. This runs
    # dump_agent_state.py as a subprocess so a failure here doesn't mask
    # a successful PATCH above.
    print("\nRefreshing docs/elevenlabs_state/ ...")
    import subprocess
    dump_env = {**os.environ, "XI_API_KEY": api_key}
    try:
        subprocess.run(
            [sys.executable, str(ROOT / "dump_agent_state.py")],
            env=dump_env, check=True, timeout=120,
        )
    except Exception as e:
        print(f"  [warn] dump_agent_state.py failed: {e}", file=sys.stderr)
        print(f"  (PATCHes above still succeeded; re-run dump manually if needed)", file=sys.stderr)

    print("\n[done] snapshots in cm_voice_app/docs/prompt_versions/ + elevenlabs_state/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
