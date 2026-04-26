#!/usr/bin/env python3
"""Regenerate qr-code.png for the live deployed URL.

Run AFTER the first Cloudflare Pages deploy returns the actual production URL.
The default placeholder QR points to https://krishak-voice-bot.pages.dev — if
you set a custom domain or the project name differs, regenerate with this.

Usage:
    py -3 regenerate-qr.py https://your-real-url.pages.dev

Requires:
    pip install qrcode[pil]
"""
import sys
from pathlib import Path

if len(sys.argv) != 2:
    print(f"usage: {sys.argv[0]} <production-url>", file=sys.stderr)
    sys.exit(1)

url = sys.argv[1].strip()
if not url.startswith(("http://", "https://")):
    print(f"ERROR: url must start with http:// or https:// — got {url!r}", file=sys.stderr)
    sys.exit(2)

import qrcode
from qrcode.constants import ERROR_CORRECT_M

qr = qrcode.QRCode(
    version=None,
    error_correction=ERROR_CORRECT_M,
    box_size=12,  # 12 * (~33 modules) = ~400px image; large enough for stage cameras
    border=4,
)
qr.add_data(url)
qr.make(fit=True)

# Krishak palette — wheat ink on warm paper background.
img = qr.make_image(fill_color="#1e1812", back_color="#fff8ed")
out = Path(__file__).parent / "qr-code.png"
img.save(out)
print(f"OK — wrote {out} for {url}")

link_file = Path(__file__).parent / "live-link.txt"
link_file.write_text(f"{url}\n", encoding="utf-8")
print(f"OK — wrote {link_file}")
