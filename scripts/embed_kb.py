"""One-shot offline KB embedding script.

Reads api/knowledge_base.json, embeds each entry's `fact` text via
OpenAI's `text-embedding-3-small`, writes the vectors to
api/knowledge_base.embeddings.json.

The runtime tutor (`api/tools.py:lookup_knowledge`) loads this file
on import and uses cosine top-k against it; if the file is missing or
malformed it falls back to bag-of-words. So running this script is a
one-time cost (~£0.0001 per 49 entries) that the runtime gracefully tolerates
not having.

R2.3 note: provider-specific. If we move to a local embeddings model
(BGE / MiniLM) later, swap the call in `_embed_batch()`.

Usage:
    OPENAI_API_KEY=... python scripts/embed_kb.py

Idempotent: re-running detects unchanged facts via a sha256 hash and skips
re-embedding them.

Plan ref: tutor-redo/02-post-validator-and-embeddings.md §2.4.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
KB_PATH = REPO_ROOT / "api" / "knowledge_base.json"
EMB_PATH = REPO_ROOT / "api" / "knowledge_base.embeddings.json"
EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def _load_existing() -> dict[str, dict[str, Any]]:
    if not EMB_PATH.exists():
        return {}
    try:
        raw = json.loads(EMB_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {
        e["id"]: e
        for e in raw.get("entries", [])
        if isinstance(e, dict) and isinstance(e.get("id"), str)
    }


def _embed_batch(texts: list[str]) -> list[list[float]]:
    from openai import OpenAI  # type: ignore[import-not-found]

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit(
            "OPENAI_API_KEY is not set. Provide a key (the call costs ~£0.0001 "
            "for 49 entries)."
        )
    client = OpenAI(api_key=api_key)
    # OpenAI embedding endpoints support batched inputs; embed all 49 in one
    # call so the script is a single round-trip.
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [list(d.embedding) for d in resp.data]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be embedded; do not call the API.",
    )
    args = parser.parse_args(argv)

    if not KB_PATH.exists():
        print(f"KB not found at {KB_PATH}", file=sys.stderr)
        return 1

    kb = json.loads(KB_PATH.read_text(encoding="utf-8"))
    entries = list(kb.get("pinned", [])) + list(kb.get("entries", []))
    entries = [e for e in entries if isinstance(e, dict) and e.get("id")]

    existing = _load_existing()
    to_embed_ids: list[str] = []
    to_embed_texts: list[str] = []
    new_records: dict[str, dict[str, Any]] = {}

    for entry in entries:
        eid = entry["id"]
        fact = str(entry.get("fact", ""))
        h = _hash(fact)
        prior = existing.get(eid)
        if prior and prior.get("hash") == h and prior.get("vector"):
            new_records[eid] = prior
            continue
        to_embed_ids.append(eid)
        to_embed_texts.append(fact)

    print(
        f"KB entries: {len(entries)} | unchanged: {len(entries) - len(to_embed_ids)} | "
        f"new or modified: {len(to_embed_ids)}"
    )

    if args.dry_run:
        for eid in to_embed_ids:
            print(f"  would embed: {eid}")
        return 0

    if to_embed_ids:
        vectors = _embed_batch(to_embed_texts)
        for eid, vec in zip(to_embed_ids, vectors):
            entry = next(e for e in entries if e["id"] == eid)
            new_records[eid] = {
                "id": eid,
                "hash": _hash(str(entry.get("fact", ""))),
                "vector": vec,
            }

    out = {
        "model": EMBED_MODEL,
        "dim": len(next(iter(new_records.values()), {}).get("vector", []))
        if new_records else 0,
        "entries": [new_records[e["id"]] for e in entries if e["id"] in new_records],
    }
    EMB_PATH.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {EMB_PATH} ({len(out['entries'])} vectors, dim={out['dim']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
