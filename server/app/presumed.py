"""
presumed.py — domniemana logistyka jednostki wykrytej z detekcji (M7, strona backendu).

Detektor daje pozycję/typ/szczebel/stronę, nie siłę. Tu domniemywamy logistykę z
typu+szczebla, żeby wykryty wróg był zdolny do walki w symulacji (inaczej ma 0 personelu).
Liczby z tego samego pliku co model RL: shared/combat_constants.json (jedno źródło).

Abstrakcyjne założenia symulacyjne — nie realne dane doktrynalne.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

# server/app/presumed.py -> repo_root/shared/combat_constants.json
_CONST_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "combat_constants.json"


@lru_cache(maxsize=1)
def _const() -> dict:
    with _CONST_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def parse_class_name(class_name: str) -> tuple[str, str, str | None]:
    """(unit_type, echelon, side) z nazwy klasy, np. EN_Land_unit__Infantry__Company_Battery_Troop."""
    c = _const()
    caps = c["echelonCaps"]
    presumed = c["presumed"]
    name, side, low = class_name, None, class_name.lower()
    if low.startswith("en_"):
        side, name = "hostile", class_name[3:]
    elif low.startswith("pl_"):
        side, name = "friendly", class_name[3:]
    parts = name.split("__")
    category = (parts[1] if len(parts) > 1 else "").lower()
    echelon = (parts[2] if len(parts) > 2 else "").lower()
    if echelon not in caps:
        echelon = presumed["defaultEchelon"]
    if "armor" in category or "tank" in category or "mechan" in category:
        unit_type = "armor"
    elif "artiller" in category or "mortar" in category:
        unit_type = "artillery"
    elif "antitank" in category or "anti_tank" in category or "antiarmor" in category:
        unit_type = "anti_tank"
    else:
        unit_type = "infantry"
    return unit_type, echelon, side


def presumed_logistics(unit_type: str, echelon: str | None) -> dict:
    c = _const()
    caps_all = c["echelonCaps"]
    presumed = c["presumed"]
    ech = echelon if echelon in caps_all else presumed["defaultEchelon"]
    caps = caps_all[ech]
    f = presumed["fillFraction"]
    personnel = presumed["personnelByEchelon"].get(ech, 120)
    log = {
        "personnel_total": personnel, "personnel_available": personnel,
        "ammo_small_arms": round(caps["ammoSmallArmsMax"] * f),
        "ammo_at": round(caps["ammoAtMax"] * f),
        "ammo_mortar": round(caps["ammoMortarMax"] * f),
        "fuel_liters": round(caps["fuelCapacityDefault"] * f),
        "fuel_capacity_liters": caps["fuelCapacityDefault"],
        "combat_effectiveness_percent": 100,
    }
    if unit_type == "armor":
        v = presumed["armorVehiclesByEchelon"].get(ech, {"tanks": 10, "ifv": 6})
        log.update({
            "tanks_total": v["tanks"], "tanks_operational": v["tanks"],
            "ifv_total": v["ifv"], "ifv_operational": v["ifv"],
            "ammo_main": round(caps["ammoMainMax"] * f),
            "ammo_secondary": round(caps["ammoSecondaryMax"] * f),
        })
    elif unit_type == "artillery":
        m = presumed["mortarsByEchelon"].get(ech, 6)
        log.update({"mortars_total": m, "mortars_operational": m})
    return log
