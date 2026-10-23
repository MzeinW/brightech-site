#!/usr/bin/env python3
"""Fetch a pinned Sveltia CMS release into admin/vendor/, verifying unpkg's SHA-256 integrity hashes.

    python scripts/vendor-sveltia.py 0.250.2

Everything is downloaded and verified into a temporary folder first; only then is the old admin/vendor/ replaced,
so a failed or tampered download leaves the working copy untouched. Source maps and the unused ES-module build are skipped.
After updating: build with CONTEXT=branch-deploy, try sign in, create with image, edit and delete on `staging`, then merge.
"""
import base64
import hashlib
import json
import pathlib
import shutil
import sys
import tempfile
import urllib.request

if len(sys.argv) != 2:
    raise SystemExit(__doc__)
VERSION = sys.argv[1]
DEST = pathlib.Path(__file__).resolve().parent.parent / "admin" / "vendor"
BASE = f"https://unpkg.com/@sveltia/cms@{VERSION}"


def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


meta = json.loads(get(BASE + "/dist/?meta"))
if meta["version"] != VERSION:
    raise SystemExit(f"unpkg resolved {VERSION} to {meta['version']}; pass an exact version")

tmp = pathlib.Path(tempfile.mkdtemp(prefix="sveltia-"))
rows = []
try:
    for f in meta["files"]:
        if f["path"].endswith(".map") or f["path"].endswith(".mjs"):
            continue
        data = get(BASE + f["path"])
        algo, _, expected = f["integrity"].partition("-")
        if algo != "sha256" or base64.b64encode(hashlib.sha256(data).digest()).decode() != expected:
            raise SystemExit(f"INTEGRITY MISMATCH for {f['path']}; nothing was changed")
        rel = f["path"][len("/dist/"):]
        out = tmp / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        rows.append((rel, len(data), hashlib.sha256(data).hexdigest()))
        print(f"ok  {rel:55s} {len(data):>9,d} bytes")

    root = json.loads(get(BASE + "/?meta"))
    for f in root["files"]:
        if f["path"].lower().lstrip("/").startswith("license"):
            (tmp / "LICENSE").write_bytes(get(BASE + f["path"]))
            print("ok  LICENSE")
            break
    else:
        print("note: no LICENSE file in the package (package.json says MIT)")

    (tmp / "VERSION.txt").write_text(
        f"@sveltia/cms {VERSION}\nsource: {BASE}/dist/\nlicense: MIT (per package.json)\n"
        "Source maps are not vendored. Update with: python scripts/vendor-sveltia.py <version>\n\nsha256 of each file:\n"
        + "".join(f"{h}  {rel}\n" for rel, _, h in sorted(rows)),
        encoding="utf-8",
    )
    if DEST.exists():
        shutil.rmtree(DEST)
    shutil.move(str(tmp), str(DEST))
    print(f"vendored {len(rows)} files ({sum(n for _, n, _ in rows):,d} bytes) into {DEST}")
finally:
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
