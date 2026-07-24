"""
rl.terrain.grid — statyczna siatka terenu używana przez środowisko (M3).

Siatka pokrywa prostokąt w EPSG:3857 (jak pozycje jednostek x/y w symulatorze) i dla
dowolnego punktu zwraca klasę terenu. Tworzona offline z kafelków mapy
(export_terrain.py) albo syntetycznie (fallback do odblokowania M3 zanim ustalimy region).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

TERRAIN_CLASSES = ("forest", "water", "wetland", "urban", "road", "open")
CLASS_TO_CODE = {c: i for i, c in enumerate(TERRAIN_CLASSES)}
CODE_TO_CLASS = {i: c for c, i in CLASS_TO_CODE.items()}


@dataclass
class TerrainGrid:
    minx: float  # EPSG:3857
    miny: float
    maxx: float
    maxy: float
    codes: np.ndarray  # shape (nrows, ncols), int kody klas; wiersz 0 = północ (maxy)

    @property
    def nrows(self) -> int:
        return int(self.codes.shape[0])

    @property
    def ncols(self) -> int:
        return int(self.codes.shape[1])

    def class_at(self, x: float, y: float) -> str:
        """Klasa terenu w punkcie EPSG:3857. Poza zakresem → 'open' (jak w grze)."""
        if not (self.minx <= x <= self.maxx and self.miny <= y <= self.maxy):
            return "open"
        fx = (x - self.minx) / (self.maxx - self.minx)
        fy = (self.maxy - y) / (self.maxy - self.miny)  # north-up
        col = min(self.ncols - 1, max(0, int(fx * self.ncols)))
        row = min(self.nrows - 1, max(0, int(fy * self.nrows)))
        return CODE_TO_CLASS[int(self.codes[row, col])]

    # ── I/O ──────────────────────────────────────────────────────────────────
    def save(self, path: str | Path) -> None:
        path = Path(path)
        np.savez_compressed(
            path,
            codes=self.codes.astype(np.int8),
            bbox=np.array([self.minx, self.miny, self.maxx, self.maxy], dtype=np.float64),
        )
        path.with_suffix(".meta.json").write_text(
            json.dumps({
                "crs": "EPSG:3857",
                "classes": list(TERRAIN_CLASSES),
                "bbox_3857": [self.minx, self.miny, self.maxx, self.maxy],
                "shape": [self.nrows, self.ncols],
            }, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: str | Path) -> "TerrainGrid":
        data = np.load(Path(path).with_suffix(".npz") if Path(path).suffix == "" else path)
        minx, miny, maxx, maxy = (float(v) for v in data["bbox"])
        return cls(minx, miny, maxx, maxy, data["codes"].astype(np.int64))

    # ── Fallback syntetyczny (deterministyczny) ────────────────────────────────
    @classmethod
    def synthetic(
        cls,
        bbox: tuple[float, float, float, float],
        ncols: int = 128,
        nrows: int = 128,
        seed: int = 0,
    ) -> "TerrainGrid":
        """
        Deterministyczne płaty terenu (forest/open/urban/water) — TYLKO do odblokowania
        rozwoju env. Realny teren pochodzi z export_terrain.py (kafelki mapy).
        """
        rng = np.random.default_rng(seed)
        codes = np.full((nrows, ncols), CLASS_TO_CODE["open"], dtype=np.int8)
        blobs = [
            ("forest", 6), ("forest", 5),
            ("urban", 3),
            ("water", 2), ("wetland", 2),
        ]
        for cls_name, count in blobs:
            for _ in range(count):
                cr = rng.integers(0, nrows)
                cc = rng.integers(0, ncols)
                rad = rng.integers(max(4, nrows // 16), max(6, nrows // 6))
                yy, xx = np.ogrid[:nrows, :ncols]
                mask = (yy - cr) ** 2 + (xx - cc) ** 2 <= rad ** 2
                codes[mask] = CLASS_TO_CODE[cls_name]
        return cls(bbox[0], bbox[1], bbox[2], bbox[3], codes)


if __name__ == "__main__":  # szybki self-check
    g = TerrainGrid.synthetic((0.0, 0.0, 1000.0, 1000.0), ncols=64, nrows=64, seed=1)
    print(f"synthetic grid {g.nrows}x{g.ncols}; class @ (500,500) = {g.class_at(500, 500)}")
    print(f"poza zakresem (2000,2000) = {g.class_at(2000, 2000)}")
