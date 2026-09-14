"""
build_road_raster.py — drogi z OpenStreetMap → raster pasów dróg dla analizy terenu.

Etap przygotowania danych offline (rl/GUARDRAIL.md §3) — backend w czasie działania
czyta tylko gotowe pliki z server/data/terrain/roads/.

Źródło: Geofabrik, pliki *-latest-free.shp.zip, warstwa gis_osm_roads_free_1.
Licencja ODbL — © OpenStreetMap contributors.

Wynik: server/data/terrain/roads/roads_N52E020.tif — kafle 1°×1°, EPSG:4326, siatka
WorldCover (1/12000°). 255 = pas drogi, 0 = brak. Bez nodata, z podglądami „average",
żeby backend przy dużych AO dostawał realny udział dróg w pikselu.
Szerokości pasów i klasy dróg: shared/combat_constants.json → potential.terrainProfile.roads.

Użycie:
  python server/scripts/build_road_raster.py --download --dry-run   # pliki i rozmiary
  python server/scripts/build_road_raster.py --download             # pobierz i zbuduj
  python server/scripts/build_road_raster.py                        # zbuduj z pobranych zipów
Wymaga: pyshp, shapely 2, rasterio, numpy.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
import time
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OSM_DIR = ROOT / "server" / "data" / "osm"
ROADS_DIR = ROOT / "server" / "data" / "terrain" / "roads"
CONSTANTS = ROOT / "shared" / "combat_constants.json"

GEOFABRIK_COUNTRY = "https://download.geofabrik.de/europe/poland-latest-free.shp.zip"
GEOFABRIK_REGION = "https://download.geofabrik.de/europe/poland/{name}-latest-free.shp.zip"
VOIVODESHIPS = (
    "dolnoslaskie", "kujawsko-pomorskie", "lodzkie", "lubelskie", "lubuskie", "malopolskie",
    "mazowieckie", "opolskie", "podkarpackie", "podlaskie", "pomorskie", "slaskie",
    "swietokrzyskie", "warminsko-mazurskie", "wielkopolskie", "zachodniopomorskie",
)
ROADS_LAYER = "gis_osm_roads_free_1"
POLAND_BBOX = (14.0, 49.0, 24.2, 54.9)

PIXELS_PER_DEG = 12000  # siatka ESA WorldCover
M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON_EQ = 111_320.0


def corridor_widths() -> dict[str, float]:
    data = json.loads(CONSTANTS.read_text(encoding="utf-8"))
    widths = data["potential"]["terrainProfile"]["roads"]["corridorWidthM"]
    return {k: float(v) for k, v in widths.items()}


# ── Pobieranie ────────────────────────────────────────────────────────────────

def download_zips(source: str, dry_run: bool) -> bool:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from download_terrain_data import download, remote_size

    urls = [GEOFABRIK_COUNTRY] if source == "country" else [GEOFABRIK_REGION.format(name=v) for v in VOIVODESHIPS]
    total = 0
    plan = []
    for url in urls:
        size = remote_size(url)
        name = url.rsplit("/", 1)[1]
        if size is None:
            print(f"BRAK        {name}")
            continue
        target = OSM_DIR / name
        have = target.exists() and target.stat().st_size == size
        total += 0 if have else size
        plan.append((target, url, size))
        print(f"{'OK  ' if have else 'NEW '} {size / 1e6:9.1f} MB  {name}")
    print(f"\nPlików: {len(plan)}  ·  do pobrania: {total / 1e9:.2f} GB  ·  katalog: {OSM_DIR}")
    if dry_run:
        return False
    for target, url, size in plan:
        if target.exists() and target.stat().st_size == size:
            continue
        print(f"-> {target.name}")
        download(url, target, size)
    return True


# ── Odczyt dróg ───────────────────────────────────────────────────────────────

def iter_roads(zip_path: Path, widths: dict[str, float]):
    """(szerokość pasa [m], współrzędne lon/lat odcinka) dla dróg z wybranych klas."""
    import shapefile  # pyshp

    with zipfile.ZipFile(zip_path) as zf, tempfile.TemporaryDirectory() as tmp:
        members = [n for n in zf.namelist() if Path(n).stem == ROADS_LAYER]
        if not members:
            print(f"  brak warstwy {ROADS_LAYER} w {zip_path.name}")
            return
        for member in members:
            zf.extract(member, tmp)
        base = Path(tmp) / Path(members[0]).with_suffix("")
        with shapefile.Reader(str(base), encoding="utf-8", encodingErrors="replace") as reader:
            field_names = [f[0] for f in reader.fields[1:]]
            fclass_idx = field_names.index("fclass")
            for shape_rec in reader.iterShapeRecords():
                width = widths.get(shape_rec.record[fclass_idx])
                if width is None:
                    continue
                pts = shape_rec.shape.points
                parts = list(shape_rec.shape.parts) + [len(pts)]
                for a, b in zip(parts[:-1], parts[1:]):
                    if b - a >= 2:
                        yield width, np.asarray(pts[a:b], dtype=np.float64)


def bin_roads(zips: list[Path], widths: dict[str, float], bbox) -> dict:
    """Odcinki pogrupowane w kafle 1°×1° i szerokości pasa."""
    blocks: dict = defaultdict(lambda: defaultdict(list))
    count = 0
    for zip_path in zips:
        t0 = time.time()
        before = count
        for width, coords in iter_roads(zip_path, widths):
            lon0, lat0 = coords.min(axis=0)
            lon1, lat1 = coords.max(axis=0)
            if lon1 < bbox[0] or lon0 > bbox[2] or lat1 < bbox[1] or lat0 > bbox[3]:
                continue
            for lat in range(math.floor(lat0), math.floor(lat1) + 1):
                for lon in range(math.floor(lon0), math.floor(lon1) + 1):
                    blocks[(lat, lon)][width].append(coords)
            count += 1
        print(f"  {zip_path.name}: {count - before} odcinków ({time.time() - t0:.0f} s)")
    return blocks


# ── Rasteryzacja ──────────────────────────────────────────────────────────────

def tile_name(lat: int, lon: int) -> str:
    ns = f"N{abs(lat):02d}" if lat >= 0 else f"S{abs(lat):02d}"
    ew = f"E{abs(lon):03d}" if lon >= 0 else f"W{abs(lon):03d}"
    return f"roads_{ns}{ew}.tif"


def rasterize_tile(lat: int, lon: int, by_width: dict[float, list[np.ndarray]]) -> bool:
    import rasterio
    import shapely
    from rasterio.enums import Resampling
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds

    size = PIXELS_PER_DEG
    transform = from_bounds(lon, lat, lon + 1, lat + 1, size, size)
    out = np.zeros((size, size), dtype=np.uint8)

    # Bufor w metrach: lokalne skalowanie stopni → metry wokół środka kafla.
    scale = np.array([M_PER_DEG_LON_EQ * math.cos(math.radians(lat + 0.5)), M_PER_DEG_LAT])
    clip = shapely.box(lon - 0.01, lat - 0.01, lon + 1.01, lat + 1.01)
    px_lat_m = M_PER_DEG_LAT / PIXELS_PER_DEG

    for width, lines in sorted(by_width.items()):
        geoms = np.array([shapely.LineString(c) for c in lines], dtype=object)
        metric = shapely.transform(geoms, lambda xy: xy * scale)
        buffered = shapely.buffer(metric, width / 2.0, quad_segs=2)
        back = shapely.intersection(shapely.transform(buffered, lambda xy: xy / scale), clip)
        shapes = ((g, 255) for g in back if g is not None and not g.is_empty)
        # Wąskie pasy (≤ ~2 piksele) — all_touched, żeby droga nie rwała się na siatce.
        rasterize(shapes, out=out, transform=transform, all_touched=width <= 2 * px_lat_m)

    if not out.any():
        return False
    ROADS_DIR.mkdir(parents=True, exist_ok=True)
    path = ROADS_DIR / tile_name(lat, lon)
    with rasterio.open(
        path, "w", driver="GTiff", width=size, height=size, count=1, dtype="uint8",
        crs="EPSG:4326", transform=transform, compress="deflate", predictor=2,
        tiled=True, blockxsize=512, blockysize=512,
    ) as ds:
        ds.write(out, 1)
        ds.build_overviews([2, 4, 8, 16, 32, 64], Resampling.average)
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Raster pasów dróg z OSM (Geofabrik).")
    ap.add_argument("--download", action="store_true", help="pobierz zipy z Geofabrik")
    # Geofabrik nie publikuje shapefile dla całej Polski — domyślnie 16 województw (~4 GB).
    ap.add_argument("--source", choices=("country", "voivodeships"), default="voivodeships")
    ap.add_argument("--dry-run", action="store_true", help="tylko lista plików i rozmiarów")
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("LON_MIN", "LAT_MIN", "LON_MAX", "LAT_MAX"),
                    default=POLAND_BBOX)
    args = ap.parse_args()

    if args.download and not download_zips(args.source, args.dry_run):
        return 0

    try:
        import shapefile  # noqa: F401
    except ImportError:
        print("Brak pakietu pyshp — zainstaluj: pip install pyshp")
        return 1

    zips = sorted(OSM_DIR.glob("*-latest-free.shp.zip"))
    if args.source == "country":
        country = [z for z in zips if z.name.startswith("poland-")]
        zips = country or zips
    if not zips:
        print(f"Brak plików *-latest-free.shp.zip w {OSM_DIR} — uruchom z --download")
        return 1

    widths = corridor_widths()
    print(f"Klasy dróg: {', '.join(sorted(widths))}")
    blocks = bin_roads(zips, widths, args.bbox)
    print(f"Kafli do zbudowania: {len(blocks)}")

    for i, ((lat, lon), by_width) in enumerate(sorted(blocks.items()), start=1):
        t0 = time.time()
        n = sum(len(v) for v in by_width.values())
        written = rasterize_tile(lat, lon, by_width)
        print(f"[{i}/{len(blocks)}] {tile_name(lat, lon)}: {n} odcinków, "
              f"{'zapisano' if written else 'pusty'} ({time.time() - t0:.0f} s)")

    print("Gotowe. Wywołaj POST /api/terrain/reload albo zrestartuj backend.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
