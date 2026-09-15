"""
export_worldcover.py — siatka terenu dla RL z tych samych rastrów, z których korzysta gra.

Gra liczy teren w backendzie z ESA WorldCover (server/app/services/terrain_data_service.py).
Dotychczasowe siatki RL (export_terrain.py) powstawały z kolorów kafelków OSM, więc
środowisko RL i gra widziały inny teren. Ten eksporter przepisuje WorldCover na siatkę
TerrainGrid (EPSG:3857, kody klas modelu) — format, który rl/sim.py już czyta.

Etap offline, bez sieci: czyta server/data/terrain/landcover/*.tif.

Przykład (obszar i komórka ~25 m w terenie):
    python -m rl.terrain.export_worldcover \
        --bbox 21.00 52.20 21.20 52.33 --cell-m 25 --out rl/terrain/data/region_worldcover
Obszar istniejącej siatki:
    python -m rl.terrain.export_worldcover --like rl/terrain/data/region_otm.npz --cell-m 25 \
        --out rl/terrain/data/region_worldcover
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np

from rl.terrain.grid import CLASS_TO_CODE, TerrainGrid

ROOT = Path(__file__).resolve().parents[2]
_SERVICE = ROOT / "server" / "app" / "services" / "terrain_data_service.py"
R_MERC = 6378137.0


def _terrain_service():
    """Mapowanie klas i katalog danych wprost z serwisu backendu — jedno źródło."""
    spec = importlib.util.spec_from_file_location("terrain_data_service", _SERVICE)
    module = importlib.util.module_from_spec(spec)
    # @dataclass w module wymaga, by moduł był zarejestrowany w sys.modules.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def lonlat_to_3857(lon: float, lat: float) -> tuple[float, float]:
    return R_MERC * math.radians(lon), R_MERC * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def merc_to_lonlat(x: float, y: float) -> tuple[float, float]:
    return math.degrees(x / R_MERC), math.degrees(2 * math.atan(math.exp(y / R_MERC)) - math.pi / 2)


def export(bbox_lonlat: tuple[float, float, float, float], cell_m: float) -> TerrainGrid:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject

    svc = _terrain_service()
    lon0, lat0, lon1, lat1 = bbox_lonlat
    minx, miny = lonlat_to_3857(lon0, lat0)
    maxx, maxy = lonlat_to_3857(lon1, lat1)

    # Metry w terenie → jednostki EPSG:3857 (rozciągnięte o 1/cos φ).
    cell = cell_m / math.cos(math.radians((lat0 + lat1) / 2))
    ncols = max(1, math.ceil((maxx - minx) / cell))
    nrows = max(1, math.ceil((maxy - miny) / cell))
    maxx, maxy = minx + ncols * cell, miny + nrows * cell
    transform = from_bounds(minx, miny, maxx, maxy, ncols, nrows)

    files = sorted((svc.DATA_DIR / "landcover").glob("*.tif"))
    if not files:
        raise SystemExit(f"Brak rastrów w {svc.DATA_DIR / 'landcover'} — uruchom server/scripts/download_terrain_data.py")

    mosaic = np.zeros((nrows, ncols), dtype=np.uint8)
    for path in files:
        with rasterio.open(path) as src:
            b = src.bounds
            if b.right <= lon0 or b.left >= lon1 or b.top <= lat0 or b.bottom >= lat1:
                continue
            part = np.zeros_like(mosaic)
            reproject(
                source=rasterio.band(src, 1), destination=part,
                src_transform=src.transform, src_crs=src.crs, src_nodata=svc.WORLDCOVER_NODATA,
                dst_transform=transform, dst_crs="EPSG:3857", dst_nodata=0,
                resampling=Resampling.mode,
            )
            mosaic = np.where(mosaic == 0, part, mosaic)

    codes = np.full((nrows, ncols), CLASS_TO_CODE["open"], dtype=np.int8)
    for wc_code, cls in svc.WORLDCOVER_TO_CLASS.items():
        codes[mosaic == wc_code] = CLASS_TO_CODE[cls]
    return TerrainGrid(minx, miny, maxx, maxy, codes)


def main() -> None:
    ap = argparse.ArgumentParser(description="Siatka terenu RL z ESA WorldCover.")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--bbox", type=float, nargs=4, metavar=("LON_MIN", "LAT_MIN", "LON_MAX", "LAT_MAX"))
    group.add_argument("--like", help="przyjmij obszar istniejącej siatki (.npz)")
    ap.add_argument("--cell-m", type=float, default=25.0, help="rozmiar komórki w terenie [m]")
    ap.add_argument("--out", required=True, help="ścieżka bazowa (.npz + .meta.json)")
    args = ap.parse_args()

    if args.like:
        ref = TerrainGrid.load(args.like)
        lon0, lat0 = merc_to_lonlat(ref.minx, ref.miny)
        lon1, lat1 = merc_to_lonlat(ref.maxx, ref.maxy)
        bbox = (lon0, lat0, lon1, lat1)
    else:
        bbox = tuple(args.bbox)

    grid = export(bbox, args.cell_m)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    grid.save(out.with_suffix(".npz"))

    counts = np.bincount(grid.codes.ravel().astype(np.int64), minlength=len(CLASS_TO_CODE))
    shares = {cls: round(float(counts[code]) / grid.codes.size, 3) for cls, code in CLASS_TO_CODE.items()}
    print(json.dumps({"out": str(out.with_suffix(".npz")), "shape": [grid.nrows, grid.ncols],
                      "bbox_lonlat": [round(v, 5) for v in bbox], "shares": shares}, ensure_ascii=False))


if __name__ == "__main__":
    main()
