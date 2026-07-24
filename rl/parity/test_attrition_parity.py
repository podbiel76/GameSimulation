"""
test_attrition_parity.py — port atrycji (raw, deterministyczny) musi zgadzać się z TS 1:1.

    npx tsx rl/parity/generate_golden_attrition.ts
    pytest rl/parity/test_attrition_parity.py
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rl.combat_model import compute_attrition_raw

_GOLDEN = Path(__file__).resolve().parent / "golden_attrition.json"
ABS_TOL = 1e-9


def _load():
    if not _GOLDEN.exists():
        pytest.skip("Brak golden_attrition.json — uruchom: npx tsx rl/parity/generate_golden_attrition.ts")
    return json.loads(_GOLDEN.read_text(encoding="utf-8"))


def test_attrition_raw_parity():
    for case in _load():
        inp = case["input"]
        got = compute_attrition_raw(inp["unit"], inp["baseLoss"], inp["profile"])
        for key, expected_val in case["expected"].items():
            assert abs(got[key] - expected_val) <= ABS_TOL, (
                f"{case['name']}.{key}: PY={got[key]} != TS={expected_val}"
            )
