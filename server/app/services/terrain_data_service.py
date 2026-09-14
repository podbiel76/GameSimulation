"""
terrain_data_service — analiza terenu z LOKALNYCH danych rastrowych.

  • pokrycie terenu: ESA WorldCover 10 m (klasy ESA → klasy modelu potencjału),
  • rzeźba terenu: Copernicus DEM (wysokość, nachylenie, deniwelacja).

Pliki leżą w server/data/terrain/{landcover,dem}/*.tif (albo TERRAIN_DATA_DIR)
i są pobierane jednorazowo skryptem server/scripts/download_terrain_data.py.
W czasie działania nie ma żadnych zapytań sieciowych (rl/GUARDRAIL.md §3).

Uzgodniony model: obrona zależy od terenu w promieniu wokół jednostki
(potential.terrainProfile.defenseRadiusM), natarcie i manewr — od rozkładu
terenu w AO. Abstrakcyjny model symulacyjny — nie realne doradztwo taktyczne.
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

try:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.features import geometry_mask
    from rasterio.merge import merge

    _RASTERIO_ERROR: str | None = None
except ImportError as exc:  # pragma: no cover — zależy od środowiska
    rasterio = None
    _RASTERIO_ERROR = str(exc)

TERRAIN_CLASSES = ("forest", "water", "wetland", "urban", "road", "open")

# ESA WorldCover v200 → klasy modelu. WorldCover nie ma osobnej klasy dróg,
# więc udział „road" z tego źródła wynosi 0.
WORLDCOVER_TO_CLASS = {
    10: "forest",   # Tree cover
    20: "forest",   # Shrubland — zakrycie zbliżone do lasu
    30: "open",     # Grassland
    40: "open",     # Cropland
    50: "urban",    # Built-up
    60: "open",     # Bare / sparse vegetation
    70: "open",     # Snow and ice
    80: "water",    # Permanent water bodies
    90: "wetland",  # Herbaceous wetland
    95: "wetland",  # Mangroves
    100: "open",    # Moss and lichen
}
WORLDCOVER_NODATA = 0

LANDCOVER_SOURCE = "ESA WorldCover 10 m 2021 v200"
DEM_SOURCE = "Copernicus DEM"
ROADS_SOURCE = "OpenStreetMap (Geofabrik)"

# Limit pikseli jednego odczytu — duże AO czytane są w obniżonej rozdzielczości.
MAX_PIXELS = 2_000_000
M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON_EQ = 111_320.0

_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("TERRAIN_DATA_DIR") or _ROOT / "server" / "data" / "terrain")
_CONSTANTS = _ROOT / "shared" / "combat_constants.json"


def defense_radius_m() -> float:
    """Promień terenu obronnego ze wspólnych stałych modelu."""
    try:
        data = json.loads(_CONSTANTS.read_text(encoding="utf-8"))
        return float(data["potential"]["terrainProfile"]["defenseRadiusM"])
    except Exception:  # brak pliku lub klucza — bezpieczna wartość domyślna
        return 1500.0


def _road_overridable_codes() -> list[int]:
    """Kody WorldCover, które pas drogi może zastąpić (potential.terrainProfile.roads)."""
    try:
        data = json.loads(_CONSTANTS.read_text(encoding="utf-8"))
        classes = set(data["potential"]["terrainProfile"]["roads"]["overridesClasses"])
    except Exception:
        classes = {"forest", "open", "wetland"}
    return [code for code, cls in WORLDCOVER_TO_CLASS.items() if cls in classes]


_ROAD_OVERRIDABLE_CODES = _road_overridable_codes()


# ── Indeks plików rastrowych ──────────────────────────────────────────────────

@dataclass(frozen=True)
class _RasterFile:
    path: str
    bounds: tuple[float, float, float, float]  # left, bottom, right, top (EPSG:4326)
    res: float                                  # rozmiar piksela w stopniach


class _RasterIndex:
    """Leniwy indeks *.tif z zasięgami — skan raz, odświeżany przez reset()."""

    def __init__(self, subdir: str):
        self.dir = DATA_DIR / subdir
        self._files: list[_RasterFile] | None = None
        self._lock = threading.Lock()

    def files(self) -> list[_RasterFile]:
        if self._files is None:
            with self._lock:
                if self._files is None:
                    self._files = self._scan()
        return self._files

    def _scan(self) -> list[_RasterFile]:
        if rasterio is None or not self.dir.is_dir():
            return []
        found: list[_RasterFile] = []
        for path in sorted(self.dir.glob("*.tif")):
            try:
                with rasterio.open(path) as ds:
                    if ds.crs is None or ds.crs.to_epsg() != 4326:
                        log.warning("[TERRAIN] Pomijam %s — wymagany EPSG:4326, jest %s", path.name, ds.crs)
                        continue
                    b = ds.bounds
                    found.append(_RasterFile(str(path), (b.left, b.bottom, b.right, b.top), abs(ds.transform.a)))
            except Exception as exc:
                log.warning("[TERRAIN] Nie można otworzyć %s: %s", path.name, exc)
        return found

    def intersecting(self, bbox: tuple[float, float, float, float]) -> list[_RasterFile]:
        left, bottom, right, top = bbox
        return [
            f for f in self.files()
            if f.bounds[0] < right and f.bounds[2] > left and f.bounds[1] < top and f.bounds[3] > bottom
        ]

    def reset(self) -> None:
        with self._lock:
            self._files = None


_LANDCOVER = _RasterIndex("landcover")
_DEM = _RasterIndex("dem")
# Raster udziału dróg (255 = pas drogi) — server/scripts/build_road_raster.py
_ROADS = _RasterIndex("roads")


def reload_data() -> dict:
    _LANDCOVER.reset()
    _DEM.reset()
    _ROADS.reset()
    _analyze_ring.cache_clear()
    return data_status()


def data_status() -> dict:
    def one(index: _RasterIndex, source: str) -> dict:
        files = index.files()
        return {"available": bool(files), "files": len(files), "dir": str(index.dir), "source": source}

    return {
        "rasterio": rasterio is not None,
        "reason": None if rasterio is not None else f"Brak pakietu rasterio ({_RASTERIO_ERROR})",
        "landcover": one(_LANDCOVER, LANDCOVER_SOURCE),
        "dem": one(_DEM, DEM_SOURCE),
        "roads": one(_ROADS, ROADS_SOURCE),
    }


# ── Geometria ─────────────────────────────────────────────────────────────────

Ring = tuple[tuple[float, float], ...]


def circle_ring(lon: float, lat: float, radius_m: float, segments: int = 72) -> Ring:
    """Okrąg jako wielokąt lon/lat (przybliżenie lokalne — wystarczające do kilku km)."""
    dlat = radius_m / M_PER_DEG_LAT
    dlon = radius_m / (M_PER_DEG_LON_EQ * max(math.cos(math.radians(lat)), 1e-6))
    pts = [
        (round(lon + dlon * math.cos(2 * math.pi * i / segments), 6),
         round(lat + dlat * math.sin(2 * math.pi * i / segments), 6))
        for i in range(segments)
    ]
    return tuple(pts + [pts[0]])


def polygon_ring(coords: list[list[float]]) -> Ring:
    pts = [(round(float(p[0]), 6), round(float(p[1]), 6)) for p in coords]
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    return tuple(pts)


def _bbox(ring: Ring, pad: float = 0.0) -> tuple[float, float, float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad)


def _merge(files: list[_RasterFile], bounds, res: float, resampling, nodata, dtype=None):
    sources = [rasterio.open(f.path) for f in files]
    try:
        arr, transform = merge(
            sources, bounds=bounds, res=(res, res), resampling=resampling, nodata=nodata, dtype=dtype,
        )
    finally:
        for src in sources:
            src.close()
    return arr[0], transform


def _read_mosaic(index: _RasterIndex, ring: Ring, resampling, nodata):
    """Mozaika plików przecinających wielokąt, w rozdzielczości ≤ MAX_PIXELS.

    Zwraca (tablica, transform, res, bounds) — bounds i res pozwalają odczytać
    inny raster (drogi) na identycznej siatce.
    """
    bbox = _bbox(ring)
    files = index.intersecting(bbox)
    if not files:
        return None
    native = min(f.res for f in files)
    width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
    res = max(native, math.sqrt(max(width * height, 1e-12) / MAX_PIXELS))
    bounds = _bbox(ring, pad=res)  # margines — małe wielokąty nie znikają w zaokrągleniu
    arr, transform = _merge(files, bounds, res, resampling, nodata)
    return arr, transform, res, bounds


def _road_fraction(bounds, res: float, shape) -> np.ndarray | None:
    """Udział pasa drogi w pikselu (0–1) na tej samej siatce co pokrycie terenu.

    Raster dróg nie ma nodata, więc przy obniżonej rozdzielczości średnia
    (Resampling.average) daje realny udział drogi, a nie „cały piksel drogą".
    """
    files = _ROADS.intersecting(bounds)
    if not files:
        return None
    arr, _ = _merge(files, bounds, res, Resampling.average, None, "float32")
    if arr.shape != shape:
        log.warning("[TERRAIN] Siatka dróg %s ≠ siatka pokrycia %s — pomijam drogi", arr.shape, shape)
        return None
    return np.clip(arr / 255.0, 0.0, 1.0)


def _inside_mask(ring: Ring, shape, transform) -> np.ndarray:
    geom = {"type": "Polygon", "coordinates": [[list(p) for p in ring]]}
    inside = geometry_mask([geom], out_shape=shape, transform=transform, invert=True)
    if not inside.any():
        inside = geometry_mask([geom], out_shape=shape, transform=transform, invert=True, all_touched=True)
    return inside


def _row_weights(transform, shape) -> np.ndarray:
    """Waga piksela ∝ cos(szerokości) — piksele w stopniach mają różną powierzchnię."""
    lats = transform.f + (np.arange(shape[0]) + 0.5) * transform.e
    return np.broadcast_to(np.cos(np.radians(lats))[:, None], shape)


# ── Analiza ───────────────────────────────────────────────────────────────────

def _landcover_stats(ring: Ring) -> dict | None:
    data = _read_mosaic(_LANDCOVER, ring, Resampling.mode, WORLDCOVER_NODATA)
    if data is None:
        return None
    codes, transform, res, bounds = data
    inside = _inside_mask(ring, codes.shape, transform)
    weights = _row_weights(transform, codes.shape)

    total_inside = float(weights[inside].sum())
    valid = inside & (codes != WORLDCOVER_NODATA)
    total_valid = float(weights[valid].sum())
    if total_valid <= 0:
        return None

    # Drogi (OSM) zastępują część piksela tylko w klasach, przez które droga
    # zmienia warunki manewru (las, pole, mokradła) — patrz terrainProfile.roads.
    road = _road_fraction(bounds, res, codes.shape)
    w = weights[valid]
    if road is not None:
        rf = np.where(np.isin(codes, _ROAD_OVERRIDABLE_CODES), road, 0.0)[valid]
    else:
        rf = np.zeros(w.shape, dtype=np.float64)

    per_code = np.bincount(codes[valid].astype(np.int64), weights=w * (1.0 - rf), minlength=256)
    shares = {c: 0.0 for c in TERRAIN_CLASSES}
    for code, cls in WORLDCOVER_TO_CLASS.items():
        shares[cls] += float(per_code[code]) / total_valid
    shares["road"] += float((w * rf).sum()) / total_valid
    shares = {c: round(v, 4) for c, v in shares.items()}
    dominant = max(TERRAIN_CLASSES, key=lambda c: shares[c])  # remis → kolejność TERRAIN_CLASSES

    return {
        "shares": shares,
        "dominant": dominant,
        "resolution_m": round(res * M_PER_DEG_LAT, 1),
        "valid_fraction": round(total_valid / total_inside, 3) if total_inside > 0 else 0.0,
    }


def _dem_stats(ring: Ring, center: tuple[float, float] | None) -> dict:
    data = _read_mosaic(_DEM, ring, Resampling.bilinear, np.nan)
    if data is None:
        return {}
    dem, transform, res, _ = data
    dem = dem.astype(np.float64)
    inside = _inside_mask(ring, dem.shape, transform)

    lat_c = sum(p[1] for p in ring) / len(ring)
    dx = res * M_PER_DEG_LON_EQ * math.cos(math.radians(lat_c))
    dy = res * M_PER_DEG_LAT
    grad_y, grad_x = np.gradient(dem, dy, dx)
    slope = np.degrees(np.arctan(np.hypot(grad_x, grad_y)))

    elev = dem[inside & np.isfinite(dem)]
    slopes = slope[inside & np.isfinite(slope)]
    if elev.size == 0:
        return {}

    point_elev = None
    if center is not None:
        col, row = ~transform * center
        r, c = int(row), int(col)
        if 0 <= r < dem.shape[0] and 0 <= c < dem.shape[1] and np.isfinite(dem[r, c]):
            point_elev = float(dem[r, c])

    return {
        "elevation_m": round(point_elev if point_elev is not None else float(elev.mean()), 1),
        "mean_elevation_m": round(float(elev.mean()), 1),
        "mean_slope_deg": round(float(slopes.mean()), 1) if slopes.size else None,
        "relief_m": round(float(np.percentile(elev, 95) - np.percentile(elev, 5)), 1),
    }


@lru_cache(maxsize=256)
def _analyze_ring(ring: Ring, center: tuple[float, float] | None) -> dict | None:
    landcover = _landcover_stats(ring)
    if landcover is None:
        return None
    return {**landcover, **_dem_stats(ring, center)}


def terrain_profile(lon: float, lat: float, radius_m: float, ao: list[list[float]] | None) -> dict:
    """Profil terenu jednostki: otoczenie (obrona) + AO (natarcie i manewr)."""
    status = data_status()
    sources = {
        "landcover": LANDCOVER_SOURCE,
        "dem": DEM_SOURCE if status["dem"]["available"] else None,
        "roads": ROADS_SOURCE if status["roads"]["available"] else None,
    }
    empty = {"available": False, "local": None, "ao": None, "sources": sources}

    if not status["rasterio"]:
        return {**empty, "reason": status["reason"]}
    if not status["landcover"]["available"]:
        return {**empty, "reason": (
            f"Brak danych pokrycia terenu w {status['landcover']['dir']} — "
            "uruchom server/scripts/download_terrain_data.py"
        )}

    try:
        local = _analyze_ring(circle_ring(lon, lat, radius_m), (round(lon, 6), round(lat, 6)))
        ao_stats = None
        if ao and len(ao) >= 3:
            ao_stats = _analyze_ring(polygon_ring(ao), None)
            if ao_stats is not None:
                from .unit_area_service import calculate_polygon_area_km2
                ao_stats = {**ao_stats, "area_km2": calculate_polygon_area_km2([list(p) for p in ao])}
    except Exception as exc:
        log.exception("[TERRAIN] Błąd analizy terenu")
        return {**empty, "reason": f"Błąd odczytu danych terenu: {exc}"}

    if local is None:
        return {**empty, "ao": ao_stats, "reason": "Pozycja jednostki poza zasięgiem danych terenu"}
    return {
        "available": True,
        "reason": None,
        "local": {**local, "radius_m": radius_m},
        "ao": ao_stats,
        "sources": sources,
    }


def point_terrain(lon: float, lat: float, radius_m: float = 50.0) -> dict | None:
    """Teren w punkcie (mały okrąg) — dla TerrainAssessment przy tworzeniu jednostki."""
    if rasterio is None or not _LANDCOVER.files():
        return None
    try:
        return _analyze_ring(circle_ring(lon, lat, radius_m), (round(lon, 6), round(lat, 6)))
    except Exception:
        log.exception("[TERRAIN] Błąd analizy punktu")
        return None
