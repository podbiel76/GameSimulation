"""
behavior_check.py — behawioralna walidacja modelu attention (ppo_attn).

Mierzy:
  1. Kierunek decyzji polityki w zwarciu: koncentracja (3v1) / odwrót (1v3).
  2. Wyniki epizodów wg układu sił — w tym SKALOWANIE (5v5, 5v3, 3v5),
     czego stary 3-slotowy model nie obsługiwał.

    python -m rl.behavior_check
"""
from __future__ import annotations

import math

import numpy as np
from stable_baselines3 import PPO

import rl.policy  # noqa: F401  — rejestracja UnitAttentionExtractor dla PPO.load
from rl.env import MicroBattleEnv, _DIRS
from rl.sim import Simulation, SimUnit
from rl.terrain.grid import TerrainGrid

GRID = TerrainGrid.load("rl/terrain/data/region_otm.npz")
MODEL = PPO.load("rl/models/ppo_attn", device="cpu")
SLOTS = 6          # model attention: 6 slotów na stronę
TOKEN_OBS = True
LG = {"personnel_total": 120, "personnel_available": 120, "ammo_small_arms": 4000,
      "ammo_at": 20, "ammo_mortar": 250, "fuel_liters": 2000, "combat_effectiveness_percent": 100}


def _mk_units(k_own, k_enemy, cx, cy, sep):
    units = []
    for k in range(k_own):
        units.append(SimUnit(id=f"f{k}", side="friendly", x=cx - sep / 2,
                             y=cy + (k - (k_own - 1) / 2) * 450, unit_type="infantry",
                             echelon="company_battery_troop", base_speed_kmh=22.0,
                             logistics=dict(LG), ao_half=400.0))
    for k in range(k_enemy):
        units.append(SimUnit(id=f"h{k}", side="hostile", x=cx + sep / 2,
                             y=cy + (k - (k_enemy - 1) / 2) * 450, unit_type="infantry",
                             echelon="company_battery_troop", base_speed_kmh=22.0,
                             logistics=dict(LG), ao_half=400.0))
    return units


def _env():
    return MicroBattleEnv(n_per_side=SLOTS, terrain=GRID, terrain_patch=True, token_obs=TOKEN_OBS)


def _act(env):
    obs = env._obs(self_side="friendly")
    a, _ = MODEL.predict(obs, deterministic=True)
    return np.asarray(a).reshape(-1)


def direction_test(k_own, k_enemy, seeds=60, sep=1200):
    toward = away = hold = 0
    for s in range(seeds):
        units = _mk_units(k_own, k_enemy, 2360000.0, 7050000.0, sep)
        env = _env(); env.sim = Simulation(units, GRID, np.random.default_rng(s))
        own = [u for u in units if u.side == "friendly"]
        half = env.arena_size / 2
        ccx = sum(u.x for u in own) / len(own); ccy = sum(u.y for u in own) / len(own)
        env._arena = (ccx - half, ccy - half, ccx + half, ccy + half)
        act = _act(env)
        en = [u for u in units if u.side == "hostile"]
        ecx = sum(u.x for u in en) / len(en); ecy = sum(u.y for u in en) / len(en)
        for i, u in enumerate(env._ordered_side("friendly")):
            if u is None:
                continue
            a = int(act[i])
            if a == 0:
                hold += 1; continue
            dx, dy = _DIRS[a - 1]
            tx, ty = ecx - u.x, ecy - u.y; d = math.hypot(tx, ty) or 1.0
            dot = (dx * tx + dy * ty) / d
            if dot > 0.2: toward += 1
            elif dot < -0.2: away += 1
            else: hold += 1
    tot = max(1, toward + away + hold)
    return toward / tot, away / tot, hold / tot


def outcome_test(k_own, k_enemy, episodes=60):
    wins = own_surv = enemy_surv = 0
    for ep in range(episodes):
        env = _env(); env.asymmetric = False
        env._k_own, env._k_enemy = k_own, k_enemy
        obs, _ = env.reset(seed=5000 + ep)
        env._k_own, env._k_enemy = k_own, k_enemy
        env.sim = Simulation(env._spawn(), GRID, env.rng)
        obs = env._obs(self_side="friendly")
        done = False; info = {}
        while not done:
            a, _ = MODEL.predict(obs, deterministic=True)
            obs, _r, t, tr, info = env.step(a); done = t or tr
        if info.get("winner") == "friendly": wins += 1
        own_surv += len(env.sim.side_units("friendly"))
        enemy_surv += len(env.sim.side_units("hostile"))
    return wins / episodes, own_surv / episodes, enemy_surv / episodes


if __name__ == "__main__":
    print("== KIERUNEK DECYZJI (zwarcie) ==")
    for label, (ko, ke) in [("3v1", (3, 1)), ("2v2", (2, 2)), ("1v3", (1, 3))]:
        tw, aw, hd = direction_test(ko, ke)
        print(f"  {label}: ku wrogowi={tw:.0%}  od wroga={aw:.0%}  trzyma={hd:.0%}")
    print("\n== WYNIKI / SKALOWANIE (śr. ocaleni / epizod) ==")
    for label, (ko, ke) in [("3v1", (3, 1)), ("2v2", (2, 2)), ("1v3", (1, 3)),
                            ("5v5", (5, 5)), ("5v3", (5, 3)), ("3v5", (3, 5))]:
        wr, os, es = outcome_test(ko, ke)
        print(f"  {label}: winrate={wr:.0%}  wlasni={os:.2f}/{ko}  wrog={es:.2f}/{ke}")
