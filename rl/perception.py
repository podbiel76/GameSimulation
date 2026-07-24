"""
rl.perception — percepcja + domniemana logistyka wroga (kamień M7).

Detektor (YOLO) daje POZYCJĘ, TYP i STRONĘ wykrytej jednostki, ale NIE jej siłę
(amunicja/personel/paliwo). Tu domniemywamy logistykę z typu+szczebla, by agent miał
komplet danych (pełna obserwowalność, jak ustalono). Wartości z shared/combat_constants.json.

Abstrakcyjne założenia symulacyjne — nie realne dane doktrynalne.
"""

from __future__ import annotations

from rl.constants import CONST, ECHELON_CAPS

_PRESUMED = CONST["presumed"]
_ARMOR_KW = CONST["classification"]["armorTypeKeywords"]


def parse_class_name(class_name: str) -> tuple[str, str, str | None]:
    """
    Z nazwy klasy detektora (np. 'EN_Land_unit__Infantry__Company_Battery_Troop')
    wyciągnij (unit_type, echelon, side). Format: [EN_|PL_]...__Kategoria__Szczebel.
    """
    name = class_name
    side = None
    low = name.lower()
    if low.startswith("en_"):
        side, name = "hostile", name[3:]
    elif low.startswith("pl_"):
        side, name = "friendly", name[3:]

    parts = name.split("__")
    category = parts[1] if len(parts) > 1 else ""
    echelon_raw = parts[2] if len(parts) > 2 else ""
    echelon = echelon_raw.lower()
    if echelon not in ECHELON_CAPS:
        echelon = _PRESUMED["defaultEchelon"]

    cat = category.lower()
    if "armor" in cat or "tank" in cat or "mechan" in cat:
        unit_type = "armor"
    elif "artiller" in cat or "mortar" in cat:
        unit_type = "artillery"
    elif "antitank" in cat or "anti_tank" in cat or "antiarmor" in cat:
        unit_type = "anti_tank"
    else:
        unit_type = "infantry"
    return unit_type, echelon, side


def presumed_logistics(unit_type: str, echelon: str | None) -> dict:
    """Domniemana logistyka jednostki danego typu/szczebla (~fillFraction zapasów etatowych)."""
    ech = echelon if (echelon in ECHELON_CAPS) else _PRESUMED["defaultEchelon"]
    caps = ECHELON_CAPS[ech]
    f = _PRESUMED["fillFraction"]
    personnel = _PRESUMED["personnelByEchelon"].get(ech, 120)

    log: dict = {
        "personnel_total": personnel,
        "personnel_available": personnel,
        "ammo_small_arms": round(caps["ammoSmallArmsMax"] * f),
        "ammo_at": round(caps["ammoAtMax"] * f),
        "ammo_mortar": round(caps["ammoMortarMax"] * f),
        "fuel_liters": round(caps["fuelCapacityDefault"] * f),
        "fuel_capacity_liters": caps["fuelCapacityDefault"],
        "combat_effectiveness_percent": 100,
    }

    if unit_type == "armor":
        v = _PRESUMED["armorVehiclesByEchelon"].get(ech, {"tanks": 10, "ifv": 6})
        log.update({
            "tanks_total": v["tanks"], "tanks_operational": v["tanks"],
            "ifv_total": v["ifv"], "ifv_operational": v["ifv"],
            "ammo_main": round(caps["ammoMainMax"] * f),
            "ammo_secondary": round(caps["ammoSecondaryMax"] * f),
        })
    elif unit_type == "artillery":
        m = _PRESUMED["mortarsByEchelon"].get(ech, 6)
        log.update({"mortars_total": m, "mortars_operational": m})
    return log


def presumed_logistics_from_class(class_name: str) -> dict:
    unit_type, echelon, _side = parse_class_name(class_name)
    return presumed_logistics(unit_type, echelon)


if __name__ == "__main__":
    for cn in ["EN_Land_unit__Infantry__Company_Battery_Troop",
               "EN_Land_unit__Armor__Battalion_Squadron",
               "EN_Land_unit__Artillery__Company_Battery_Troop"]:
        ut, ech, side = parse_class_name(cn)
        print(f"{cn}\n  -> typ={ut} szczebel={ech} strona={side}")
        print(f"  domniemana: {presumed_logistics(ut, ech)}")
