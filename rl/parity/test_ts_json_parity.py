"""
test_ts_json_parity.py — pilnuje, żeby stałe zaszyte w TypeScripcie nie rozjechały się
z shared/combat_constants.json.

Kontekst (audyt architektoniczny, §2.2):
    GUARDRAIL.md deklaruje shared/combat_constants.json jako JEDYNE źródło liczb modelu.
    Port Pythona faktycznie je czyta (rl/constants.py). Frontend — nie: te same wagi,
    mnożniki terenu i ECHELON_CAPS ma przepisane ręcznie w src/utils/combatPotential.ts
    i src/hooks/useLocalSimulation.ts.

    Istniejące testy w rl/parity porównują PY ↔ golden(TS) na poziomie WYNIKÓW, ale
    wymagają wygenerowania golden_potential.json i są pomijane, gdy go nie ma.
    Ten test porównuje WEJŚCIA (same liczby) bezpośrednio z pliku TS — nie wymaga
    Node'a ani kroku generowania, więc realnie chodzi w CI.

Dlaczego parsowanie TS regexem, a nie import JSON-a w TS:
    combatPotential.ts znika w wariancie A migracji (silnik przenosi się na serwer).
    Przepinanie go na wspólny JSON to praca do wyrzucenia; ten strażnik kosztuje mniej
    i pełni tę samą funkcję na czas migracji, kiedy oba modele muszą współistnieć.

Uruchomienie:
    pytest rl/parity/test_ts_json_parity.py -v
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from rl.constants import load_constants

_ROOT = Path(__file__).resolve().parent.parent.parent
_TS_POTENTIAL = _ROOT / "src" / "utils" / "combatPotential.ts"
_TS_SIM = _ROOT / "src" / "hooks" / "useLocalSimulation.ts"
# Od fazy 3 stałe pętli mieszkają w silniku; hook trzyma tylko stałe zapisu do backendu.
_TS_ENGINE = _ROOT / "src" / "sim" / "engine.ts"


def _read(path: Path) -> str:
    if not path.exists():
        pytest.skip(f"Brak pliku TS: {path} (frontendowy model już usunięty?)")
    return path.read_text(encoding="utf-8")


def _parse_numeric_object(src: str, start_marker: str, end_marker: str = "},") -> dict[str, float]:
    """Wyciąga `klucz: liczba` z pierwszego bloku {...} po start_marker."""
    start = src.index(start_marker)
    block = src[start : src.index(end_marker, start)]
    return {
        m.group(1): float(m.group(2).replace("_", ""))
        for m in re.finditer(r"(\w+):\s*([\d_]+\.?\d*)", block)
    }


def _parse_echelon_caps(src: str) -> dict[str, dict[str, float]]:
    block = src[src.index("export const ECHELON_CAPS") : src.index("function getEchelonCaps")]
    caps: dict[str, dict[str, float]] = {}
    for m in re.finditer(r"(\w+):\s*\{(.*?)\}", block, re.S):
        name, body = m.group(1), m.group(2)
        entry = {
            km.group(1): float(km.group(2).replace("_", ""))
            for km in re.finditer(r"(\w+):\s*([\d_]+\.?\d*)", body)
        }
        if entry:
            caps[name] = entry
    return caps


# ─── Tabele potencjału ────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "ts_marker, json_key",
    [
        ("categoryWeights: {", "categoryWeights"),
        ("terrainModifiers: {", "terrainModifiers"),
        ("terrainModifiersAttacker: {", "terrainModifiersAttacker"),
        ("terrainModifiersDefender: {", "terrainModifiersDefender"),
    ],
)
def test_potential_tables_match(ts_marker: str, json_key: str) -> None:
    ts = _parse_numeric_object(_read(_TS_POTENTIAL), ts_marker)
    js = load_constants()["potential"][json_key]
    assert ts == pytest.approx(js), (
        f"{json_key} rozjechało się między combatPotential.ts a combat_constants.json.\n"
        f"  TS   = {ts}\n  JSON = {js}"
    )


# ─── ECHELON_CAPS ─────────────────────────────────────────────────────────────

def test_echelon_caps_match() -> None:
    ts = _parse_echelon_caps(_read(_TS_POTENTIAL))
    js = load_constants()["echelonCaps"]

    assert set(ts) == set(js), (
        "Różne zestawy szczebli.\n"
        f"  tylko w TS  : {sorted(set(ts) - set(js))}\n"
        f"  tylko w JSON: {sorted(set(js) - set(ts))}"
    )
    for echelon in sorted(ts):
        assert ts[echelon] == pytest.approx(js[echelon]), (
            f"ECHELON_CAPS['{echelon}'] rozjechał się.\n"
            f"  TS   = {ts[echelon]}\n  JSON = {js[echelon]}"
        )


# ─── Stałe pętli symulacji ────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "ts_name, pattern, json_key",
    [
        ("TICK_MS", r"export const TICK_MS\s*=\s*([\d.]+)", "tick_ms"),
        ("ENGAGEMENT_CHECK_TICKS", r"ENGAGEMENT_CHECK_TICKS\s*=\s*([\d.]+)", "engagement_check_ticks"),
        ("ATTRITION_PERSIST_TICKS", r"ATTRITION_PERSIST_TICKS\s*=\s*([\d.]+)", "attrition_persist_ticks"),
        ("ATTRITION_COEFFICIENT", r"ATTRITION_COEFFICIENT\s*=\s*([\d.]+)", "attrition_coefficient"),
        (
            "SIDE_DEFEAT_POTENTIAL_DISPLAY",
            r"SIDE_DEFEAT_POTENTIAL_DISPLAY\s*=\s*([\d.]+)",
            "side_defeat_potential_display",
        ),
    ],
)
def test_simulation_scalars_match(ts_name: str, pattern: str, json_key: str) -> None:
    src = _read(_TS_ENGINE) + "\n" + _read(_TS_SIM)
    match = re.search(pattern, src)
    assert match, f"Nie znaleziono {ts_name} w useLocalSimulation.ts"
    ts_value = float(match.group(1))
    js_value = float(load_constants()["simulation"][json_key])
    assert ts_value == pytest.approx(js_value), (
        f"{ts_name}: TS={ts_value} vs JSON[{json_key}]={js_value}"
    )


def test_terrain_speed_modifiers_match() -> None:
    src = _read(_TS_ENGINE) + "\n" + _read(_TS_SIM)
    start = src.index("TERRAIN_SPEED_MODIFIERS")
    block = src[start : src.index("};", start)]
    ts = {m.group(1): float(m.group(2)) for m in re.finditer(r"(\w+):\s*([\d.]+)", block)}
    js = load_constants()["simulation"]["terrainSpeedModifiers"]
    assert ts == pytest.approx(js), (
        "TERRAIN_SPEED_MODIFIERS (useLocalSimulation.ts) rozjechało się z JSON-em.\n"
        f"  TS   = {ts}\n  JSON = {js}"
    )
