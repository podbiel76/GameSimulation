"""
bbox_from_units.py — wylicza region (bbox lon/lat) z jednostek w bieżącym scenariuszu
i wypisuje gotową komendę dla export_terrain.py. Dzięki temu nie musisz ręcznie
odczytywać współrzędnych z mapy.

Wymaga uruchomionego backendu (FastAPI). Domyślnie pyta endpoint full-state.

Użycie:
    python -m rl.terrain.bbox_from_units
    python -m rl.terrain.bbox_from_units --url http://localhost:8000/api/units/full-state
    python -m rl.terrain.bbox_from_units --margin-km 2 --out rl/terrain/data/scenariusz

Jeśli backend jest pod proxy Vite (frontend), zadziała też np.:
    --url http://localhost:5173/api/units/full-state
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.request

R_MERC = 6378137.0
DEFAULT_URL = "http://localhost:8000/api/units/full-state"


def merc_to_lonlat(x: float, y: float) -> tuple[float, float]:
    lon = math.degrees(x / R_MERC)
    lat = math.degrees(2 * math.atan(math.exp(y / R_MERC)) - math.pi / 2)
    return lon, lat


def fetch_units(url: str) -> list[dict]:
    with urllib.request.urlopen(url, timeout=15) as resp:
        data = json.loads(resp.read())
    return data.get("units", data if isinstance(data, list) else [])


def unit_lonlat(u: dict) -> tuple[float, float] | None:
    lon, lat = u.get("position_lon"), u.get("position_lat")
    if lon is not None and lat is not None:
        return float(lon), float(lat)
    x, y = u.get("x"), u.get("y")
    if x is not None and y is not None:
        return merc_to_lonlat(float(x), float(y))
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Wylicz bbox lon/lat z jednostek scenariusza.")
    ap.add_argument("--url", default=DEFAULT_URL, help="endpoint full-state")
    ap.add_argument("--margin-km", type=float, default=2.0, help="margines wokół jednostek")
    ap.add_argument("--out", default="rl/terrain/data/region", help="ścieżka bazowa siatki")
    ap.add_argument("--zoom", type=int, default=16)
    ap.add_argument("--window", type=int, default=16)
    args = ap.parse_args()

    try:
        units = fetch_units(args.url)
    except Exception as e:
        raise SystemExit(
            f"Nie udało się pobrać {args.url}: {e}\n"
            "Czy backend działa? Podaj właściwy --url (np. port 8000 lub proxy 5173)."
        )

    coords = [c for u in units if (c := unit_lonlat(u))]
    if not coords:
        raise SystemExit("Brak jednostek z pozycją — najpierw postaw jednostki w scenariuszu.")

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    minlon, maxlon = min(lons), max(lons)
    minlat, maxlat = min(lats), max(lats)

    # margines w stopniach: 1° lat ≈ 111 km; lon skalujemy przez cos(lat).
    dlat = args.margin_km / 111.0
    mid_lat = (minlat + maxlat) / 2
    dlon = args.margin_km / (111.0 * max(0.1, math.cos(math.radians(mid_lat))))
    minlon -= dlon; maxlon += dlon
    minlat -= dlat; maxlat += dlat

    print(f"Jednostek z pozycją: {len(coords)}")
    print(f"bbox (lon/lat, +{args.margin_km} km margines):")
    print(f"  MINLON={minlon:.6f} MINLAT={minlat:.6f} MAXLON={maxlon:.6f} MAXLAT={maxlat:.6f}")
    print("\nGotowa komenda eksportu terenu:")
    print(
        f"  python -m rl.terrain.export_terrain --bbox "
        f"{minlon:.6f} {minlat:.6f} {maxlon:.6f} {maxlat:.6f} "
        f"--zoom {args.zoom} --window {args.window} --out {args.out}"
    )


if __name__ == "__main__":
    main()
