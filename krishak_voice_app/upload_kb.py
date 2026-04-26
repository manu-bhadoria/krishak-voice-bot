#!/usr/bin/env python3
"""Upload the persona KB and the extended RAG KB to the ElevenLabs agent.

Usage:
    XI_API_KEY=sk_... python upload_kb.py

Uploads both knowledge_base.md (persona) and knowledge_base_ext.md (RAG bulk)
as files in the agent's Knowledge Base, then PATCHes the agent to attach them
with RAG enabled so retrieval happens automatically at runtime.
"""
import json
import mimetypes
import os
import sys
import uuid
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent
PROJECT_ROOT = ROOT.parent
ENV_FILE = ROOT / ".env.local"

# Parse .env.local
env = {}
for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")

API_KEY = os.environ.get("XI_API_KEY") or env.get("VOICE_API_KEY")
AGENT_ID = env.get("VOICE_AGENT_ID")

if not API_KEY or not AGENT_ID:
    print("ERROR: need XI_API_KEY / VOICE_API_KEY and VOICE_AGENT_ID", file=sys.stderr)
    sys.exit(1)

FILES = [
    PROJECT_ROOT / "knowledge_base.md",
    PROJECT_ROOT / "knowledge_base_ext.md",
]


def upload_file(path: Path) -> str:
    """Upload a single file to the agent's knowledge base, return document_id."""
    boundary = f"----kbupload{uuid.uuid4().hex}"
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
            "xi-api-key": API_KEY,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        raise

    doc_id = result.get("id") or result.get("document_id")
    print(f"  uploaded {filename} -> {doc_id}")
    return doc_id


def attach_to_agent(document_ids: list[str]) -> None:
    """Attach documents to the agent's prompt.knowledge_base with RAG usage."""
    kb_entries = [
        {
            "type": "file",
            "id": doc_id,
            "name": f"kb_{i}",
            "usage_mode": "auto",  # RAG retrieval
        }
        for i, doc_id in enumerate(document_ids)
    ]

    payload = {
        "conversation_config": {
            "agent": {
                "prompt": {
                    "knowledge_base": kb_entries,
                    "rag": {"enabled": True},
                },
            },
        },
    }

    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/convai/agents/{AGENT_ID}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"xi-api-key": API_KEY, "Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            print("  PATCH agent ok")
    except urllib.error.HTTPError as e:
        print(f"PATCH HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        raise


def main() -> int:
    print(f"Agent: {AGENT_ID}")
    doc_ids = []
    for fp in FILES:
        if not fp.exists():
            print(f"skip (missing): {fp}")
            continue
        print(f"Uploading: {fp.name} ({fp.stat().st_size} bytes)")
        try:
            doc_ids.append(upload_file(fp))
        except Exception as e:
            print(f"  upload failed: {e}", file=sys.stderr)
            return 2

    if not doc_ids:
        print("Nothing uploaded")
        return 1

    print(f"\nAttaching {len(doc_ids)} documents to agent with RAG enabled...")
    try:
        attach_to_agent(doc_ids)
    except Exception as e:
        print(f"attach failed: {e}", file=sys.stderr)
        return 3

    print("\n[ok] KB uploaded and attached. RAG will retrieve relevant chunks per turn.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
