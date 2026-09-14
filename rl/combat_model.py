"""
rl.combat_model — wierny port modelu potencjału bojowego z
src/utils/combatPotential.ts. Liczby pochodzą z shared/combat_constants.json
(rl.constants). Parity z TS: rl/parity/test_parity.py.

Abstrakcyjny model symulacyjny — nie realne doradztwo taktyczne.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

from rl.constants import POTENTIAL, ECHELON_CAPS, ATTRITION, CONST

# ── Helpers odwzorowujące semantykę TS ────────────────────────────────────────

_AMMO_CAP_KEYS = (
    "ammoSmallArmsMax", "ammoAtMax", "ammoMortarMax",
    "ammoMainMax", "ammoSecondaryMax", "dronesMax", "fuelCapacityDefault",
)


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """Odpowiednik clamp z TS: NaN/inf → 0, potem ograniczenie do [lo, hi]."""
    if not math.isfinite(v):
        v = 0.0
    return max(lo, min(hi, v))


def _num(log: dict, key: str):
    """Wartość liczbowa lub None (klucz nieobecny == undefined == None)."""
    val = log.get(key)
    return val


def _loose_not_null(log: dict, key: str) -> bool:
    """TS `x != null` (loose): false dla null i undefined."""
    return log.get(key) is not None


def _strict_not_null(log: dict, key: str) -> bool:
    """TS `x !== null` (strict): false TYLKO dla jawnego null; undefined → true."""
    return (key not in log) or (log[key] is not None)


def _safe_ratio(num, denom, fallback: float = 0.0) -> float:
    n = num if num is not None else 0.0
    d = denom if denom is not None else 0.0
    if d <= 0:
        return fallback
    return _clamp(n / d)


def _scaled_ammo(val, cap: float) -> float:
    v = val if val is not None else 0.0
    if cap <= 0:
        return 0.0
    return _clamp(v / cap)


def _personnel_effectiveness(ratio: float) -> float:
    """Piecewise-linear z POTENTIAL.personnelEffectiveness.points (desc po progu)."""
    r = _clamp(ratio)
    points = POTENTIAL["personnelEffectiveness"]["points"]  # [[0.75,1.0],...,[0,0]]
    # points są malejące po progu; znajdź segment [lower, upper] obejmujący r.
    if r >= points[0][0]:
        return points[0][1]
    for i in range(len(points) - 1):
        hi_thr, hi_val = points[i]
        lo_thr, lo_val = points[i + 1]
        if r >= lo_thr:
            span = hi_thr - lo_thr
            if span <= 0:
                return lo_val
            return lo_val + (r - lo_thr) / span * (hi_val - lo_val)
    return _clamp(points[-1][1])


def _resolve_readiness(status: Any) -> float:
    table = POTENTIAL["readiness"]
    key = (status or "").lower() if isinstance(status, str) else ""
    return table.get(key, table["default"])


def _echelon_caps(echelon: Any) -> dict:
    if not echelon or not isinstance(echelon, str):
        return {}
    return ECHELON_CAPS.get(echelon.lower(), {})


def _merge_caps(echelon: Any) -> dict:
    """DEFAULT_POTENTIAL_CONFIG.defaults nadpisane przez ECHELON_CAPS[echelon]."""
    cfg = dict(POTENTIAL["defaults"])
    cfg.update({k: v for k, v in _echelon_caps(echelon).items() if k in _AMMO_CAP_KEYS})
    return cfg


# ── Klasyfikacja jednostki (port classifyUnitType z attritionRules.ts) ─────────

_ARMOR_RE = re.compile(CONST["classification"]["armorTypeKeywords"])
_ARTILLERY_RE = re.compile(CONST["classification"]["artilleryTypeKeywords"])
_ANTI_TANK_RE = re.compile(CONST["classification"]["antiTankTypeKeywords"])


def classify_unit_type(unit: dict) -> str:
    t = (unit.get("unit_type") or "").lower()
    if t == "armor":
        return "armor"
    if t == "artillery":
        return "artillery"
    name = (unit.get("symbol_name") or "").lower()
    if _ARMOR_RE.search(name):
        return "armor"
    if _ARTILLERY_RE.search(name):
        return "artillery"
    if _ANTI_TANK_RE.search(name):
        return "anti_tank"
    return "infantry"


# ── Wynik ─────────────────────────────────────────────────────────────────────

@dataclass
class UnitPotentialResult:
    unitId: str
    unitName: str
    breakdown: dict[str, Any]


# ── Teren: klasa albo rozkład klas (port dominantTerrain / terrainModifierFor) ──

_TERRAIN_ORDER = ("forest", "water", "wetland", "urban", "road", "open")


def _dominant_terrain(terrain: str | dict) -> str:
    """Klasa o największym udziale (remis → kolejność _TERRAIN_ORDER, pusty → open)."""
    if isinstance(terrain, str):
        return terrain
    best, best_share = "open", 0.0
    for c in _TERRAIN_ORDER:
        s = terrain.get(c) or 0.0
        if s > best_share:
            best, best_share = c, s
    return best


def _terrain_modifier(table: dict, terrain: str | dict) -> float:
    """Dla rozkładu — średnia z tabeli ważona udziałami klas."""
    if isinstance(terrain, str):
        return table.get(terrain, 1.0)
    total = 0.0
    acc = 0.0
    for c in _TERRAIN_ORDER:
        s = terrain.get(c) or 0.0
        if s > 0:
            total += s
            acc += s * table.get(c, 1.0)
    return acc / total if total > 0 else table.get("open", 1.0)


# ── Główna funkcja (port computeUnitPotential) ─────────────────────────────────

def compute_unit_potential(
    unit: dict,
    terrain: str | dict = "open",
    role: str = "neutral",
) -> UnitPotentialResult:
    caps = _merge_caps(unit.get("echelon"))
    weights = POTENTIAL["categoryWeights"]
    log = unit.get("logistics") or {}

    # Fuel
    cap_l = log.get("fuel_capacity_liters")
    fuel_cap = cap_l if (cap_l is not None and cap_l > 0) else caps["fuelCapacityDefault"]
    fuel_percent = _safe_ratio(log.get("fuel_liters"), fuel_cap, POTENTIAL["fuelMissingRatioFallback"])
    fuel_empty = _loose_not_null(log, "fuel_liters") and log["fuel_liters"] <= 0

    # Statusy
    readiness = _resolve_readiness(unit.get("readiness_status"))
    ce_raw = log.get("combat_effectiveness_percent")
    ce_modifier = _clamp(ce_raw / 100) if (ce_raw is not None and ce_raw > 0) else 1.0

    # infantry
    personnel_ratio = _safe_ratio(log.get("personnel_available"), log.get("personnel_total"), 0.5)
    ammo_infantry = _scaled_ammo(log.get("ammo_small_arms"), caps["ammoSmallArmsMax"])
    avail = log.get("personnel_available") or 0
    thr = POTENTIAL["infantry"]["ammoPerSoldierThreshold"]
    ammo_per_soldier = _clamp((log.get("ammo_small_arms") or 0) / avail / thr) if avail > 0 else 1.0
    infantry_raw = _clamp(personnel_ratio * ammo_infantry * ammo_per_soldier * readiness * ce_modifier)

    # armor
    armored_total = (log.get("tanks_total") or 0) + (log.get("ifv_total") or 0)
    armored_op = (log.get("tanks_operational") or 0) + (log.get("ifv_operational") or 0)
    vehicle_ratio = _safe_ratio(armored_op, armored_total, 0.5) if (armored_total > 0 and not fuel_empty) else 0.0
    ammo_armor = (
        _scaled_ammo(log.get("ammo_main"), caps["ammoMainMax"]) * POTENTIAL["armor"]["ammoMainWeight"]
        + _scaled_ammo(log.get("ammo_secondary"), caps["ammoSecondaryMax"]) * POTENTIAL["armor"]["ammoSecondaryWeight"]
    )
    has_armor_ammo_data = _strict_not_null(log, "ammo_main") or _strict_not_null(log, "ammo_secondary")
    has_any_ammo = (
        (log.get("ammo_small_arms") or 0) > 0
        or (log.get("ammo_at") or 0) > 0
        or (log.get("ammo_mortar") or 0) > 0
        or (log.get("ammo_main") or 0) > 0
        or (log.get("ammo_secondary") or 0) > 0
    )
    effective_ammo_armor = ammo_armor if has_armor_ammo_data else (POTENTIAL["armor"]["noDataAmmoAssume"] if has_any_ammo else 0.0)
    armor_raw = _clamp(vehicle_ratio * effective_ammo_armor * fuel_percent)

    # artillery
    mortar_ratio = _safe_ratio(log.get("mortars_operational"), log.get("mortars_total"), 0.5) if (log.get("mortars_total") or 0) > 0 else 0.0
    arm_art_ratio = _safe_ratio(log.get("armored_artillery_operational"), log.get("armored_artillery_total"), 0.5) if ((log.get("armored_artillery_total") or 0) > 0 and not fuel_empty) else 0.0
    indirect_floor = 0.0 if fuel_empty else POTENTIAL["artillery"]["indirectFloor"]
    indirect_cap = max(mortar_ratio, arm_art_ratio, indirect_floor)
    ammo_mortar_score = _scaled_ammo(log.get("ammo_mortar"), caps["ammoMortarMax"])
    artillery_raw = _clamp(ammo_mortar_score * indirect_cap * personnel_ratio * readiness)

    # anti_air / air
    ammo_at = _scaled_ammo(log.get("ammo_at"), caps["ammoAtMax"])
    drone_recon = _safe_ratio(log.get("drones_available"), log.get("drones_total"), 0.0)
    anti_air_raw = _clamp(ammo_at * POTENTIAL["antiAir"]["atWeight"] + drone_recon * POTENTIAL["antiAir"]["droneWeight"])
    air_raw = _clamp(drone_recon)

    # static
    static_potential = (
        infantry_raw * weights["infantry"]
        + armor_raw * weights["armor"]
        + artillery_raw * weights["artillery"]
        + anti_air_raw * weights["anti_air"]
        + air_raw * weights["air"]
    )

    # modyfikatory
    readiness_modifier = readiness
    personnel_modifier = _personnel_effectiveness(personnel_ratio)
    mob = POTENTIAL["mobility"]
    base_speed = unit.get("base_speed_kmh")
    if base_speed is None:
        base_speed = mob["defaultSpeedKmh"]
    mobility_modifier = _clamp(
        (base_speed / mob["speedRefKmh"]) * mob["speedWeight"]
        + vehicle_ratio * mob["vehicleWeight"]
        + fuel_percent * mob["fuelWeight"]
    )

    if role == "attacker":
        terrain_table = POTENTIAL["terrainModifiersAttacker"]
    elif role == "defender":
        terrain_table = POTENTIAL["terrainModifiersDefender"]
    else:
        terrain_table = POTENTIAL["terrainModifiers"]
    clamp_lo, clamp_hi = POTENTIAL["terrainModifierClamp"]
    terrain_modifier = _clamp(_terrain_modifier(terrain_table, terrain), clamp_lo, clamp_hi)
    ce_modifier_final = ce_modifier

    effective_potential = _clamp(
        static_potential * readiness_modifier * personnel_modifier
        * mobility_modifier * terrain_modifier * ce_modifier_final,
        0.0, math.inf,
    )

    name = unit.get("custom_name") or unit.get("symbol_name") or unit.get("id")
    breakdown = {
        "infantry": infantry_raw,
        "armor": armor_raw,
        "artillery": artillery_raw,
        "anti_air": anti_air_raw,
        "air": air_raw,
        "readinessModifier": readiness_modifier,
        "personnelModifier": personnel_modifier,
        "mobilityModifier": mobility_modifier,
        "terrainModifier": terrain_modifier,
        "combatEffectivenessModifier": ce_modifier_final,
        "staticPotential": static_potential,
        "effectivePotential": effective_potential,
        "role": role,
        "terrain": _dominant_terrain(terrain),
    }
    if isinstance(terrain, dict):
        breakdown["terrainMix"] = terrain
    return UnitPotentialResult(unitId=unit.get("id"), unitName=name, breakdown=breakdown)


# ── Atrycja (port attritionRules.ts) ───────────────────────────────────────────

def build_attacker_profile(
    breakdowns: list[dict],
    ammo_at_by_unit_id: dict[str, float],
    unit_ids: list[str],
    unit_map: dict[str, dict] | None = None,
) -> dict:
    ap = ATTRITION["attackerProfile"]
    total_static = sum(b["staticPotential"] for b in breakdowns)
    if total_static <= 0:
        return {"armorShare": 0.0, "artilleryShare": 0.0, "antiTankShare": 0.0,
                "hasEffectiveAT": False, "hasArmoredVehicles": False}
    armor_contrib = sum(b["armor"] * ap["armorWeight"] for b in breakdowns)
    art_contrib = sum(b["artillery"] * ap["artilleryWeight"] for b in breakdowns)
    at_contrib = sum(b["anti_air"] * ap["antiAirWeight"] for b in breakdowns)
    has_effective_at = any((ammo_at_by_unit_id.get(i) or 0) > ap["effectiveAtAmmoThreshold"] for i in unit_ids)
    has_armored = bool(unit_map) and any(
        ((unit_map.get(i, {}).get("logistics") or {}).get("tanks_operational") or 0)
        + ((unit_map.get(i, {}).get("logistics") or {}).get("ifv_operational") or 0) > 0
        for i in unit_ids
    )
    return {
        "armorShare": armor_contrib / total_static,
        "artilleryShare": art_contrib / total_static,
        "antiTankShare": at_contrib / total_static,
        "hasEffectiveAT": has_effective_at,
        "hasArmoredVehicles": has_armored,
    }


def compute_attrition_raw(def_unit: dict, base_loss: float, profile: dict) -> dict:
    """Deterministyczne (przed zaokrągleniem) straty — port computeAttritionRaw z TS."""
    log = def_unit.get("logistics") or {}
    cls = classify_unit_type(def_unit)

    personnel_total = log.get("personnel_total") or 0
    tanks_op = log.get("tanks_operational") or 0
    ifv_op = log.get("ifv_operational") or 0
    arm_art_op = log.get("armored_artillery_operational") or 0
    mortars_op = log.get("mortars_operational") or 0
    drones_avail = log.get("drones_available") or 0
    op_vehicles = tanks_op + ifv_op + arm_art_op

    vkf = ATTRITION["vehicleKillFactor"]
    if profile["hasArmoredVehicles"]:
        vehicle_kill_factor = vkf["armorAndAt"] if profile["hasEffectiveAT"] else vkf["armorNoAt"]
    else:
        vehicle_kill_factor = vkf["noArmorAt"] if profile["hasEffectiveAT"] else vkf["noArmorNoAt"]

    own_armored_op = tanks_op + ifv_op
    has_own_armor = own_armored_op > 0
    armor_protection = ATTRITION["armorProtectionFactor"] if (own_armored_op > 0 and cls != "armor") else 1.0
    has_indirect_fire = mortars_op > 0 or arm_art_op > 0

    cr = ATTRITION["classRules"][cls]
    if cls == "infantry":
        personnel_mult = cr["personnelMultBase"] * (
            1 + profile["armorShare"] * cr["armorShareWeight"] + profile["artilleryShare"] * cr["artilleryShareWeight"]
        )
        personnel_loss = base_loss * personnel_total * personnel_mult * armor_protection
        tank_loss = base_loss * tanks_op * cr["tankLossWeight"] * vehicle_kill_factor
        ifv_loss = base_loss * ifv_op * cr["ifvLossWeight"] * vehicle_kill_factor
        arm_art_loss = base_loss * arm_art_op * cr["armArtLossWeight"] * vehicle_kill_factor
        ammo_main_burn = 0.0
        ammo_secondary_burn = 0.0
        ce_drop = base_loss * cr["ceDropMult"] * armor_protection
    elif cls == "armor":
        vehicle_mult = cr["vehicleMultBase"] + profile["armorShare"] * cr["armorShareWeight"]
        personnel_loss = base_loss * personnel_total * cr["personnelWeight"]
        tank_loss = base_loss * tanks_op * vehicle_mult * vehicle_kill_factor
        ifv_loss = base_loss * ifv_op * vehicle_mult * vehicle_kill_factor
        arm_art_loss = base_loss * arm_art_op * vehicle_mult * vehicle_kill_factor
        ammo_main_burn = base_loss * cr["ammoMainBurn"] if has_own_armor else 0.0
        ammo_secondary_burn = base_loss * cr["ammoSecondaryBurn"] if has_own_armor else 0.0
        ce_drop = base_loss * cr["ceDropMult"]
    elif cls == "artillery":
        personnel_loss = base_loss * personnel_total * cr["personnelWeight"] * armor_protection
        tank_loss = base_loss * tanks_op * cr["tankLossWeight"] * vehicle_kill_factor
        ifv_loss = base_loss * ifv_op * cr["ifvLossWeight"] * vehicle_kill_factor
        arm_art_loss = base_loss * arm_art_op * cr["armArtLossWeight"] * vehicle_kill_factor
        ammo_main_burn = base_loss * cr["ammoMainBurn"] if has_own_armor else 0.0
        ammo_secondary_burn = base_loss * cr["ammoSecondaryBurn"] if has_own_armor else 0.0
        ce_drop = base_loss * cr["ceDropMult"] * armor_protection
    else:  # anti_tank
        personnel_loss = base_loss * personnel_total * cr["personnelWeight"] * armor_protection
        tank_loss = base_loss * tanks_op * cr["tankLossWeight"] * vehicle_kill_factor
        ifv_loss = base_loss * ifv_op * cr["ifvLossWeight"] * vehicle_kill_factor
        arm_art_loss = base_loss * arm_art_op * cr["armArtLossWeight"] * vehicle_kill_factor
        ammo_main_burn = 0.0
        ammo_secondary_burn = 0.0
        ce_drop = base_loss * cr["ceDropMult"] * armor_protection

    fuel_burn = op_vehicles * ATTRITION["combatFuelPerVehicle"][cls]
    return {
        "personnelLoss": personnel_loss,
        "tankLoss": tank_loss,
        "ifvLoss": ifv_loss,
        "armoredArtilleryLoss": arm_art_loss,
        "mortarLoss": base_loss * mortars_op * ATTRITION["mortarLossRate"],
        "droneLoss": base_loss * drones_avail * ATTRITION["droneLossRate"],
        "ammoSmallArmsBurn": base_loss * ATTRITION["saRate"][cls],
        "ammoMainBurn": ammo_main_burn,
        "ammoSecondaryBurn": ammo_secondary_burn,
        "ammoAtBurn": base_loss * ATTRITION["atRate"][cls],
        "mortarAmmoBurn": base_loss * ATTRITION["mortarAmmoRate"][cls] if has_indirect_fire else 0.0,
        "fuelBurn": fuel_burn,
        "ceDrop": ce_drop,
    }


def _stoch_round(raw: float, rng) -> int:
    """Stochastyczne zaokrąglenie (jak stochRound w TS), z wstrzykniętym RNG."""
    if raw <= 0:
        return 0
    floor = math.floor(raw)
    return floor + (1 if rng.random() < (raw - floor) else 0)


def compute_attrition_components(def_unit: dict, base_loss: float, profile: dict, rng) -> dict:
    """Straty całkowite (po zaokrągleniu) — środowisko używa wstrzykniętego, seedowalnego RNG."""
    raw = compute_attrition_raw(def_unit, base_loss, profile)
    kia_share = ATTRITION["kiaShare"]
    personnel_loss = _stoch_round(raw["personnelLoss"], rng)
    personnel_dead = _stoch_round(personnel_loss * kia_share, rng)
    return {
        "personnelLoss": personnel_loss,
        "personnelDead": personnel_dead,
        "personnelWounded": personnel_loss - personnel_dead,
        "tankLoss": _stoch_round(raw["tankLoss"], rng),
        "ifvLoss": _stoch_round(raw["ifvLoss"], rng),
        "armoredArtilleryLoss": _stoch_round(raw["armoredArtilleryLoss"], rng),
        "mortarLoss": _stoch_round(raw["mortarLoss"], rng),
        "droneLoss": _stoch_round(raw["droneLoss"], rng),
        "ammoSmallArmsBurn": _stoch_round(raw["ammoSmallArmsBurn"], rng),
        "ammoMainBurn": _stoch_round(raw["ammoMainBurn"], rng),
        "ammoSecondaryBurn": _stoch_round(raw["ammoSecondaryBurn"], rng),
        "ammoAtBurn": _stoch_round(raw["ammoAtBurn"], rng),
        "mortarAmmoBurn": _stoch_round(raw["mortarAmmoBurn"], rng),
        "fuelBurn": raw["fuelBurn"],
        "ceDrop": raw["ceDrop"],
    }


def apply_attrition_components(unit: dict, c: dict) -> dict:
    """Zastosuj straty do logistyki jednostki (port applyAttritionComponents)."""
    log = unit.get("logistics")
    if not log:
        return unit
    new_log = dict(log)
    new_log["personnel_available"] = max(0, (log.get("personnel_available") or 0) - c["personnelLoss"])
    new_log["personnel_dead"] = (log.get("personnel_dead") or 0) + c["personnelDead"]
    new_log["personnel_wounded"] = (log.get("personnel_wounded") or 0) + c["personnelWounded"]
    new_log["tanks_operational"] = max(0, (log.get("tanks_operational") or 0) - c["tankLoss"])
    new_log["ifv_operational"] = max(0, (log.get("ifv_operational") or 0) - c["ifvLoss"])
    new_log["armored_artillery_operational"] = max(0, (log.get("armored_artillery_operational") or 0) - c["armoredArtilleryLoss"])
    new_log["mortars_operational"] = max(0, (log.get("mortars_operational") or 0) - c["mortarLoss"])
    new_log["drones_available"] = max(0, (log.get("drones_available") or 0) - c["droneLoss"])
    new_log["ammo_small_arms"] = max(0, (log.get("ammo_small_arms") or 0) - c["ammoSmallArmsBurn"])
    new_log["ammo_main"] = max(0, log["ammo_main"] - c["ammoMainBurn"]) if log.get("ammo_main") is not None else None
    new_log["ammo_secondary"] = max(0, log["ammo_secondary"] - c["ammoSecondaryBurn"]) if log.get("ammo_secondary") is not None else None
    new_log["ammo_at"] = max(0, (log.get("ammo_at") or 0) - c["ammoAtBurn"])
    new_log["ammo_mortar"] = max(0, (log.get("ammo_mortar") or 0) - c["mortarAmmoBurn"])
    new_log["fuel_liters"] = max(0, (log.get("fuel_liters") or 0) - c["fuelBurn"])
    new_log["combat_effectiveness_percent"] = max(0, (log.get("combat_effectiveness_percent") if log.get("combat_effectiveness_percent") is not None else 100) - c["ceDrop"])
    return {**unit, "logistics": new_log}


def compute_movement_fuel_burn(unit: dict, distance_meters: float) -> float:
    if distance_meters <= 0:
        return 0.0
    return distance_meters / 1000.0 * CONST["movementFuelBurnPerKm"][classify_unit_type(unit)]


def is_unit_destroyed(unit: dict) -> bool:
    if unit.get("readiness_status") == "destroyed":
        return True
    log = unit.get("logistics")
    if not log:
        return False
    return (log.get("personnel_available") or 0) <= 0
