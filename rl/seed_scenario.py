"""
seed_scenario.py — tworzy gotowy scenariusz 2v2 (przez API backendu) do testu agenta.

Dla każdej jednostki: tworzy znacznik, uzupełnia logistykę i rysuje AO (obszar
odpowiedzialności) — bo walka w grze rusza dopiero przy nakładaniu AO. Jednostki
stawiane są w regionie wyeksportowanego terenu (NE Polska), ~1.2 km od siebie.

Wymaga działającego backendu (domyślnie http://localhost:3002).

    python -m rl.seed_scenario                 # 2v2
    python -m rl.seed_scenario --clear         # najpierw usuń istniejące jednostki
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.request

BASE = "http://localhost:3002"
R_MERC = 6378137.0

# Centroid regionu terenu (region_otm): NE Polska
C_LON, C_LAT = 21.2257, 53.3434
HALF_SEP_DEG = 0.024     # ~1.6 km od środka w bok (rozstaw stron ~3.2 km > zasięg → marsz zbliżania)
ROW_DEG = 0.0027         # rozstaw 2 jednostek tej samej strony (N-S, ~0.3 km)
AO_DLON, AO_DLAT = 0.0070, 0.0047   # półbok AO (~0.47 km)

SYM_FRIENDLY = "Land_unit__Infantry__Company_Battery_Troop"
SYM_HOSTILE = "EN_Land_unit__Infantry__Company_Battery_Troop"


def _post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def _patch(path: str, payload: dict) -> dict:
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="PATCH")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def _get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return json.loads(r.read())


def _delete(path: str) -> None:
    req = urllib.request.Request(BASE + path, method="DELETE")
    urllib.request.urlopen(req, timeout=20).read()


def lonlat_to_3857(lon: float, lat: float) -> tuple[float, float]:
    return (R_MERC * math.radians(lon),
            R_MERC * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def ao_ring(lon: float, lat: float) -> list[list[float]]:
    return [
        [lon - AO_DLON, lat - AO_DLAT], [lon + AO_DLON, lat - AO_DLAT],
        [lon + AO_DLON, lat + AO_DLAT], [lon - AO_DLON, lat + AO_DLAT],
        [lon - AO_DLON, lat - AO_DLAT],
    ]


INFANTRY_LOG = {
    "personnel_total": 120, "personnel_available": 120,
    "ammo_small_arms": 4000, "ammo_at": 20, "ammo_mortar": 250,
    "mortars_total": 4, "mortars_operational": 4,
    "fuel_liters": 2000, "combat_effectiveness_percent": 100,
}


def make_unit(name: str, side: str, lon: float, lat: float, number: int) -> str:
    x, y = lonlat_to_3857(lon, lat)
    sym = SYM_FRIENDLY if side == "friendly" else SYM_HOSTILE
    created = _post("/api/units/create", {
        "symbol_id": sym, "symbol_name": "Infantry — Company Battery Troop",
        "side": side, "unit_type": "infantry", "echelon": "company_battery_troop",
        "x": x, "y": y, "position_lon": lon, "position_lat": lat,
        "source": "seed", "unit_number": number, "custom_name": name,
    })
    uid = created["id"]
    _patch(f"/api/units/{uid}/logistics", INFANTRY_LOG)
    _post("/map/unit-areas/polygon", {
        "unit_id": uid, "name": f"AO {name}", "area_type": "responsibility",
        "coordinates": ao_ring(lon, lat),
    })
    print(f"  + {side:8s} {name:8s} @ ({lon:.4f},{lat:.4f})  id={uid[:8]}")
    return uid


def main() -> None:
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--clear", action="store_true", help="usuń istniejące jednostki najpierw")
    ap.add_argument("--friendly", type=int, default=2, help="liczba jednostek sojuszniczych")
    ap.add_argument("--hostile", type=int, default=2, help="liczba jednostek wrogich")
    ap.add_argument("--base", default=BASE)
    args = ap.parse_args()
    BASE = args.base

    if args.clear:
        st = _get("/api/units/full-state")
        for u in st.get("units", []):
            try:
                _delete(f"/api/units/{u['id']}")
            except Exception as e:
                print("  ! nie usunięto", u.get("id"), e)
        print("Wyczyszczono istniejące jednostki.")

    nf, nh = args.friendly, args.hostile
    print(f"Tworzę scenariusz {nf}v{nh} (region NE Polska):")
    # sojusznicy na zachodzie, wróg na wschodzie (orientacja i tak nieistotna — model _rot/taktyczny)
    for k in range(nf):
        lat = C_LAT + (k - (nf - 1) / 2) * 2 * ROW_DEG
        make_unit(f"Alfa{k+1}", "friendly", C_LON - HALF_SEP_DEG, lat, k + 1)
    for k in range(nh):
        lat = C_LAT + (k - (nh - 1) / 2) * 2 * ROW_DEG
        make_unit(f"Wrog{k+1}", "hostile", C_LON + HALF_SEP_DEG, lat, k + 1)
    print("\nGotowe. W aplikacji: wycentruj na NE Polske (Orzysz/Pisz), Uruchom symulacje, "
          "wlacz panel Agent AI -> Oba (AI vs AI).")


if __name__ == "__main__":
    main()
