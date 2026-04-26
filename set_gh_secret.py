#!/usr/bin/env python3
"""Set GitHub Actions repository secrets via REST API.

Usage:
    set_gh_secret.py <owner/repo> <secret_name> <value_or_at_file>
If the third arg starts with '@', the rest is a file path whose contents is
the value.
"""
import base64
import json
import os
import sys
import urllib.request
import urllib.error
from nacl import encoding, public

GH_TOKEN = os.environ.get("GH_TOKEN")
if not GH_TOKEN:
    print("GH_TOKEN env var required", file=sys.stderr); sys.exit(2)

if len(sys.argv) < 4:
    print(__doc__, file=sys.stderr); sys.exit(2)
repo = sys.argv[1]
secret_name = sys.argv[2]
raw = sys.argv[3]
value = open(raw[1:], encoding="utf-8").read().strip() if raw.startswith("@") else raw

base = f"https://api.github.com/repos/{repo}/actions/secrets"

def req(url: str, method: str = "GET", body: bytes | None = None):
    r = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            data = resp.read()
            return resp.status, json.loads(data) if data else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")

# 1. Get repo public key
status, pk = req(f"{base}/public-key")
if status != 200:
    print(f"public-key failed {status}: {pk}", file=sys.stderr); sys.exit(3)
pub_key_b64 = pk["key"]
key_id = pk["key_id"]

# 2. Encrypt value with libsodium sealed box
sealed = public.SealedBox(public.PublicKey(pub_key_b64.encode("utf-8"), encoding.Base64Encoder()))
encrypted = sealed.encrypt(value.encode("utf-8"))
encrypted_b64 = base64.b64encode(encrypted).decode("utf-8")

# 3. PUT secret
body = json.dumps({"encrypted_value": encrypted_b64, "key_id": key_id}).encode("utf-8")
status, resp = req(f"{base}/{secret_name}", method="PUT", body=body)
if status not in (201, 204):
    print(f"set failed {status}: {resp}", file=sys.stderr); sys.exit(4)
print(f"[ok] secret {secret_name} set on {repo} (len={len(value)})")
