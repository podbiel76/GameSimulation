import { fromLonLat, toLonLat } from "ol/proj";

/**
 * Calculates bearing from one [lon, lat] point to another.
 * 0 = North, 90 = East, 180 = South, 270 = West.
 */
export function calculateBearing(start: [number, number], end: [number, number]): number {
  const startLat = (start[1] * Math.PI) / 180;
  const startLon = (start[0] * Math.PI) / 180;
  const endLat = (end[1] * Math.PI) / 180;
  const endLon = (end[0] * Math.PI) / 180;

  const y = Math.sin(endLon - startLon) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLon - startLon);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Returns responsibility area size (km) based on unit echelon.
 */
export function getAreaSizeForEchelon(echelon: string): number {
  const sizes: Record<string, number> = {
    team_crew: 0.1,
    squad: 0.2,
    section: 0.4,
    platoon_detachment: 0.8,
    company_battery_troop: 1.6,
    battalion_squadron: 3.2,
    regiment_group: 6.4,
    brigade: 12.8,
    division: 25.6,
    corps_mef: 51.2,
    army: 102.4,
    army_group_front: 204.8,
    region_theater: 409.6,
  };
  return sizes[echelon.toLowerCase()] || 5;
}

/**
 * Generates a rotated square Polygon coordinate list (EPSG:4326).
 * center: [lon, lat]
 */
export function buildRotatedSquareGeoJson(
  center: [number, number],
  sizeKm: number,
  bearingDeg: number
): number[][] {
  const lon = center[0];
  const lat = center[1];
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const halfKm = sizeKm / 2;
  const latRad = (lat * Math.PI) / 180;

  // Local corners relative to center [east_km, north_km]
  const localCorners = [
    [-halfKm, -halfKm],
    [halfKm, -halfKm],
    [halfKm, halfKm],
    [-halfKm, halfKm],
  ];

  const coords = localCorners.map(([eKm, nKm]) => {
    // Rotate
    const rotE = eKm * Math.cos(bearingRad) + nKm * Math.sin(bearingRad);
    const rotN = -eKm * Math.sin(bearingRad) + nKm * Math.cos(bearingRad);

    // Convert to offsets
    const pLon = lon + rotE / (111.32 * Math.cos(latRad));
    const pLat = lat + rotN / 111.32
    return [pLon, pLat];
  });

  // Close ring
  return [...coords, coords[0]];
}

export function moveAreaCoordsByWebMercatorDelta(
  coords: [number, number][],
  dx: number,
  dy: number
): [number, number][] {
  return coords.map(([lon, lat]) => {
    const [x, y] = fromLonLat([lon, lat]);
    return toLonLat([x + dx, y + dy]) as [number, number];
  });
}

export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentIntersects(
  a1: [number, number], a2: [number, number],
  b1: [number, number], b2: [number, number],
): boolean {
  const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-12) return false;
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / cross;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / cross;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Returns true if two polygons (arrays of [lon,lat] points) overlap or touch.
 * Handles: A inside B, B inside A, partial overlap, and cross-intersection.
 */
export function polygonsOverlap(
  polyA: [number, number][],
  polyB: [number, number][],
): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;
  for (const pt of polyA) if (pointInPolygon(pt, polyB)) return true;
  for (const pt of polyB) if (pointInPolygon(pt, polyA)) return true;
  for (let i = 0; i < polyA.length - 1; i++) {
    for (let j = 0; j < polyB.length - 1; j++) {
      if (segmentIntersects(polyA[i], polyA[i + 1], polyB[j], polyB[j + 1])) return true;
    }
  }
  return false;
}
