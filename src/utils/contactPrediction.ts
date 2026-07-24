/**
 * contactPrediction.ts
 *
 * Heurystyczny model szacowania czasu do kontaktu między stronami.
 * Opiera się na dyskretnej symulacji minutowej — przesuwa jednostki
 * wzdłuż ich tras i sprawdza odległość między stronami w każdym kroku.
 *
 * NIE jest to realna prognoza taktyczna — wyłącznie abstrakcyjna miara
 * symulacyjna na potrzeby GeoTactical.
 */

import { toLonLat } from "ol/proj";
import { getDistance } from "ol/sphere";
import type { RoutePoint } from "../types/map";

// ─── Typy ────────────────────────────────────────────────────────────────────

export type ContactUnit = {
  id: string;
  x: number;            // EPSG:3857
  y: number;            // EPSG:3857
  base_speed_kmh: number | null;
  route: RoutePoint[];  // Kolejne waypointy (posortowane po order)
};

export type ContactPrediction = {
  currentDistanceKm: number;
  closingSpeedKmh: number;        // Ujemna = oddalają się
  timeToContactMinutes: number | null;  // null gdy nie zbliżają się lub brak ruchu
  willMeet: boolean;
  closestOwnId: string;
  closestTargetId: string;
};

// ─── Pomocnicze ───────────────────────────────────────────────────────────────

type SimUnit = {
  id: string;
  lon: number;
  lat: number;
  speedKmPerMin: number;
  waypoints: Array<[number, number]>; // [lon, lat]
};

function to3857ToLonLat(x: number, y: number): [number, number] {
  return toLonLat([x, y]) as [number, number];
}

function distKm(a: [number, number], b: [number, number]): number {
  return getDistance(a, b) / 1000;
}

function buildSimUnit(unit: ContactUnit, terrainModifiers: Map<string, number>): SimUnit {
  const [lon, lat] = to3857ToLonLat(unit.x, unit.y);
  const terrainMod = terrainModifiers.get(unit.id) ?? 1.0;
  const baseSpeed = unit.base_speed_kmh ?? 30;
  const speedKmPerMin = baseSpeed * terrainMod / 60;

  const sorted = [...unit.route].sort((a, b) => a.order - b.order);
  const waypoints = sorted.map(rp => to3857ToLonLat(rp.x, rp.y));

  return { id: unit.id, lon, lat, speedKmPerMin, waypoints };
}

function advanceUnit(u: SimUnit, minutes: number): SimUnit {
  if (u.waypoints.length === 0 || u.speedKmPerMin <= 0) return u;

  let remainingKm = u.speedKmPerMin * minutes;
  let lon = u.lon;
  let lat = u.lat;
  const waypoints = [...u.waypoints];

  while (remainingKm > 0 && waypoints.length > 0) {
    const [wLon, wLat] = waypoints[0];
    const dKm = distKm([lon, lat], [wLon, wLat]);
    if (dKm <= remainingKm) {
      lon = wLon;
      lat = wLat;
      remainingKm -= dKm;
      waypoints.shift();
    } else {
      const ratio = remainingKm / dKm;
      lon = lon + (wLon - lon) * ratio;
      lat = lat + (wLat - lat) * ratio;
      remainingKm = 0;
    }
  }

  return { ...u, lon, lat, waypoints };
}

function minPairDistance(
  ownSim: SimUnit[],
  targetSim: SimUnit[],
): { distKm: number; ownId: string; targetId: string } {
  let min = Infinity;
  let ownId = ownSim[0]?.id ?? "";
  let targetId = targetSim[0]?.id ?? "";

  for (const o of ownSim) {
    for (const t of targetSim) {
      const d = distKm([o.lon, o.lat], [t.lon, t.lat]);
      if (d < min) {
        min = d;
        ownId = o.id;
        targetId = t.id;
      }
    }
  }
  return { distKm: min, ownId, targetId };
}

// ─── Główna funkcja ───────────────────────────────────────────────────────────

/**
 * Szacuje czas do kontaktu między dwiema stronami.
 *
 * Algorytm: dyskretna symulacja minutowa (max 24h = 1440 kroków).
 * Każdy krok przesuwa jednostki wzdłuż ich tras.
 * Kontakt = minimum odległości < engagementRangeKm.
 *
 * Prędkość zbliżania mierzona po 5 min symulacji (ujemna = oddalają się).
 */
export function predictContactTime(
  ownUnits: ContactUnit[],
  targetUnits: ContactUnit[],
  terrainModifiers: Map<string, number>,
  engagementRangeKm = 0.5,
): ContactPrediction {
  const ownSim  = ownUnits.map(u => buildSimUnit(u, terrainModifiers));
  const tgtSim  = targetUnits.map(u => buildSimUnit(u, terrainModifiers));

  const { distKm: dist0, ownId: closestOwnId, targetId: closestTargetId } =
    minPairDistance(ownSim, tgtSim);

  if (dist0 < engagementRangeKm) {
    return {
      currentDistanceKm: dist0,
      closingSpeedKmh: 0,
      timeToContactMinutes: 0,
      willMeet: true,
      closestOwnId,
      closestTargetId,
    };
  }

  // Sprawdź prędkość zbliżania po 5 minutach
  const ownSim5  = ownSim.map(u => advanceUnit(u, 5));
  const tgtSim5  = tgtSim.map(u => advanceUnit(u, 5));
  const { distKm: dist5 } = minPairDistance(ownSim5, tgtSim5);
  const closingSpeedKmh = ((dist0 - dist5) / 5) * 60;

  // Brak zbliżania lub brak tras po obu stronach
  const anyHasRoute = [...ownUnits, ...targetUnits].some(u => u.route.length > 0);
  if (!anyHasRoute || closingSpeedKmh <= 0) {
    return {
      currentDistanceKm: dist0,
      closingSpeedKmh,
      timeToContactMinutes: null,
      willMeet: false,
      closestOwnId,
      closestTargetId,
    };
  }

  // Symulacja minutowa — max 24h
  const MAX_STEPS = 24 * 60;
  const STEP = 1;
  let curOwn = ownSim;
  let curTgt = tgtSim;

  for (let t = STEP; t <= MAX_STEPS; t += STEP) {
    curOwn = curOwn.map(u => advanceUnit(u, STEP));
    curTgt = curTgt.map(u => advanceUnit(u, STEP));
    const { distKm: d } = minPairDistance(curOwn, curTgt);
    if (d < engagementRangeKm) {
      // eslint-disable-next-line no-console
      console.log(`[CONTACT] Kontakt w ${t} min | odl. startowa: ${dist0.toFixed(2)} km | prędkość zbliżania: ${closingSpeedKmh.toFixed(1)} km/h`);
      return {
        currentDistanceKm: dist0,
        closingSpeedKmh,
        timeToContactMinutes: t,
        willMeet: true,
        closestOwnId,
        closestTargetId,
      };
    }
    // Early exit jeśli odległość rośnie po 30 minutach — nie zbliżają się
    if (t === 30) {
      const { distKm: d30 } = minPairDistance(curOwn, curTgt);
      if (d30 > dist0 + 0.5) break;
    }
  }

  return {
    currentDistanceKm: dist0,
    closingSpeedKmh,
    timeToContactMinutes: null,
    willMeet: false,
    closestOwnId,
    closestTargetId,
  };
}
