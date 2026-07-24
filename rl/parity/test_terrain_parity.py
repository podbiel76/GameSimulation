"""
test_terrain_parity.py — port klasyfikatora terenu (PY) musi zgadzać się z TS 1:1.

Workflow:
    npx tsx rl/parity/generate_golden_terrain.ts
    pytest rl/parity/test_terrain_parity.py
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rl.terrain.classifier import classify_pixel_color, determine_terrain

_GOLDEN = Path(__file__).resolve().parent / "golden_terrain.json"


def _load():
    if not _GOLDEN.exists():
        pytest.skip("Brak golden_terrain.json — uruchom: npx tsx rl/parity/generate_golden_terrain.ts")
    return json.loads(_GOLDEN.read_text(encoding="utf-8"))


def test_pixel_classification_parity():
    data = _load()
    mismatches = []
    for c in data["pixelCases"]:
        got = classify_pixel_color(c["r"], c["g"], c["b"])
        if got != c["cls"]:
            mismatches.append((c["r"], c["g"], c["b"], got, c["cls"]))
    assert not mismatches, f"{len(mismatches)} rozbieżności PY↔TS, np. {mismatches[:5]}"


def test_determine_terrain_parity():
    data = _load()
    for c in data["countCases"]:
        got = determine_terrain(c["counts"], c["total"])
        assert got == c["terrain"], f"counts={c['counts']}: PY={got} != TS={c['terrain']}"
