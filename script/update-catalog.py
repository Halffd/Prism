#!/usr/bin/env python3
"""Regenerate crates/prism-core/src/catalog_snapshot.json.

Fetches https://models.dev/api.json and extracts the OpenAI-compatible
providers Prism supports, mapping catalog ids onto Prism provider ids.
Trims each model to the fields prism-core's ModelInfo consumes.

Usage: python3 script/update-catalog.py
Requires: network access; no third-party deps (stdlib only).
"""

import json
import urllib.request
from pathlib import Path

CATALOG_URL = "https://models.dev/api.json"

# models.dev provider id -> (prism provider id, OpenAI-compat base URL)
MAPPING = {
    "openai": ("openai", "https://api.openai.com/v1"),
    "google": ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
    "deepseek": ("deepseek", "https://api.deepseek.com/v1"),
    "groq": ("groq", "https://api.groq.com/openai/v1"),
    "openrouter": ("openrouter", "https://openrouter.ai/api/v1"),
    "mistral": ("mistral", "https://api.mistral.ai/v1"),
    "xai": ("grok", "https://api.x.ai/v1"),
    "nvidia": ("nvidia-nim", "https://integrate.api.nvidia.com/v1"),
    "cerebras": ("cerebras", "https://api.cerebras.ai/v1"),
    "togetherai": ("together", "https://api.together.xyz/v1"),
    "fireworks-ai": ("fireworks", "https://api.fireworks.ai/inference/v1"),
    "perplexity": ("perplexity", "https://api.perplexity.ai"),
}

OUT = Path(__file__).parent.parent / "crates/prism-core/src/catalog_snapshot.json"


def main() -> None:
    with urllib.request.urlopen(CATALOG_URL, timeout=30) as r:
        d = json.load(r)

    out = {}
    for cat_id, (prism_id, base_url) in MAPPING.items():
        p = d.get(cat_id)
        if not p:
            print(f"warn: {cat_id} missing from catalog")
            continue
        models = {}
        for mid, m in p.get("models", {}).items():
            models[mid] = {
                "id": m.get("id", mid),
                "name": m.get("name", mid),
                "reasoning": bool(m.get("reasoning")),
                "tool_call": bool(m.get("tool_call")),
                "attachment": bool(m.get("attachment")),
                "temperature": m.get("temperature", True),
                "limit_context": (m.get("limit") or {}).get("context"),
                "limit_output": (m.get("limit") or {}).get("output"),
                "cost_in": (m.get("cost") or {}).get("input"),
                "cost_out": (m.get("cost") or {}).get("output"),
                "modalities_in": (m.get("modalities") or {}).get("input") or [],
                "status": m.get("status"),
                "release_date": m.get("release_date"),
            }
        out[prism_id] = {
            "catalog_id": cat_id,
            "base_url": base_url.rstrip("/"),
            "env": p.get("env", []),
            "models": models,
        }

    total = sum(len(v["models"]) for v in out.values())
    OUT.write_text(json.dumps({"providers": out}, separators=(",", ":")))
    print(f"wrote {OUT} ({len(out)} providers, {total} models)")


if __name__ == "__main__":
    main()
