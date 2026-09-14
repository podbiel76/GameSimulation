"""
Teren jako rozkład klas (profil z WorldCover) — port PY musi liczyć modyfikator
jako średnią ważoną udziałami, a pojedyncza klasa ze 100% udziału musi dawać
dokładnie ten sam wynik co dotychczasowy wariant z nazwą klasy.
"""

from __future__ import annotations

import pytest

from rl.combat_model import compute_unit_potential
from rl.constants import POTENTIAL

UNIT = {
    "id": "u1", "symbol_name": "Infantry Company", "unit_type": "infantry",
    "echelon": "company_battery_troop", "base_speed_kmh": 10, "readiness_status": "ready",
    "logistics": {
        "personnel_total": 120, "personnel_available": 120,
        "ammo_small_arms": 4000, "ammo_at": 20, "ammo_mortar": 250,
        "fuel_liters": 2000, "combat_effectiveness_percent": 100,
    },
}
CLASSES = ("forest", "water", "wetland", "urban", "road", "open")
ROLES = ("attacker", "defender", "neutral")
TABLES = {
    "attacker": "terrainModifiersAttacker",
    "defender": "terrainModifiersDefender",
    "neutral": "terrainModifiers",
}


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("cls", CLASSES)
def test_single_class_mix_equals_class(cls, role):
    as_class = compute_unit_potential(UNIT, cls, role).breakdown
    as_mix = compute_unit_potential(UNIT, {cls: 1.0}, role).breakdown
    assert as_mix["effectivePotential"] == pytest.approx(as_class["effectivePotential"], abs=1e-12)
    assert as_mix["terrain"] == cls


@pytest.mark.parametrize("role", ROLES)
def test_mix_is_weighted_average(role):
    mix = {"forest": 0.35, "open": 0.40, "urban": 0.15, "water": 0.10}
    table = POTENTIAL[TABLES[role]]
    expected = sum(share * table[c] for c, share in mix.items())
    got = compute_unit_potential(UNIT, mix, role).breakdown
    assert got["terrainModifier"] == pytest.approx(expected, abs=1e-12)
    assert got["terrain"] == "open"
    assert got["terrainMix"] == mix


def test_mix_is_normalized():
    """Udziały nie muszą sumować się do 1 (np. zaokrąglenia) — liczy się proporcja."""
    a = compute_unit_potential(UNIT, {"forest": 0.5, "open": 0.5}, "defender").breakdown
    b = compute_unit_potential(UNIT, {"forest": 0.49, "open": 0.49}, "defender").breakdown
    assert a["terrainModifier"] == pytest.approx(b["terrainModifier"], abs=1e-12)


def test_empty_mix_falls_back_to_open():
    got = compute_unit_potential(UNIT, {}, "attacker").breakdown
    ref = compute_unit_potential(UNIT, "open", "attacker").breakdown
    assert got["terrainModifier"] == pytest.approx(ref["terrainModifier"], abs=1e-12)
