"""
rl.sim — bezgłowy silnik symulacji (port logiki z src/hooks/useLocalSimulation.ts).

Operuje na czystym stanie (bez React/OpenLayers). Wszystkie współrzędne w EPSG:3857
(metry) — pozycje jednostek, wielokąty AO i siatka terenu w jednym układzie.

Mechanika 1:1 z grą: ruch po trasie, wykrywanie starć przez nakładanie AO,
role atakujący/obrońca (zablokowane na starcie starcia), atrycja co
ENGAGEMENT_CHECK_TICKS, trzy warunki porażki. Model abstrakcyjny — nie doradztwo.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from rl.combat_model import (
    apply_attrition_components,
    build_attacker_profile,
    classify_unit_type,
    compute_attrition_components,
    compute_movement_fuel_burn,
    compute_unit_potential,
    is_unit_destroyed,
)
from rl.constants import SIM
from rl.terrain.grid import TerrainGrid

ATTRITION_COEFFICIENT = SIM["attrition_coefficient"]
ENGAGEMENT_CHECK_TICKS = SIM["engagement_check_ticks"]
TICK_MS = SIM["tick_ms"]
SIDE_DEFEAT_DISPLAY = SIM["side_defeat_potential_display"]
TERRAIN_SPEED = SIM["terrainSpeedModifiers"]


# ── Geometria (port geoUtils.ts) ───────────────────────────────────────────────

def point_in_polygon(p: tuple[float, float], poly: list[tuple[float, float]]) -> bool:
    x, y = p
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _seg_intersects(a1, a2, b1, b2) -> bool:
    d1x, d1y = a2[0] - a1[0], a2[1] - a1[1]
    d2x, d2y = b2[0] - b1[0], b2[1] - b1[1]
    cross = d1x * d2y - d1y * d2x
    if abs(cross) < 1e-12:
        return False
    t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / cross
    u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / cross
    return 0 <= t <= 1 and 0 <= u <= 1


def polygons_overlap(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> bool:
    if len(a) < 3 or len(b) < 3:
        return False
    if any(point_in_polygon(p, b) for p in a):
        return True
    if any(point_in_polygon(p, a) for p in b):
        return True
    for i in range(len(a) - 1):
        for j in range(len(b) - 1):
            if _seg_intersects(a[i], a[i + 1], b[j], b[j + 1]):
                return True
    return False


# ── Stan jednostki ─────────────────────────────────────────────────────────────

@dataclass
class SimUnit:
    id: str
    side: str               # "friendly" | "hostile"
    x: float
    y: float
    unit_type: str
    echelon: str
    base_speed_kmh: float
    logistics: dict
    ao_half: float = 1500.0           # półbok kwadratowego AO [m]
    readiness_status: str = "ready"
    target: Optional[tuple[float, float]] = None  # cel ruchu (x,y) lub None

    def ao_polygon(self) -> list[tuple[float, float]]:
        h = self.ao_half
        return [
            (self.x - h, self.y - h), (self.x + h, self.y - h),
            (self.x + h, self.y + h), (self.x - h, self.y + h),
            (self.x - h, self.y - h),
        ]

    def as_unit_dict(self) -> dict:
        return {
            "id": self.id, "side": self.side, "unit_type": self.unit_type,
            "echelon": self.echelon, "base_speed_kmh": self.base_speed_kmh,
            "readiness_status": self.readiness_status, "logistics": self.logistics,
        }


@dataclass
class Engagement:
    friendly_ids: tuple[str, ...]
    hostile_ids: tuple[str, ...]
    attacker_side: Optional[str]  # "friendly" | "hostile" | None


# ── Silnik ──────────────────────────────────────────────────────────────────────

class Simulation:
    def __init__(self, units: list[SimUnit], terrain: TerrainGrid, rng):
        self.units: dict[str, SimUnit] = {u.id: u for u in units}
        self.terrain = terrain
        self.rng = rng
        self.tick = 0
        self.engagements: dict[tuple, Engagement] = {}
        self.events: list[str] = []  # log porażek tej tury

    # --- pomocnicze ---
    def alive(self) -> list[SimUnit]:
        return [u for u in self.units.values() if not is_unit_destroyed(u.as_unit_dict())]

    def side_units(self, side: str) -> list[SimUnit]:
        return [u for u in self.alive() if u.side == side]

    def terrain_at(self, u: SimUnit) -> str:
        return self.terrain.class_at(u.x, u.y)

    # --- ruch ---
    def _move_unit(self, u: SimUnit) -> None:
        if u.target is None:
            return
        tmod = TERRAIN_SPEED.get(self.terrain_at(u), 1.0)
        speed_mpt = u.base_speed_kmh * tmod * 1000.0 / 36000.0  # m na tick
        dx, dy = u.target[0] - u.x, u.target[1] - u.y
        dist = math.hypot(dx, dy)
        if dist <= speed_mpt or dist == 0:
            nx, ny = u.target
            u.target = None
        else:
            nx = u.x + dx / dist * speed_mpt
            ny = u.y + dy / dist * speed_mpt
        moved = math.hypot(nx - u.x, ny - u.y)
        u.x, u.y = nx, ny
        if u.logistics.get("fuel_liters") is not None:
            burn = compute_movement_fuel_burn(u.as_unit_dict(), moved)
            if burn > 0:
                u.logistics["fuel_liters"] = max(0.0, u.logistics["fuel_liters"] - burn)

    # --- wykrywanie starć (port: nakładanie AO + BFS grup bojowych) ---
    def _detect_battle_groups(self) -> list[tuple[set, set]]:
        f_areas = {u.id: u.ao_polygon() for u in self.side_units("friendly")}
        h_areas = {u.id: u.ao_polygon() for u in self.side_units("hostile")}
        f2h: dict[str, set] = {}
        h2f: dict[str, set] = {}
        for fid, fa in f_areas.items():
            for hid, ha in h_areas.items():
                if polygons_overlap(fa, ha):
                    f2h.setdefault(fid, set()).add(hid)
                    h2f.setdefault(hid, set()).add(fid)
        groups, vis_f, vis_h = [], set(), set()
        for start in list(f2h.keys()):
            if start in vis_f:
                continue
            gf, gh, queue = set(), set(), [start]
            while queue:
                fid = queue.pop()
                if fid in vis_f:
                    continue
                vis_f.add(fid); gf.add(fid)
                for hid in f2h.get(fid, ()):
                    if hid in vis_h:
                        continue
                    vis_h.add(hid); gh.add(hid)
                    queue.extend(f2 for f2 in h2f.get(hid, ()) if f2 not in vis_f)
            groups.append((gf, gh))
        return groups

    def _role_for(self, side: str, attacker_side: Optional[str]) -> str:
        if attacker_side is None:
            return "neutral"
        return "attacker" if attacker_side == side else "defender"

    # --- atrycja w jednym sprawdzeniu ---
    def _run_attrition(self) -> None:
        groups = self._detect_battle_groups()
        new_eng: dict[tuple, Engagement] = {}

        for gf, gh in groups:
            f_ids = tuple(sorted(gf)); h_ids = tuple(sorted(gh))
            key = (f_ids, "vs", h_ids)
            prev = self.engagements.get(key)
            if prev is not None:
                attacker_side = prev.attacker_side
            else:
                # nowe starcie — strona w ruchu = atakujący (zablokowane na czas starcia)
                f_moving = any(self.units[i].target is not None for i in f_ids)
                h_moving = any(self.units[i].target is not None for i in h_ids)
                attacker_side = ("friendly" if f_moving and not h_moving
                                 else "hostile" if h_moving and not f_moving else None)
            new_eng[key] = Engagement(f_ids, h_ids, attacker_side)

            # potencjały wg roli
            f_breaks, h_breaks = [], []
            for i in f_ids:
                u = self.units[i]
                f_breaks.append(compute_unit_potential(
                    u.as_unit_dict(), self.terrain_at(u), self._role_for("friendly", attacker_side)).breakdown)
            for i in h_ids:
                u = self.units[i]
                h_breaks.append(compute_unit_potential(
                    u.as_unit_dict(), self.terrain_at(u), self._role_for("hostile", attacker_side)).breakdown)
            f_tot = sum(b["effectivePotential"] for b in f_breaks)
            h_tot = sum(b["effectivePotential"] for b in h_breaks)

            ammo_at = {i: (self.units[i].logistics.get("ammo_at") or 0) for i in (*f_ids, *h_ids)}
            umap = {i: self.units[i].as_unit_dict() for i in (*f_ids, *h_ids)}
            h_profile = build_attacker_profile(h_breaks, ammo_at, list(h_ids), umap)
            f_profile = build_attacker_profile(f_breaks, ammo_at, list(f_ids), umap)

            f_defeated = f_tot * 100 < SIDE_DEFEAT_DISPLAY
            h_defeated = h_tot * 100 < SIDE_DEFEAT_DISPLAY

            for i in f_ids:
                self._apply_to(i, h_tot, h_profile, f_defeated)
            for i in h_ids:
                self._apply_to(i, f_tot, f_profile, h_defeated)

        self.engagements = new_eng

    def _apply_to(self, uid: str, opponent_tot: float, profile: dict, side_defeated: bool) -> None:
        u = self.units[uid]
        base_loss = opponent_tot * ATTRITION_COEFFICIENT
        comps = compute_attrition_components(u.as_unit_dict(), base_loss, profile, self.rng)
        u.logistics = apply_attrition_components(u.as_unit_dict(), comps)["logistics"]
        self._mark_defeated_if_needed(u, side_defeated)

    def _mark_defeated_if_needed(self, u: SimUnit, side_defeated: bool) -> None:
        if u.readiness_status == "destroyed":
            return
        lg = u.logistics
        if (lg.get("personnel_available") or 0) <= 0:
            u.readiness_status = "destroyed"; u.target = None
            self.events.append(f"[ZNISZCZONA] {u.id} — brak ludzi")
        elif side_defeated:
            u.readiness_status = "destroyed"; u.target = None
            self.events.append(f"[PRZEGRANA] {u.id} — potencjał strony poniżej progu")
        elif (lg.get("ammo_small_arms") or 0) <= 0:
            u.readiness_status = "destroyed"; u.target = None
            self.events.append(f"[PODDANIE] {u.id} — brak amunicji piechoty")

    # --- jeden tick symulacji ---
    def step_tick(self) -> None:
        self.events = []
        for u in self.alive():
            self._move_unit(u)
        self.tick += 1
        if self.tick % ENGAGEMENT_CHECK_TICKS == 0:
            self._run_attrition()

    # --- warunek końca / zwycięzca ---
    def winner(self) -> Optional[str]:
        f = len(self.side_units("friendly"))
        h = len(self.side_units("hostile"))
        if f > 0 and h == 0:
            return "friendly"
        if h > 0 and f == 0:
            return "hostile"
        if f == 0 and h == 0:
            return "draw"
        return None

    def side_total_potential(self, side: str) -> float:
        return sum(
            compute_unit_potential(u.as_unit_dict(), self.terrain_at(u)).breakdown["effectivePotential"]
            for u in self.side_units(side)
        )
