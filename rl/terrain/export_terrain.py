"""
export_terrain.py — buduje statyczną siatkę terenu z kafelków mapy (offline).

Pobiera kafelki XYZ (domyślnie OSM — ten sam styl co domyślny basemap w grze) dla
podanego prostokąta lon/lat, klasyfikuje piksele tą samą logiką co gra
(rl.terrain.classifier, parity z TS) i zapisuje TerrainGrid (.npz + .meta.json).

Przykład (mały region ≤3v3):
    python -m rl.terrain.export_terrain \
        --bbox 21.00 52.20 21.06 52.24 --zoom 16 --window 16 \
        --out rl/terrain/data/region_warszawa

WAŻNE: URL kafelków musi odpowiadać basemapowi użytemu do terenu w grze (domyślnie OSM).
Jeśli scenariusz korzysta z innej warstwy (np. opentopomap), podaj --tile-url.
Przestrzegaj polityki użycia danego dostawcy kafelków (rate limit, User-Agent).
"""

from __future__ import annotations

import argparse
import math
import time
import urllib.request
from pathlib import Path

import numpy as np

from rl.terrain.classifier import classify_window
from rl.terrain.grid import CLASS_TO_CODE, TerrainGrid

R_MERC = 6378137.0
TILE_PX = 256
DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
USER_AGENT = "geotactical-rl-terrain-export/0.1 (abstract simulator; offline grid build)"


def lonlat_to_3857(lon: float, lat: float) -> tuple[float, float]:
    x = R_MERC * math.radians(lon)
    y = R_MERC * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def lonlat_to_pixel(lon: float, lat: float, z: int) -> tuple[float, float]:
    """Globalny piksel Web Mercator (slippy) na zoomie z."""
    n = TILE_PX * (2 ** z)
    px = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    py = (1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n
    return px, py


def _download_tile(url_tpl: str, z: int, x: int, y: int):
    from PIL import Image  # lazy
    import io
    url = url_tpl.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return Image.open(io.BytesIO(resp.read())).convert("RGBA")


def build_mosaic(bbox, z: int, tile_url: str, polite_delay: float):
    """Pobiera i skleja kafelki pokrywające bbox; zwraca (rgba ndarray, px0, py0)."""
    minlon, minlat, maxlon, maxlat = bbox
    px_min, py_max = lonlat_to_pixel(minlon, minlat, z)  # minlat -> większe py
    px_max, py_min = lonlat_to_pixel(maxlon, maxlat, z)
    tx0, tx1 = int(px_min // TILE_PX), int(px_max // TILE_PX)
    ty0, ty1 = int(py_min // TILE_PX), int(py_max // TILE_PX)

    from PIL import Image
    n_tiles = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    print(f"Pobieranie {n_tiles} kafelków (z={z}, x:{tx0}..{tx1}, y:{ty0}..{ty1})...")
    mosaic = Image.new("RGBA", ((tx1 - tx0 + 1) * TILE_PX, (ty1 - ty0 + 1) * TILE_PX))
    for ix, tx in enumerate(range(tx0, tx1 + 1)):
        for iy, ty in enumerate(range(ty0, ty1 + 1)):
            tile = _download_tile(tile_url, z, tx, ty)
            mosaic.paste(tile, (ix * TILE_PX, iy * TILE_PX))
            if polite_delay:
                time.sleep(polite_delay)
    arr = np.asarray(mosaic)  # (H, W, 4)
    # offset globalnego piksela lewego-górnego rogu mozaiki:
    return arr, tx0 * TILE_PX, ty0 * TILE_PX, (px_min, py_min, px_max, py_max)


def export(bbox, z: int, window: int, out: Path, tile_url: str, polite_delay: float) -> None:
    arr, ox, oy, (px_min, py_min, px_max, py_max) = build_mosaic(bbox, z, tile_url, polite_delay)

    # piksele bbox względem mozaiki
    x0 = int(round(px_min - ox)); x1 = int(round(px_max - ox))
    y0 = int(round(py_min - oy)); y1 = int(round(py_max - oy))
    sub = arr[y0:y1, x0:x1]  # (H, W, 4) tylko obszar bbox
    h, w = sub.shape[:2]
    ncols = max(1, w // window)
    nrows = max(1, h // window)

    codes = np.full((nrows, ncols), CLASS_TO_CODE["open"], dtype=np.int8)
    for row in range(nrows):
        for col in range(ncols):
            cell = sub[row * window:(row + 1) * window, col * window:(col + 1) * window]
            px = [(int(p[0]), int(p[1]), int(p[2]), int(p[3])) for p in cell.reshape(-1, 4)]
            cls, _conf = classify_window(px)
            codes[row, col] = CLASS_TO_CODE[cls]

    minx, miny = lonlat_to_3857(bbox[0], bbox[1])
    maxx, maxy = lonlat_to_3857(bbox[2], bbox[3])
    grid = TerrainGrid(minx, miny, maxx, maxy, codes)
    out.parent.mkdir(parents=True, exist_ok=True)
    grid.save(out)

    uniq, cnt = np.unique(codes, return_counts=True)
    from rl.terrain.grid import CODE_TO_CLASS
    dist = {CODE_TO_CLASS[int(u)]: int(c) for u, c in zip(uniq, cnt)}
    print(f"Zapisano siatkę {nrows}x{ncols} -> {out}.npz")
    print(f"Rozkład klas (komórki): {dist}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Eksport terenu z kafelków mapy do siatki.")
    ap.add_argument("--bbox", nargs=4, type=float, required=True,
                    metavar=("MINLON", "MINLAT", "MAXLON", "MAXLAT"))
    ap.add_argument("--zoom", type=int, default=16)
    ap.add_argument("--window", type=int, default=16, help="px na komórkę siatki")
    ap.add_argument("--out", type=Path, required=True, help="ścieżka bazowa (bez .npz)")
    ap.add_argument("--tile-url", default=DEFAULT_TILE_URL)
    ap.add_argument("--polite-delay", type=float, default=0.1, help="sek. między kafelkami")
    args = ap.parse_args()
    export(tuple(args.bbox), args.zoom, args.window, args.out, args.tile_url, args.polite_delay)


if __name__ == "__main__":
    main()
