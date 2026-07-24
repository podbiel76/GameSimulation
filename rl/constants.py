"""
rl.constants — ładuje wspólne stałe modelu walki z shared/combat_constants.json.

To JEDYNE źródło liczb dla portu Pythona. TS używa tego samego pliku (patrz
src/utils/combatPotential.ts / attritionRules.ts). Parity-testy (rl/parity) pilnują,
by oba modele dawały identyczne wyniki.

Model jest abstrakcyjny i symulacyjny — nie zawiera realnych wartości doktrynalnych.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

# repo_root/rl/constants.py -> repo_root/shared/combat_constants.json
_CONSTANTS_PATH = Path(__file__).resolve().parent.parent / "shared" / "combat_constants.json"

UNIT_CLASSES = ("armor", "infantry", "artillery", "anti_tank")
TERRAIN_CLASSES = ("forest", "water", "wetland", "urban", "road", "open")
COMBAT_CATEGORIES = ("infantry", "armor", "artillery", "anti_air", "air")


@lru_cache(maxsize=1)
def load_constants() -> dict[str, Any]:
    """Wczytaj i zwaliduj wspólny plik stałych (cache'owane)."""
    if not _CONSTANTS_PATH.exists():
        raise FileNotFoundError(f"Brak pliku stałych: {_CONSTANTS_PATH}")
    with _CONSTANTS_PATH.open(encoding="utf-8") as fh:
        data = json.load(fh)
    _validate(data)
    return data


def _validate(data: dict[str, Any]) -> None:
    required_top = {"simulation", "potential", "echelonCaps", "attrition", "movementFuelBurnPerKm"}
    missing = required_top - data.keys()
    if missing:
        raise ValueError(f"combat_constants.json: brak sekcji {sorted(missing)}")

    pot = data["potential"]
    for table in ("terrainModifiers", "terrainModifiersAttacker", "terrainModifiersDefender"):
        keys = set(pot[table].keys())
        if keys != set(TERRAIN_CLASSES):
            raise ValueError(f"potential.{table}: klasy terenu {sorted(keys)} != {sorted(TERRAIN_CLASSES)}")

    attr = data["attrition"]
    for table in ("saRate", "atRate", "mortarAmmoRate", "combatFuelPerVehicle"):
        keys = set(attr[table].keys())
        if keys != set(UNIT_CLASSES):
            raise ValueError(f"attrition.{table}: klasy {sorted(keys)} != {sorted(UNIT_CLASSES)}")


# Wygodne, najczęściej używane aliasy ------------------------------------------
CONST = load_constants()
SIM = CONST["simulation"]
POTENTIAL = CONST["potential"]
ECHELON_CAPS = CONST["echelonCaps"]
ATTRITION = CONST["attrition"]


if __name__ == "__main__":  # szybki self-check
    c = load_constants()
    print(f"OK: wczytano {_CONSTANTS_PATH.name}")
    print(f"  tick_ms={SIM['tick_ms']} attrition_coefficient={SIM['attrition_coefficient']}")
    print(f"  echelonów={len(ECHELON_CAPS)} klas={UNIT_CLASSES}")
