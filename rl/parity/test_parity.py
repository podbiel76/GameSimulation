"""
test_parity.py — porównuje wyniki portu Pythona z "golden" referencją z TS.

Workflow:
    1) npx tsx rl/parity/generate_golden.ts      # zrzuca golden_potential.json z modelu TS
    2) pytest rl/parity/test_parity.py           # porównuje port PY z golden

Dopóki port Pythona (rl/combat_model.py, kamień M3) nie istnieje, test ładuje
golden i stałe oraz sprawdza spójność struktury, a właściwe porównanie liczbowe
jest pomijane (skip) z czytelnym komunikatem.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rl.constants import load_constants

_HERE = Path(__file__).resolve().parent
_GOLDEN = _HERE / "golden_potential.json"

# Tolerancja na różnice zmiennoprzecinkowe TS(float64) vs Python(float).
ABS_TOL = 1e-9


def _load_golden() -> list[dict]:
    if not _GOLDEN.exists():
        pytest.skip(
            "Brak golden_potential.json — uruchom najpierw: npx tsx rl/parity/generate_golden.ts"
        )
    return json.loads(_GOLDEN.read_text(encoding="utf-8"))


def test_constants_load():
    c = load_constants()
    assert c["simulation"]["attrition_coefficient"] == 0.02
    assert set(c["potential"]["categoryWeights"]) == {
        "infantry", "armor", "artillery", "anti_air", "air"
    }


def test_golden_structure():
    cases = _load_golden()
    assert len(cases) > 0
    for case in cases:
        assert {"name", "input", "expected"} <= case.keys()
        bd = case["expected"]
        assert "effectivePotential" in bd and "staticPotential" in bd


def test_potential_parity():
    cases = _load_golden()
    try:
        from rl.combat_model import compute_unit_potential  # type: ignore
    except ImportError:
        pytest.skip("Port Pythona (rl/combat_model.py) jeszcze nie istnieje — kamień M3.")

    for case in cases:
        inp = case["input"]
        got = compute_unit_potential(inp["unit"], inp["terrain"], role=inp["role"]).breakdown
        for key, expected_val in case["expected"].items():
            if isinstance(expected_val, (int, float)):
                assert abs(got[key] - expected_val) <= ABS_TOL, (
                    f"{case['name']}.{key}: PY={got[key]} != TS={expected_val}"
                )
