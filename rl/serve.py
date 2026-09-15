"""
rl.serve — serwis inferencji agenta (kamień M6).

Endpoint POST /agent/decide: przyjmuje stan sceny (jednostki obu stron + strona sterowana),
buduje obserwację identyczną jak w treningu (reużywa rl.env), uruchamia wytrenowaną politykę
i zwraca TRASY (waypointy w EPSG:3857) dla jednostek sterowanej strony. Frontend wpina je w
istniejący mechanizm ruchu — agent nie wprowadza nowej mechaniki walki.

Model dobierany po liczbie jednostek sterowanej strony (1/2/3 → 1v1/2v2/3v3).
Uruchom (w środowisku z SB3+torch):
    python -m rl.serve            # http://localhost:8008

Model abstrakcyjny — polityka symulacyjna, nie realne doradztwo taktyczne.
"""

from __future__ import annotations

import math
import os
import pickle
from functools import lru_cache
from typing import Optional

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rl.env import MicroBattleEnv, _DIRS, _MOVE_LOOKAHEAD_M
from rl.sim import Engagement, Simulation, SimUnit, polygons_overlap
from rl.terrain.grid import TerrainGrid

# Siatka z ESA WorldCover (rl/terrain/export_worldcover.py) — ten sam teren co w grze.
# Stara siatka z kolorów kafelków OSM zostaje zapasem, gdy eksportu jeszcze nie ma.
_WORLDCOVER_GRID = "rl/terrain/data/region_worldcover.npz"
TERRAIN_PATH = os.environ.get(
    "AGENT_TERRAIN",
    _WORLDCOVER_GRID if os.path.exists(_WORLDCOVER_GRID) else "rl/terrain/data/region_otm.npz",
)
# Model attention (6 slotów): obsługuje 1–6 jednostek i nierówne siły (obserwacja tokenowa).
# Trenowany z asymetrią + nagrodą taktyczną → koncentracja przy przewadze, odwrót przy niedoborze,
# skalowanie (5v5/5v3). PPO.load wymaga importu rl.policy (rejestracja ekstraktora).
import rl.policy  # noqa: F401
MODEL_PATH = os.environ.get("AGENT_MODEL", "rl/models/ppo_attn")
AGENT_SLOTS = 6
AGENT_TOKEN_OBS = True
AGENT_AO_HALF = 400.0
# Powyżej tego dystansu (jedn. EPSG:3857) do najbliższego wroga jednostka maszeruje
# wprost na niego (marsz zbliżania); poniżej — decyduje wyuczona polityka (zwarcie).
# WAŻNE: próg musi być MNIEJSZY niż dystans nałożenia AO (~2×półszerokość AO),
# inaczej polityka przejmuje stery zanim dojdzie do kontaktu i jednostki stają w miejscu.
ENGAGE_RANGE = 1200.0
_TERRAIN_PL = {"forest": "las (osłona)", "urban": "teren zabud. (osłona)", "open": "otwarty",
               "road": "droga", "water": "woda", "wetland": "mokradła"}


@lru_cache(maxsize=1)
def _grid() -> TerrainGrid:
    return TerrainGrid.load(TERRAIN_PATH)


@lru_cache(maxsize=4)
def _model():
    from stable_baselines3 import PPO
    model = PPO.load(MODEL_PATH, device="cpu")
    rms = None
    vn = MODEL_PATH + "_vecnorm.pkl"
    if os.path.exists(vn):
        with open(vn, "rb") as fh:
            rms = pickle.load(fh).obs_rms
    return model, rms


# ── Schematy ────────────────────────────────────────────────────────────────

class UnitIn(BaseModel):
    id: str
    side: str                      # "friendly" | "hostile"
    x: float
    y: float                       # EPSG:3857
    unit_type: Optional[str] = "infantry"
    echelon: Optional[str] = "company_battery_troop"
    base_speed_kmh: Optional[float] = 22.0
    logistics: dict = {}


class DecideRequest(BaseModel):
    controlled_side: str
    units: list[UnitIn]


class RouteOut(BaseModel):
    unit_id: str
    waypoints: list[list[float]]   # [[x, y], ...] EPSG:3857
    action: str = "trzymaj"        # rekomendacja: natarcie/trzymaj/odwrót/flankowanie/marsz
    rationale: str = ""            # krótkie uzasadnienie (siły, teren)


class DecideResponse(BaseModel):
    routes: list[RouteOut]
    note: str = "Polityka symulacyjna (abstrakcyjna) — nie realne doradztwo taktyczne."


# ── Logika decyzji ────────────────────────────────────────────────────────────

def _compute_engagements(sim: Simulation) -> dict:
    """Lekka detekcja nakładania AO (dla cechy 'in_engagement' w obserwacji)."""
    f = [u for u in sim.units.values() if u.side == "friendly"]
    h = [u for u in sim.units.values() if u.side == "hostile"]
    fid, hid = [], []
    for a in f:
        for b in h:
            if polygons_overlap(a.ao_polygon(), b.ao_polygon()):
                fid.append(a.id); hid.append(b.id)
    if not fid:
        return {}
    return {("k",): Engagement(tuple(sorted(set(fid))), tuple(sorted(set(hid))), None)}


def decide(req: DecideRequest) -> list[RouteOut]:
    controlled = req.controlled_side
    enemy = "hostile" if controlled == "friendly" else "friendly"
    own = [u for u in req.units if u.side == controlled]
    opp = [u for u in req.units if u.side == enemy]
    if not own:
        return []
    n = AGENT_SLOTS                          # model taktyczny ma 3 sloty (1–3 jedn. + padding)
    model, rms = _model()
    grid = _grid()

    # Buduj SimUnit z ID w schemacie env (f0.., h0..); mapuj na realne ID.
    sim_units: list[SimUnit] = []
    id_map: dict[str, str] = {}

    def add(side: str, src: list[UnitIn]):
        from rl.perception import presumed_logistics
        for k, u in enumerate(src[:n]):
            sid = f"{side[0]}{k}"
            id_map[sid] = u.id
            # Brak logistyki (np. wróg z detekcji) → domniemana siła wg typu/szczebla (M7).
            lg = dict(u.logistics) if u.logistics else presumed_logistics(u.unit_type, u.echelon)
            sim_units.append(SimUnit(
                id=sid, side=side, x=u.x, y=u.y,
                unit_type=u.unit_type or "infantry", echelon=u.echelon or "company_battery_troop",
                base_speed_kmh=u.base_speed_kmh or 22.0, logistics=lg, ao_half=AGENT_AO_HALF,
            ))

    add(controlled, own)
    add(enemy, opp)

    env = MicroBattleEnv(n_per_side=n, controlled_side=controlled, terrain=grid,
                         terrain_patch=True, token_obs=AGENT_TOKEN_OBS)
    env.sim = Simulation(sim_units, grid, np.random.default_rng(0))
    env.sim.engagements = _compute_engagements(env.sim)
    # Okno obserwacji o STAŁYM rozmiarze (jak w treningu) wyśrodkowane na własnych siłach —
    # inaczej przy jednostkach oddalonych o kilometry skala obserwacji rozjeżdża się z treningiem.
    own_sim = [u for u in sim_units if u.side == controlled]
    ccx = sum(u.x for u in own_sim) / len(own_sim)
    ccy = sum(u.y for u in own_sim) / len(own_sim)
    half = env.arena_size / 2
    env._arena = (ccx - half, ccy - half, ccx + half, ccy + half)

    obs = env._obs(self_side=controlled)
    if rms is not None:
        obs = np.clip((obs - rms.mean) / np.sqrt(rms.var + 1e-8), -10.0, 10.0).astype(np.float32)
    act, _ = model.predict(obs, deterministic=True)
    act = np.asarray(act).reshape(-1)

    enemies = [u for u in sim_units if u.side != controlled]
    own_n, enemy_n = len(own), len(opp)
    ratio_txt = ("przewaga" if own_n > enemy_n else "niedobór" if own_n < enemy_n else "równowaga")

    def _rationale(su, action: str) -> str:
        terr = _TERRAIN_PL.get(grid.class_at(su.x, su.y), "otwarty")
        base = f"siły {own_n}:{enemy_n} ({ratio_txt}) · teren: {terr}"
        if action == "odwrót":
            return base + " — wycofaj, zachowaj siły"
        if action == "natarcie" and own_n > enemy_n:
            return base + " — koncentruj na wrogu"
        if action == "trzymaj":
            return base + " — broń pozycji"
        return base

    routes: list[RouteOut] = []
    for i, su in enumerate(env._ordered_side(controlled)):
        if su is None or i >= len(act):
            continue
        real_id = id_map.get(su.id)
        if real_id is None:
            continue
        # Marsz zbliżania: gdy najbliższy wróg jest poza zasięgiem walki (~> ENGAGE_RANGE),
        # jedź wprost na niego. Wyuczona taktyka działa dopiero w zwarciu — agent był trenowany
        # na bliskich starciach (nakładanie AO), nie na marszach na wiele km.
        nearest = min(enemies, key=lambda e: (e.x - su.x) ** 2 + (e.y - su.y) ** 2) if enemies else None
        dist = math.hypot(nearest.x - su.x, nearest.y - su.y) if nearest else 0.0
        if nearest is not None and dist > ENGAGE_RANGE:
            ux, uy = (nearest.x - su.x) / dist, (nearest.y - su.y) / dist
            routes.append(RouteOut(unit_id=real_id, action="natarcie",
                                   rationale=_rationale(su, "natarcie"),
                                   waypoints=[[su.x + ux * _MOVE_LOOKAHEAD_M, su.y + uy * _MOVE_LOOKAHEAD_M]]))
            continue
        a = int(act[i])
        if a == 0:
            routes.append(RouteOut(unit_id=real_id, action="trzymaj",
                                   rationale=_rationale(su, "trzymaj"), waypoints=[]))
            continue
        dx, dy = _DIRS[a - 1]
        # etykieta z geometrii ruchu względem najbliższego wroga
        if nearest is not None and dist > 0:
            tx, ty = (nearest.x - su.x) / dist, (nearest.y - su.y) / dist
            dot = dx * tx + dy * ty
            action = "natarcie" if dot > 0.5 else "odwrót" if dot < -0.5 else "flankowanie"
        else:
            action = "manewr"
        routes.append(RouteOut(
            unit_id=real_id, action=action, rationale=_rationale(su, action),
            waypoints=[[su.x + dx * _MOVE_LOOKAHEAD_M, su.y + dy * _MOVE_LOOKAHEAD_M]],
        ))
    return routes


# ── FastAPI ─────────────────────────────────────────────────────────────────

app = FastAPI(title="GeoTactical RL Agent", version="0.1")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/agent/health")
def health():
    return {"status": "ok", "model": os.path.basename(MODEL_PATH),
            "terrain": os.path.basename(TERRAIN_PATH)}


@app.post("/agent/decide", response_model=DecideResponse)
def agent_decide(req: DecideRequest):
    return DecideResponse(routes=decide(req))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("AGENT_PORT", "8008")))
