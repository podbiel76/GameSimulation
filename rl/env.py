"""
rl.env — środowisko Gymnasium nad silnikiem rl.sim (port mechaniki z gry).

MDP v1 (kamień M4 dostraja nagrodę):
  • agent steruje jedną stroną (domyślnie "friendly"), ≤3 jednostki,
  • akcja per jednostka: 0=trzymaj, 1..8 = kierunek ruchu (N, NE, E, SE, S, SW, W, NW),
  • obserwacja: cechy wszystkich jednostek (własne + wrogie), stała długość (padding),
  • nagroda: kształtowanie po różnicy potencjałów + terminalna ±1 za wynik starcia.

Model abstrakcyjny — polityka symulacyjna, nie realne doradztwo taktyczne.
"""

from __future__ import annotations

import math
from typing import Callable, Optional

import numpy as np
import gymnasium as gym
from gymnasium import spaces

from rl.sim import Simulation, SimUnit
from rl.constants import POTENTIAL, SIM
from rl.terrain.grid import TerrainGrid

_TERR_DEF = POTENTIAL["terrainModifiersDefender"]
_TERR_SPEED = SIM["terrainSpeedModifiers"]

# 8 kierunków (N, NE, E, SE, S, SW, W, NW) jako wektory jednostkowe w (x,y) EPSG:3857
_DIRS = [
    (0, 1), (0.7071, 0.7071), (1, 0), (0.7071, -0.7071),
    (0, -1), (-0.7071, -0.7071), (-1, 0), (-0.7071, 0.7071),
]
# Cechy per jednostka: 9 stanu + 2 teren (mod. obronny, mod. prędkości w bieżącej komórce)
_FEATURES_PER_UNIT = 11
_MOVE_LOOKAHEAD_M = 3000.0

# Tryb tokenowy (attention): każdy token-jednostka = wspólny zestaw cech.
# [is_own, alive, x, y, eff_pot, pers_ratio, ammo_sa, fuel, ce, engaged, terr_def, terr_speed]
# (12) + 8-kierunkowy skan terenu obronnego (tylko dla własnych; wróg/padding = 0) = 20.
_TOKEN_BASE = 12
_TOKEN_F = _TOKEN_BASE + len(_DIRS)  # 20


def _default_logistics(personnel: int, sa: int, fuel: float) -> dict:
    return {
        "personnel_total": personnel, "personnel_available": personnel,
        "ammo_small_arms": sa, "ammo_at": 20, "ammo_mortar": 250,
        "fuel_liters": fuel, "combat_effectiveness_percent": 100,
    }


class MicroBattleEnv(gym.Env):
    """Małe starcie (≤N vs N). Agent steruje `controlled_side`, przeciwnik skryptowy."""

    metadata = {"render_modes": []}

    def __init__(
        self,
        n_per_side: int = 1,
        controlled_side: str = "friendly",
        terrain: Optional[TerrainGrid] = None,
        max_decision_steps: int = 300,
        decision_ticks: int = 20,
        opponent_policy: str = "advance",   # "advance" | "static"
        terrain_patch: bool = False,         # lokalny skan terenu (8 kierunków) w obserwacji
        patch_radius_m: float = 500.0,
        arena_size: float = 1800.0,          # rozmiar pola gry [jedn. 3857] — w skali ruchu
        ao_half: float = 400.0,              # półbok AO
        spawn_sep: float = 900.0,            # odległość spawnów stron
        asymmetric: bool = False,            # losowa, różna liczba jednostek per strona (1..n)
        tactical_reward: bool = False,       # nagroda za eliminacje/zachowanie sił (taktyki)
        token_obs: bool = False,             # obserwacja jako zbiór tokenów-jednostek (attention)
        seed: Optional[int] = None,
    ):
        super().__init__()
        self.n = n_per_side
        self.controlled_side = controlled_side
        self.enemy_side = "hostile" if controlled_side == "friendly" else "friendly"
        self.max_decision_steps = max_decision_steps
        self.decision_ticks = decision_ticks
        self.opponent_policy = opponent_policy
        self.terrain_patch = terrain_patch
        self.patch_radius_m = patch_radius_m
        self.arena_size = arena_size
        self.ao_half = ao_half
        self.spawn_sep = spawn_sep
        self.asymmetric = asymmetric
        self.tactical_reward = tactical_reward
        self.token_obs = token_obs
        self._k_own = n_per_side
        self._k_enemy = n_per_side
        # Self-play: przeciwnik prowadzony modelem (zamiast skryptu). Ustawiane przez
        # set_opponent_model(); wtedy opponent_policy="model".
        self._opponent_model = None
        self._opponent_obs_rms = None

        grid_bbox = (0.0, 0.0, 10000.0, 10000.0)
        self.terrain = terrain or TerrainGrid.synthetic(grid_bbox, 64, 64, seed=1)
        self._grid_bbox = (self.terrain.minx, self.terrain.miny, self.terrain.maxx, self.terrain.maxy)
        # arena per epizod (losowane w reset); domyślnie środek siatki
        gx0, gy0, gx1, gy1 = self._grid_bbox
        self._arena = (gx0, gy0, gx0 + arena_size, gy0 + arena_size)

        self.rng = np.random.default_rng(seed)
        self.sim: Optional[Simulation] = None
        self._dstep = 0
        self._prev_diff = 0.0

        if self.token_obs:
            # macierz tokenów: (MAX_OWN + MAX_ENEMY, F); maska "alive" jest cechą tokena
            self.observation_space = spaces.Box(
                low=-1.0, high=2.0, shape=(self.n * 2, _TOKEN_F), dtype=np.float32
            )
        else:
            slots = self.n * 2
            obs_dim = slots * _FEATURES_PER_UNIT + (self.n * len(_DIRS) if self.terrain_patch else 0)
            self.observation_space = spaces.Box(
                low=-1.0, high=2.0, shape=(obs_dim,), dtype=np.float32
            )
        self.action_space = spaces.MultiDiscrete([len(_DIRS) + 1] * self.n)

    # ── budowa scenariusza ──────────────────────────────────────────────────
    def _spawn(self) -> list[SimUnit]:
        ax0, ay0, ax1, ay1 = self._arena
        cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
        half_sep = self.spawn_sep / 2
        lateral = self.arena_size * 0.22
        # LOSOWA ORIENTACJA: oś własni↔wróg pod losowym kątem (nie zawsze W↔E).
        # Bez tego policy nie generalizuje rotacyjnie — w grze wróg bywa z każdej strony,
        # a agent wyuczony tylko na "wróg na wschodzie" myli kierunki (wygląda jak ucieczka).
        phi = float(self.rng.uniform(0, 2 * math.pi))
        ax_dx, ax_dy = math.cos(phi), math.sin(phi)          # kierunek do wroga
        px, py = -math.sin(phi), math.cos(phi)               # oś prostopadła (rozstaw jednostek)
        units = []
        counts = {self.controlled_side: self._k_own, self.enemy_side: self._k_enemy}
        for side, sign in ((self.controlled_side, -1), (self.enemy_side, +1)):
            cnt = counts[side]
            for k in range(cnt):
                off = (k - (cnt - 1) / 2) * lateral
                jitter_x = float(self.rng.uniform(-self.arena_size * 0.05, self.arena_size * 0.05))
                jitter_y = float(self.rng.uniform(-self.arena_size * 0.05, self.arena_size * 0.05))
                x = cx + sign * half_sep * ax_dx + off * px + jitter_x
                y = cy + sign * half_sep * ax_dy + off * py + jitter_y
                # Symetryczna, stała logistyka obu stron → o wyniku decyduje TAKTYKA
                # (pozycja, teren, rola atakujący/obrońca), nie losowa przewaga sił.
                # To kluczowe dla uczenia: czysty sygnał akcja→wynik, bez szumu spawnu.
                units.append(SimUnit(
                    id=f"{side[0]}{k}", side=side, x=x, y=y, unit_type="infantry",
                    echelon="company_battery_troop", base_speed_kmh=22.0,
                    logistics=_default_logistics(100, 4000, 2000.0), ao_half=self.ao_half,
                ))
        return units

    # ── Gymnasium API ─────────────────────────────────────────────────────────
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        # Losowa arena w obrębie siatki terenu → różny teren co epizod (generalizacja).
        gx0, gy0, gx1, gy1 = self._grid_bbox
        ox = float(self.rng.uniform(gx0, max(gx0, gx1 - self.arena_size)))
        oy = float(self.rng.uniform(gy0, max(gy0, gy1 - self.arena_size)))
        self._arena = (ox, oy, ox + self.arena_size, oy + self.arena_size)
        # Asymetria sił: różna liczba jednostek per strona → uczy KIEDY atakować (przewaga)
        # i KIEDY się wycofać (niedobór). Bez tego (symetria) te taktyki się nie pojawiają.
        if self.asymmetric:
            self._k_own = int(self.rng.integers(1, self.n + 1))
            self._k_enemy = int(self.rng.integers(1, self.n + 1))
        else:
            self._k_own = self._k_enemy = self.n
        self.sim = Simulation(self._spawn(), self.terrain, self.rng)
        self._dstep = 0
        self._prev_diff = self._potential_diff()
        return self._obs(), {}

    def step(self, action):
        self._apply_actions(self.controlled_side, np.asarray(action).reshape(-1))
        self._apply_opponent_policy()

        own_before = len(self.sim.side_units(self.controlled_side))
        enemy_before = len(self.sim.side_units(self.enemy_side))

        for _ in range(self.decision_ticks):
            self.sim.step_tick()
            if self.sim.winner() is not None:
                break
        self._dstep += 1

        winner = self.sim.winner()
        terminated = winner is not None
        truncated = self._dstep >= self.max_decision_steps and not terminated

        diff = self._potential_diff()
        reward = 0.3 * float(diff - self._prev_diff)   # kształtowanie po różnicy potencjałów
        self._prev_diff = diff

        if self.tactical_reward:
            # TAKTYKI: + za eliminację wroga (premiuje koncentrację ognia / 2-na-1),
            #          − za stratę własnej jednostki (premiuje zachowanie sił / wycofanie).
            enemy_killed = enemy_before - len(self.sim.side_units(self.enemy_side))
            own_lost = own_before - len(self.sim.side_units(self.controlled_side))
            reward += 0.5 * enemy_killed - 0.5 * own_lost
            if terminated:
                reward += 1.0 if winner == self.controlled_side else (-1.0 if winner == self.enemy_side else -0.3)
            elif truncated:
                # pat NIE jest auto-porażką: wynik wg przewagi → wolno taktycznie się wycofać,
                # zamiast wykrwawiać jednostki w przegranej walce.
                reward += max(-0.5, min(0.5, float(diff)))
        else:
            if terminated:
                reward += 1.0 if winner == self.controlled_side else (-1.0 if winner == self.enemy_side else -0.5)
            elif truncated:
                reward -= 1.0
        reward -= 0.001  # mały koszt czasu

        info = {"winner": winner, "events": list(self.sim.events)}
        return self._obs(), reward, terminated, truncated, info

    # ── zastosuj akcje (kierunki) do jednostek danej strony ─────────────────────
    def _apply_actions(self, side: str, action) -> None:
        units = self._ordered_side(side)
        for i, u in enumerate(units):
            if u is None or i >= len(action):
                continue
            a = int(action[i])
            if a == 0:
                u.target = None
            else:
                dx, dy = _DIRS[a - 1]
                u.target = (u.x + dx * _MOVE_LOOKAHEAD_M, u.y + dy * _MOVE_LOOKAHEAD_M)

    def set_opponent_model(self, model, obs_rms=None) -> None:
        """Ustaw przeciwnika prowadzonego modelem (self-play)."""
        self._opponent_model = model
        self._opponent_obs_rms = obs_rms
        self.opponent_policy = "model"

    # ── przeciwnik: model (self-play) lub skrypt (baseline) ─────────────────────
    def _apply_opponent_policy(self):
        if self.opponent_policy == "model" and self._opponent_model is not None:
            opp_obs = self._obs(self_side=self.enemy_side)
            if self._opponent_obs_rms is not None:
                opp_obs = np.clip(
                    (opp_obs - self._opponent_obs_rms.mean) / np.sqrt(self._opponent_obs_rms.var + 1e-8),
                    -10.0, 10.0,
                ).astype(np.float32)
            act, _ = self._opponent_model.predict(opp_obs, deterministic=False)
            self._apply_actions(self.enemy_side, np.asarray(act).reshape(-1))
            return
        if self.opponent_policy == "static":
            return
        # "advance": jedź na najbliższego przeciwnika (baseline skryptowy)
        enemies = self.sim.side_units(self.enemy_side)
        targets = self.sim.side_units(self.controlled_side)
        if not targets:
            return
        for e in enemies:
            nearest = min(targets, key=lambda t: (t.x - e.x) ** 2 + (t.y - e.y) ** 2)
            dx, dy = nearest.x - e.x, nearest.y - e.y
            d = math.hypot(dx, dy) or 1.0
            e.target = (e.x + dx / d * _MOVE_LOOKAHEAD_M, e.y + dy / d * _MOVE_LOOKAHEAD_M)

    # ── obserwacja / pomocnicze ────────────────────────────────────────────────
    def _ordered_side(self, side: str) -> list[Optional[SimUnit]]:
        """Stałe sloty wg id; None jeśli zniszczona/brak."""
        out: list[Optional[SimUnit]] = []
        for k in range(self.n):
            uid = f"{side[0]}{k}"
            u = self.sim.units.get(uid)
            out.append(u if (u and u.readiness_status != "destroyed"
                             and (u.logistics.get("personnel_available") or 0) > 0) else None)
        return out

    def _potential_diff(self) -> float:
        return (self.sim.side_total_potential(self.controlled_side)
                - self.sim.side_total_potential(self.enemy_side))

    def _unit_token(self, u, is_own: float, include_scan: bool) -> list[float]:
        """Token jednej jednostki (wspólny zestaw cech) dla obserwacji attention."""
        minx, miny, maxx, maxy = self._arena
        w, h = (maxx - minx) or 1.0, (maxy - miny) or 1.0
        engaged = set()
        for eng in self.sim.engagements.values():
            engaged.update(eng.friendly_ids); engaged.update(eng.hostile_ids)
        from rl.combat_model import compute_unit_potential
        terr = self.sim.terrain_at(u)
        bd = compute_unit_potential(u.as_unit_dict(), terr).breakdown
        lg = u.logistics
        feats = [
            is_own, 1.0,
            (u.x - minx) / w, (u.y - miny) / h,
            min(1.0, bd["effectivePotential"]),
            min(1.0, (lg.get("personnel_available") or 0) / max(1, lg.get("personnel_total") or 1)),
            min(1.0, (lg.get("ammo_small_arms") or 0) / 10000.0),
            min(1.0, (lg.get("fuel_liters") or 0) / 2500.0),
            min(1.0, (lg.get("combat_effectiveness_percent") or 0) / 100.0),
            1.0 if u.id in engaged else 0.0,
            _TERR_DEF.get(terr, 1.0) / 1.3,
            _TERR_SPEED.get(terr, 1.0),
        ]
        if include_scan:
            for dx, dy in _DIRS:
                feats.append(_TERR_DEF.get(self.terrain.class_at(u.x + dx * self.patch_radius_m,
                                                                 u.y + dy * self.patch_radius_m), 1.0) / 1.3)
        else:
            feats.extend([0.0] * len(_DIRS))
        return feats

    def _obs_tokens(self, self_side: str) -> np.ndarray:
        other_side = "hostile" if self_side == "friendly" else "friendly"
        rows: list[list[float]] = []
        for u in self._ordered_side(self_side):
            rows.append(self._unit_token(u, 1.0, True) if u is not None else [0.0] * _TOKEN_F)
        for u in self._ordered_side(other_side):
            rows.append(self._unit_token(u, 0.0, False) if u is not None else [0.0] * _TOKEN_F)
        return np.asarray(rows, dtype=np.float32)

    def _obs(self, self_side: Optional[str] = None) -> np.ndarray:
        self_side = self_side or self.controlled_side
        if self.token_obs:
            return self._obs_tokens(self_side)
        other_side = "hostile" if self_side == "friendly" else "friendly"
        minx, miny, maxx, maxy = self._arena
        w, h = (maxx - minx) or 1.0, (maxy - miny) or 1.0
        engaged = set()
        for eng in self.sim.engagements.values():
            engaged.update(eng.friendly_ids); engaged.update(eng.hostile_ids)

        feats: list[float] = []
        for side in (self_side, other_side):
            for u in self._ordered_side(side):
                if u is None:
                    feats.extend([0.0] * _FEATURES_PER_UNIT)
                    continue
                from rl.combat_model import compute_unit_potential
                terr = self.sim.terrain_at(u)
                bd = compute_unit_potential(u.as_unit_dict(), terr).breakdown
                lg = u.logistics
                feats.extend([
                    1.0,
                    (u.x - minx) / w,
                    (u.y - miny) / h,
                    min(1.0, bd["effectivePotential"]),
                    min(1.0, (lg.get("personnel_available") or 0) / max(1, lg.get("personnel_total") or 1)),
                    min(1.0, (lg.get("ammo_small_arms") or 0) / 10000.0),
                    min(1.0, (lg.get("fuel_liters") or 0) / 2500.0),
                    min(1.0, (lg.get("combat_effectiveness_percent") or 0) / 100.0),
                    1.0 if u.id in engaged else 0.0,
                    _TERR_DEF.get(terr, 1.0) / 1.3,     # jak dobra osłona obronna tu
                    _TERR_SPEED.get(terr, 1.0),          # jak szybko można się tu poruszać
                ])

        # Lokalny skan terenu: dla każdej jednostki strony "self" mod. obronny w 8 kierunkach
        # (na promieniu patch_radius_m) — pozwala nauczyć się manewru po lepszą osłonę.
        if self.terrain_patch:
            for u in self._ordered_side(self_side):
                if u is None:
                    feats.extend([0.0] * len(_DIRS))
                    continue
                for dx, dy in _DIRS:
                    sx = u.x + dx * self.patch_radius_m
                    sy = u.y + dy * self.patch_radius_m
                    feats.append(_TERR_DEF.get(self.terrain.class_at(sx, sy), 1.0) / 1.3)
        return np.asarray(feats, dtype=np.float32)
