"""
rl.terrain.classifier — wierny port logiki klasyfikacji terenu z
src/utils/terrainClassifier.ts (histogram kolorów HSL).

Używany offline do zbudowania siatki terenu z kafelków mapy (export_terrain.py).
Parity z TS pilnuje rl/parity/test_parity.py (golden_terrain.json).

To samo źródło stylu co w grze (domyślnie OSM) → klasy zgodne z tym, co widać.
"""

from __future__ import annotations

from typing import Literal

PixelClass = Literal["forest", "water", "urban", "road", "open"]
TerrainClass = Literal["forest", "water", "wetland", "urban", "road", "open"]

PIXEL_CLASSES: tuple[PixelClass, ...] = ("forest", "water", "urban", "road", "open")


def rgb_to_hsl(r: float, g: float, b: float) -> tuple[float, float, float]:
    """Odpowiednik rgbToHsl z TS. Zwraca (h[0-360], s[0-100], l[0-100])."""
    rn, gn, bn = r / 255.0, g / 255.0, b / 255.0
    mx = max(rn, gn, bn)
    mn = min(rn, gn, bn)
    lum = (mx + mn) / 2.0

    if mx == mn:
        return (0.0, 0.0, lum * 100.0)

    d = mx - mn
    s = d / (2 - mx - mn) if lum > 0.5 else d / (mx + mn)

    if mx == rn:
        h = (gn - bn) / d + (6 if gn < bn else 0)
    elif mx == gn:
        h = (bn - rn) / d + 2
    else:
        h = (rn - gn) / d + 4

    return (h * 60.0, s * 100.0, lum * 100.0)


def classify_pixel_color(r: int, g: int, b: int) -> PixelClass:
    """Odpowiednik classifyPixelColor z TS."""
    h, s, lum = rgb_to_hsl(r, g, b)
    if 170 <= h <= 260 and s >= 15 and 20 <= lum <= 85:
        return "water"
    if 60 <= h <= 165 and s >= 20 and 15 <= lum <= 80:
        return "forest"
    if lum >= 88 and s <= 8:
        return "road"
    if s <= 20 and 30 <= lum <= 87:
        return "urban"
    return "open"


def determine_terrain(counts: dict[str, int], total: int) -> TerrainClass:
    """Odpowiednik determineTerrain z TS (reguła wetland + argmax)."""
    if total <= 0:
        return "open"
    water_frac = counts["water"] / total
    urban_frac = counts["urban"] / total
    if 0.08 <= water_frac < 0.60 and urban_frac < 0.15:
        return "wetland"
    # argmax zgodny z TS reduce: (a,b) => counts[a] > counts[b] ? a : b
    # → przy remisie akumulator przechodzi na PÓŹNIEJSZY klucz, więc wygrywa
    # OSTATNia klasa o maksymalnym zliczeniu (stąd '>=', nie '>').
    best = PIXEL_CLASSES[0]
    for cls in PIXEL_CLASSES[1:]:
        if counts[cls] >= counts[best]:
            best = cls
    return best


def classify_window(pixels: list[tuple[int, int, int, int]]) -> tuple[TerrainClass, float]:
    """
    Klasyfikuj okno pikseli (lista RGBA). Pomija piksele z alpha==0.
    Zwraca (klasa, pewność = udział dominującej klasy).
    """
    counts = {c: 0 for c in PIXEL_CLASSES}
    total = 0
    for r, g, b, a in pixels:
        if a == 0:
            continue
        counts[classify_pixel_color(r, g, b)] += 1
        total += 1
    if total == 0:
        return "open", 0.0
    terrain = determine_terrain(counts, total)
    dominant = counts["water"] if terrain == "wetland" else counts[terrain]
    return terrain, round(dominant / total * 100) / 100
