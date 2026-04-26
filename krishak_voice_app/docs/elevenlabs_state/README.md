# ElevenLabs live state dump

- **captured_at_utc:** 2026-04-26T15:07:32Z
- **agent_id:** `agent_9501kq559m78ewxb56ypsqaa6f8b`
- **voice_id:** `vxeICktjKaYzkMOFXiUL`
- **conversations dumped:** 0

## Files

| Path | Contents |
|---|---|
| `agent.json` | Full `GET /v1/convai/agents/{id}` — prompt, LLM/TTS/RAG/turn/ASR config, KB attachments, platform settings |
| `voice.json` | Full `GET /v1/voices/{id}` — voice clone metadata, `high_quality_base_model_ids`, preview URL |
| `knowledge_base.json` | Workspace-wide KB docs (metadata; file contents not included) |
| `conversations.json` | List of the 50 most recent conversations (summaries) |
| `conversations/<id>.json` | Per-call full transcript + turn-level LLM/TTS/RAG metrics |

## Refresh

```bash
XI_API_KEY=sk_... python cm_voice_app/dump_agent_state.py
```

Idempotent; overwrites previous dumps. Does not include the API key in output.
