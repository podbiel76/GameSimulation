"""
download_terrain_data.py — JEDNORAZOWE, offline pobranie danych terenu dla backendu.

Zgodnie z rl/GUARDRAIL.md §3 backend w czasie działania NIE łączy się z internetem:
czyta wyłącznie pliki z server/data/terrain/. Ten skrypt to etap przygotowania danych
(tak jak rl/terrain/export_terrain.py) i uruchamia się go ręcznie.

Źródła (dane otwarte, CC BY 4.0):
  • ESA WorldCover 10 m 2021 v200 — pokrycie terenu, kafle 3°×3°
      https://esa-worldcover.org
  • Copernicus DEM GLO-90 (domyślnie) albo GLO-30 — wysokości, kafle 1°×1°
      https://registry.opendata.aws/copernicus-dem/

Użycie:
  python server/scripts/download_terrain_data.py --dry-run        # lista plików i rozmiary
  python server/scripts/download_terrain_data.py                  # pobierz (cała Polska)
  python server/scripts/download_terrain_data.py --bbox 20 52 22 53 --dem glo30
"""

from __future__ import annotations

import argparse
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "terrain"

# Polska z niewielkim marginesem: lon_min lat_min lon_max lat_max
POLAND_BBOX = (14.0, 49.0, 24.2, 54.9)

WORLDCOVER_URL = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
)
DEM_BUCKETS = {
    # nazwa → (bucket, kod rozdzielczości w nazwie pliku)
    "glo90": ("copernicus-dem-90m", "30"),
    "glo30": ("copernicus-dem-30m", "10"),
}
USER_AGENT = "geotactical-terrain-prep/0.1 (offline data preparation)"


def _ns(v: int) -> str:
    return f"N{abs(v):02d}" if v >= 0 else f"S{abs(v):02d}"


def _ew(v: int, width: int = 3) -> str:
    return f"E{abs(v):0{width}d}" if v >= 0 else f"W{abs(v):0{width}d}"


def worldcover_files(bbox) -> list[tuple[str, str]]:
    lon0, lat0, lon1, lat1 = bbox
    out = []
    lat = math.floor(lat0 / 3) * 3
    while lat < lat1:
        lon = math.floor(lon0 / 3) * 3
        while lon < lon1:
            tile = f"{_ns(lat)}{_ew(lon)}"
            out.append((f"landcover/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif",
                        WORLDCOVER_URL.format(tile=tile)))
            lon += 3
        lat += 3
    return out


def dem_files(bbox, variant: str) -> list[tuple[str, str]]:
    bucket, code = DEM_BUCKETS[variant]
    lon0, lat0, lon1, lat1 = bbox
    out = []
    for lat in range(math.floor(lat0), math.ceil(lat1)):
        for lon in range(math.floor(lon0), math.ceil(lon1)):
            name = f"Copernicus_DSM_COG_{code}_{_ns(lat)}_00_{_ew(lon)}_00_DEM"
            out.append((f"dem/{name}.tif", f"https://{bucket}.s3.amazonaws.com/{name}/{name}.tif"))
    return out


def remote_size(url: str) -> int | None:
    """Rozmiar pliku z nagłówka HEAD; None, gdy kafla nie ma (np. samo morze)."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return int(resp.headers.get("Content-Length") or 0)
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise


def download(url: str, target: Path, expected: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix(target.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    done = 0
    with urllib.request.urlopen(req, timeout=120) as resp, open(part, "wb") as fh:
        while chunk := resp.read(1 << 20):
            fh.write(chunk)
            done += len(chunk)
            if expected:
                print(f"\r    {done / 1e6:8.1f} / {expected / 1e6:.1f} MB", end="", flush=True)
    print()
    part.replace(target)


def main() -> int:
    ap = argparse.ArgumentParser(description="Pobierz dane terenu (WorldCover + Copernicus DEM).")
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("LON_MIN", "LAT_MIN", "LON_MAX", "LAT_MAX"),
                    default=POLAND_BBOX)
    ap.add_argument("--dem", choices=sorted(DEM_BUCKETS), default="glo90")
    ap.add_argument("--skip-dem", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="tylko lista plików i rozmiarów")
    args = ap.parse_args()

    files = worldcover_files(args.bbox)
    if not args.skip_dem:
        files += dem_files(args.bbox, args.dem)

    total = 0
    plan: list[tuple[Path, str, int]] = []
    for rel, url in files:
        size = remote_size(url)
        if size is None:
            continue
        target = DATA_DIR / rel
        have = target.exists() and target.stat().st_size == size
        total += 0 if have else size
        plan.append((target, url, size))
        print(f"{'OK  ' if have else 'NEW '} {size / 1e6:9.1f} MB  {rel}")

    print(f"\nPlików: {len(plan)}  ·  do pobrania: {total / 1e9:.2f} GB  ·  katalog: {DATA_DIR}")
    if args.dry_run:
        return 0

    for target, url, size in plan:
        if target.exists() and target.stat().st_size == size:
            continue
        print(f"-> {target.name}")
        download(url, target, size)
    print("Gotowe. Zrestartuj backend albo wywołaj POST /api/terrain/reload.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
