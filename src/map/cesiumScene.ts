// Helpery sceny 3D (CesiumJS) — konwersje współrzędnych, kolory stron, heatmapa zagrożenia.
// Warstwa wizualizacji istniejącego stanu sim; bez wpływu na mechanikę.
import * as Cesium from "cesium";
import { toLonLat } from "ol/proj";
import { computeUnitPotential } from "../utils/combatPotential";
import type { Unit } from "../types/map";

/** EPSG:3857 (x,y) → Cesium.Cartesian3 (na zadanej wysokości n.p.t. — domyślnie clamp w encji). */
export function mercToCartesian(x: number, y: number, height = 0): Cesium.Cartesian3 {
  const [lon, lat] = toLonLat([x, y]) as [number, number];
  return Cesium.Cartesian3.fromDegrees(lon, lat, height);
}

export function mercToLonLat(x: number, y: number): [number, number] {
  return toLonLat([x, y]) as [number, number];
}

export function sideColor(side: string | undefined): Cesium.Color {
  if (side === "friendly") return Cesium.Color.fromCssColorString("#3b82f6");
  if (side === "hostile") return Cesium.Color.fromCssColorString("#ef4444");
  return Cesium.Color.fromCssColorString("#94a3b8");
}

/** Bounding box (lon/lat) zbioru jednostek z marginesem [stopnie]. */
export function unitsBBoxLonLat(units: Unit[], marginDeg = 0.02): [number, number, number, number] | null {
  if (!units.length) return null;
  const lons: number[] = []; const lats: number[] = [];
  for (const u of units) { const [lo, la] = mercToLonLat(u.x, u.y); lons.push(lo); lats.push(la); }
  return [
    Math.min(...lons) - marginDeg, Math.min(...lats) - marginDeg,
    Math.max(...lons) + marginDeg, Math.max(...lats) + marginDeg,
  ];
}

/**
 * Canvas-heatmapa zagrożenia: dla siatki nad bbox liczy sumę potencjału WROGÓW (effectivePotential)
 * ważoną gaussowsko po dystansie; koloruje gradientem (przezroczysty → żółty → czerwony).
 * Drapowana potem jako materiał Rectangle na terenie.
 */
export function threatHeatmapCanvas(
  units: Unit[],
  bbox: [number, number, number, number],
  hostileSide = "hostile",
  res = 96,
): HTMLCanvasElement {
  const [w, s, e, n] = bbox;
  const enemies = units.filter(u => u.side === hostileSide).map(u => {
    const [lon, lat] = mercToLonLat(u.x, u.y);
    const pot = computeUnitPotential(u as any, "open").breakdown.effectivePotential;
    return { lon, lat, pot: Math.max(0.02, pot) };
  });
  const canvas = document.createElement("canvas");
  canvas.width = res; canvas.height = res;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(res, res);
  const sigma = (e - w) * 0.12 || 0.01;           // zasięg wpływu [stopnie]
  let maxv = 1e-6;
  const field = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    const lat = n - (n - s) * (j / (res - 1));
    for (let i = 0; i < res; i++) {
      const lon = w + (e - w) * (i / (res - 1));
      let v = 0;
      for (const en of enemies) {
        const dx = lon - en.lon, dy = lat - en.lat;
        v += en.pot * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      }
      field[j * res + i] = v; if (v > maxv) maxv = v;
    }
  }
  for (let k = 0; k < res * res; k++) {
    const t = Math.min(1, field[k] / maxv);
    // gradient: 0 → przezroczysty; 0.5 → żółty; 1 → czerwony
    const r = 255, g = Math.round(255 * (1 - t)), b = 0;
    img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b;
    img.data[k * 4 + 3] = Math.round(180 * Math.pow(t, 0.7));   // alfa rośnie z zagrożeniem
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
