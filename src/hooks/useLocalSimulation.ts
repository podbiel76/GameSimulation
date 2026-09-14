import { useState, useRef, useCallback } from "react";
import type { MutableRefObject } from "react";
import { toLonLat } from "ol/proj";
import type { ScenarioMarker, Unit, UnitLogistics, UpdateUnitLogisticsPayload } from "../types/map";
import type { FullState } from "../types/simulation";
import type { UnitArea } from "../api/unitAreasApi";
import type { MapViewHandle } from "../map/MapView";
import type { AreaTerrainBreakdown } from "../utils/terrainClassifier";
import { classifyTerrainFromCanvas, cropTerrainWindow, classifyTerrainForAreaCanvas, TERRAIN_ANALYSIS_ZOOM } from "../utils/terrainClassifier";
import { moveAreaCoordsByWebMercatorDelta, polygonsOverlap, computeBbox, bboxesOverlap } from "../utils/geoUtils";
import type { Bbox } from "../utils/geoUtils";
import { SIM_DEBUG, simLog } from "../utils/debug";
import { updateUnit, updateUnitLogistics } from "../api/unitsApi";
import { updatePolygonArea } from "../api/unitAreasApi";
import { fromLonLat } from "ol/proj";
import { computeUnitPotential, type TerrainClass } from "../utils/combatPotential";
import { fetchTerrainProfile } from "../api/terrainApi";
import { TERRAIN_DEFENSE_RADIUS_M, aoKeyOf, terrainForRole, type UnitTerrainProfile } from "../utils/terrainProfile";

/** Profil terenu odświeżany dopiero po przesunięciu jednostki o tyle metrów. */
const TERRAIN_REFRESH_DISTANCE_M = 250;
import {
  buildAttackerProfile,
  computeAttritionComponents,
  applyAttritionComponents,
  computeMovementFuelBurn,
  classifyUnitType,
  isUnitDestroyed,
} from "../utils/attritionRules";

export const TERRAIN_SPEED_MODIFIERS: Record<string, number> = {
  open: 1.0,
  road: 1.3,
  urban: 0.7,
  forest: 0.5,
  wetland: 0.4,
  water: 0.1,
};

// ─── Engagement simulation constants & types ─────────────────────────────────

export type EngagementInfo = {
  key: string;                  // "fId1,fId2|vs|hId1,hId2"
  friendlyUnitIds: string[];
  hostileUnitIds: string[];
  startTick: number;
  startedAt: number;            // Date.now() timestamp
  // Strona, która w chwili rozpoczęcia starcia była w ruchu (wjechała w AO przeciwnika)
  // jest atakującym, druga — obrońcą. Rola jest ustalana raz i nie zmienia się,
  // nawet gdy atakujący zatrzyma się w AO. null = brak jednoznacznej roli (spotkaniowe / oba w miejscu).
  attackerSide?: "friendly" | "hostile" | null;
};

const ENGAGEMENT_CHECK_TICKS = 10;           // how often to check AO overlap (every 1s at 100ms tick)
const ATTRITION_PERSIST_TICKS = 50;          // how often to PATCH backend (every 5s)
export const ATTRITION_COEFFICIENT = 0.02;  // fraction of opponent's effectivePotential → loss per check
// Strona przegrywa, gdy jej łączny potencjał (skala wyświetlana ×100) spadnie poniżej 1.0,
// czyli suma effectivePotential < 0.01 — strona praktycznie nie ma już zdolności bojowej.
export const SIDE_DEFEAT_POTENTIAL_DISPLAY = 1.0;

const VALID_TERRAIN_SET = new Set(["open", "road", "urban", "forest", "wetland", "water"]);
function toTerrainClass(raw: string | undefined): TerrainClass {
  return (raw && VALID_TERRAIN_SET.has(raw)) ? raw as TerrainClass : "open";
}


function snapshotLogisticsForPatch(log: UnitLogistics): UpdateUnitLogisticsPayload {
  return {
    personnel_available:           log.personnel_available,
    personnel_dead:                log.personnel_dead,
    personnel_wounded:             log.personnel_wounded,
    ammo_small_arms:               log.ammo_small_arms,
    ammo_at:                       log.ammo_at,
    ammo_mortar:                   log.ammo_mortar,
    tanks_operational:             log.tanks_operational,
    ifv_operational:               log.ifv_operational,
    armored_artillery_operational: log.armored_artillery_operational,
    mortars_operational:           log.mortars_operational,
    drones_available:              log.drones_available,
    fuel_liters:                   Math.round(log.fuel_liters ?? 0),
    combat_effectiveness_percent:  log.combat_effectiveness_percent,
  };
}

function weightedTerrainModifier(breakdown: { terrain: string; percent: number }[]): number {
  return breakdown.reduce(
    (sum, b) => sum + (TERRAIN_SPEED_MODIFIERS[b.terrain] ?? 1.0) * (b.percent / 100),
    0
  );
}

export type TerrainPreview = {
  imageUrl: string;
  terrain: string;
  confidence: number;
  areaBreakdown?: AreaTerrainBreakdown["breakdown"];
};

type Options = {
  markersRef: MutableRefObject<ScenarioMarker[]>;
  unitsRef: MutableRefObject<Unit[]>;
  unitAreasRef: MutableRefObject<UnitArea[]>;
  fullStateRef: MutableRefObject<FullState | null>;
  mapHandleRef: MutableRefObject<MapViewHandle | null>;
  selectedUnitIdRef: MutableRefObject<string | null>;
  setMarkers: (markers: ScenarioMarker[]) => void;
  setUnits: (units: Unit[]) => void;
  setUnitAreas: (areas: UnitArea[]) => void;
  setTerrainPreview: (preview: TerrainPreview | null) => void;
  refreshState: () => Promise<void>;
  refreshAreas: () => Promise<void>;
  onUnitDefeated?: (info: { unitId: string; name: string; reason: string; side: string }) => void;
};

export function useLocalSimulation(opts: Options) {
  const {
    markersRef, unitsRef, unitAreasRef, fullStateRef,
    mapHandleRef, selectedUnitIdRef,
    setMarkers, setUnits, setUnitAreas, setTerrainPreview,
    refreshState, refreshAreas,
  } = opts;

  // Trzymane w refie, aby pętla symulacji (zamknięcie startSimulation) zawsze
  // wołała aktualny callback, a nie wersję z momentu uruchomienia symulacji.
  const onUnitDefeatedRef = useRef(opts.onUnitDefeated);
  onUnitDefeatedRef.current = opts.onUnitDefeated;

  const [simRunning, setSimRunning] = useState(false);
  const [simSpeedKmh, setSimSpeedKmhState] = useState(30);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simSpeedRef = useRef(30);
  const simTickCountRef = useRef(0);

  // ── Skala czasu (mnożnik ×1/×8/×20/×60 z górnego paska) ────────────────────
  // Mnoży dystans pokonywany w ticku. Bezpieczne, bo krok jest mały względem AO:
  // przy 30 km/h tick to 0,83 m, więc nawet ×60 daje 50 m — a AO mają kilometry.
  // Gęstość wykrywania starć utrzymujemy stałą w czasie SYMULOWANYM, skracając
  // odstęp między sprawdzeniami proporcjonalnie do mnożnika.
  const timeScaleRef = useRef(1);
  const [timeScale, setTimeScaleState] = useState(1);
  const setTimeScale = useCallback((v: number) => {
    timeScaleRef.current = v;
    setTimeScaleState(v);
  }, []);

  // Zegar misji w sekundach symulowanych. Trzymany w refie (rośnie co tick),
  // do stanu przepisywany rzadziej — inaczej wymuszałby render 10×/s.
  const missionClockRef = useRef(0);
  const [missionClockSec, setMissionClockSec] = useState(0);
  const resetMissionClock = useCallback(() => {
    missionClockRef.current = 0;
    setMissionClockSec(0);
  }, []);

  // „Krok 15 min" — przewinięcie o zadany czas symulowany i zatrzymanie.
  // Realizowane przez zwykłą pętlę z docelową wartością zegara, a nie przez
  // jeden wielki krok: dzięki temu ruch i wykrywanie starć liczą się tak samo
  // jak przy normalnym biegu (jeden duży skok mógłby przenieść jednostkę przez
  // całe AO przeciwnika bez wykrycia kontaktu).
  const burstTargetRef = useRef<number | null>(null);
  const scaleBeforeBurstRef = useRef<number | null>(null);
  // Pętla musi umieć zatrzymać samą siebie, a stopSimulation powstaje niżej.
  const stopSimulationRef = useRef<(() => void) | null>(null);
  const unitTerrainModifiersRef = useRef<Map<string, number>>(new Map());
  // Dominant terrain class per unit — populated by checkTerrainForUnit / checkTerrainForUnitArea
  const unitTerrainClassRef = useRef<Map<string, string>>(new Map());

  // Engagement tracking
  const activeEngagementsRef = useRef<Map<string, EngagementInfo>>(new Map());
  const pendingLogisticsRef  = useRef<Map<string, UpdateUnitLogisticsPayload>>(new Map());
  const [activeEngagementUnitIds, setActiveEngagementUnitIds] = useState<Set<string>>(new Set());
  const [activeEngagementsState, setActiveEngagementsState] = useState<EngagementInfo[]>([]);

  const setSimSpeedKmh = useCallback((v: number) => {
    setSimSpeedKmhState(v);
    simSpeedRef.current = v;
  }, []);

  // Profil terenu z backendu (WorldCover + DEM): obrona — otoczenie jednostki,
  // natarcie i manewr — AO. Analiza kolorów mapy zostaje jako rezerwa, gdy
  // backend nie ma danych terenu.
  const unitTerrainProfileRef = useRef<Map<string, UnitTerrainProfile>>(new Map());
  const terrainInflightRef = useRef<Set<string>>(new Set());
  const [, setTerrainProfileVersion] = useState(0);

  const refreshTerrainProfile = useCallback(async (
    unitId: string,
    options?: { force?: boolean },
  ): Promise<UnitTerrainProfile | null> => {
    const unit = unitsRef.current.find(u => u.id === unitId);
    if (!unit) return null;
    const [lon, lat] = toLonLat([unit.x, unit.y]) as [number, number];
    const area = unitAreasRef.current.find(a => a.unit_id === unitId && a.area_type === "responsibility");
    const ao = (area?.coordinates as [number, number][] | null | undefined) ?? null;
    const aoKey = aoKeyOf(ao);

    const prev = unitTerrainProfileRef.current.get(unitId);
    if (!options?.force && prev && prev.aoKey === aoKey) {
      const movedM = Math.hypot(
        (lat - prev.lat) * 110_574,
        (lon - prev.lon) * 111_320 * Math.cos(lat * Math.PI / 180),
      );
      if (movedM < TERRAIN_REFRESH_DISTANCE_M) return prev;
    }
    if (terrainInflightRef.current.has(unitId)) return prev ?? null;

    terrainInflightRef.current.add(unitId);
    try {
      const res = await fetchTerrainProfile({ lon, lat, radius_m: TERRAIN_DEFENSE_RADIUS_M, ao });
      const profile: UnitTerrainProfile = { ...res, lon, lat, aoKey, fetchedAt: Date.now() };
      unitTerrainProfileRef.current.set(unitId, profile);
      if (res.available && res.local) {
        unitTerrainClassRef.current.set(unitId, res.local.dominant);
        // Manewr (prędkość) — rozkład terenu w AO; bez AO — otoczenie jednostki.
        const shares = res.ao?.shares ?? res.local.shares;
        const total = Object.values(shares).reduce((s, v) => s + v, 0);
        const speedMod = total > 0
          ? Object.entries(shares).reduce((s, [c, v]) => s + (TERRAIN_SPEED_MODIFIERS[c] ?? 1.0) * v, 0) / total
          : 1.0;
        unitTerrainModifiersRef.current.set(unitId, speedMod);
      }
      setTerrainProfileVersion(v => v + 1);
      return profile;
    } catch (err) {
      console.warn("[TERRAIN] Profil terenu niedostępny:", err);
      return prev ?? null;
    } finally {
      terrainInflightRef.current.delete(unitId);
    }
  }, [unitsRef, unitAreasRef]);

  const checkTerrainForUnit = useCallback(async (unitId: string) => {
    const profile = await refreshTerrainProfile(unitId, { force: true });
    if (profile?.available) return;
    const unit = unitsRef.current.find(u => u.id === unitId);
    if (!unit || !mapHandleRef.current) return;
    const canvasData = mapHandleRef.current.captureCanvasAtZoom([unit.x, unit.y], TERRAIN_ANALYSIS_ZOOM);
    if (!canvasData) return;
    const [result, cropUrl] = await Promise.all([
      classifyTerrainFromCanvas(canvasData.image, canvasData.cx, canvasData.cy),
      cropTerrainWindow(canvasData.image, canvasData.cx, canvasData.cy),
    ]);
    if (result) {
      const mod = TERRAIN_SPEED_MODIFIERS[result.terrain] ?? 1.0;
      unitTerrainModifiersRef.current.set(unitId, mod);
      unitTerrainClassRef.current.set(unitId, result.terrain);
      setTerrainPreview({ imageUrl: cropUrl ?? "", terrain: result.terrain, confidence: result.confidence });
    }
  }, [unitsRef, mapHandleRef, setTerrainPreview, refreshTerrainProfile]);

  const checkTerrainForUnitArea = useCallback(async (unitId: string) => {
    const profile = await refreshTerrainProfile(unitId, { force: true });
    if (profile?.available) return;
    const area = unitAreasRef.current.find(a => a.unit_id === unitId && a.area_type === "responsibility");
    if (!area?.coordinates || !mapHandleRef.current) return;

    const coords3857 = (area.coordinates as [number, number][]).map(
      ([lon, lat]) => fromLonLat([lon, lat]) as [number, number]
    );
    const canvasData = mapHandleRef.current.captureCanvasForArea(coords3857);
    if (!canvasData) return;

    const result = await classifyTerrainForAreaCanvas(
      canvasData.image, canvasData.width, canvasData.height,
      canvasData.dpr, canvasData.pixelCoords,
    );
    if (!result) return;

    const mod = weightedTerrainModifier(result.breakdown);
    unitTerrainModifiersRef.current.set(unitId, mod);
    unitTerrainClassRef.current.set(unitId, result.dominant);

    setTerrainPreview({
      imageUrl: `data:image/png;base64,${canvasData.image}`,
      terrain: result.dominant,
      confidence: result.breakdown.find(b => b.terrain === result.dominant)?.percent ?? 0,
      areaBreakdown: result.breakdown,
    });
  }, [unitAreasRef, mapHandleRef, setTerrainPreview, refreshTerrainProfile]);

  const startSimulation = useCallback(() => {
    if (simRef.current) return;

    setSimRunning(true);
    simTickCountRef.current = 0;

    simRef.current = setInterval(async () => {
      const currentMarkers = markersRef.current;
      const currentUnits = unitsRef.current;
      const currentAreas = unitAreasRef.current;
      const hierarchy = fullStateRef.current?.hierarchy || [];

      const parentByChild = new Map<string, string>();
      const childrenByParent = new Map<string, string[]>();

      for (const link of hierarchy) {
        parentByChild.set(link.child_unit_id, link.parent_unit_id);
        const children = childrenByParent.get(link.parent_unit_id) ?? [];
        children.push(link.child_unit_id);
        childrenByParent.set(link.parent_unit_id, children);
      }

      function getDescendantIds(unitId: string) {
        const result = new Set<string>();
        const stack = [...(childrenByParent.get(unitId) ?? [])];
        while (stack.length) {
          const childId = stack.pop();
          if (!childId || result.has(childId)) continue;
          result.add(childId);
          stack.push(...(childrenByParent.get(childId) ?? []));
        }
        return result;
      }

      const finishedUnits: {
        id: string;
        x: number;
        y: number;
        lon: number;
        lat: number;
        movedAreas: UnitArea[];
      }[] = [];

      let anyMovedInTick = false;
      const movedMarkerIds: string[] = [];

      let nextAreas = currentAreas;
      let nextUnits = currentUnits;

      const nextMarkers = currentMarkers.map((marker) => {
        if (marker.route.length === 0) return marker;
        if (parentByChild.has(marker.id)) return { ...marker, route: [] };

        anyMovedInTick = true;
        movedMarkerIds.push(marker.id);

        const sortedRoute = [...marker.route].sort((a, b) => a.order - b.order);
        const target = sortedRoute[0];

        const currentUnit = nextUnits.find((u) => u.id === marker.id);
        const oldX = currentUnit?.x ?? marker.x;
        const oldY = currentUnit?.y ?? marker.y;

        const unitBaseSpeed = currentUnit?.base_speed_kmh ?? simSpeedRef.current;
        const terrainMod = unitTerrainModifiersRef.current.get(marker.id) ?? 1.0;
        const speedMpt = unitBaseSpeed * terrainMod * 1000 / 36000 * timeScaleRef.current;
        simLog(() => {
          const effectiveKmh = unitBaseSpeed * terrainMod;
          return [`[SIM] ${currentUnit?.custom_name ?? currentUnit?.symbol_name ?? marker.id} | base: ${unitBaseSpeed} km/h | terrain ×${terrainMod.toFixed(2)} | effective: ${effectiveKmh.toFixed(1)} km/h`];
        });

        const dx = target.x - oldX;
        const dy = target.y - oldY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let newX: number, newY: number, newRoute: typeof marker.route;

        if (dist <= speedMpt) {
          newX = target.x;
          newY = target.y;
          newRoute = sortedRoute.slice(1).map((rp, i) => ({ ...rp, order: i }));
        } else {
          const ratio = speedMpt / dist;
          newX = oldX + dx * ratio;
          newY = oldY + dy * ratio;
          newRoute = marker.route;
        }

        const actualDx = newX - oldX;
        const actualDy = newY - oldY;
        const [newLon, newLat] = toLonLat([newX, newY]) as [number, number];

        // Fuel burn proportional to distance moved
        if (currentUnit?.logistics?.fuel_liters != null) {
          const distMeters = Math.sqrt(actualDx * actualDx + actualDy * actualDy);
          const fuelBurn = computeMovementFuelBurn(currentUnit as any, distMeters);
          if (fuelBurn > 0) {
            nextUnits = nextUnits.map(u => {
              if (u.id !== marker.id || !u.logistics) return u;
              return { ...u, logistics: { ...u.logistics, fuel_liters: Math.max(0, (u.logistics.fuel_liters ?? 0) - fuelBurn) } };
            });
          }
        }

        const descendantIds = Array.from(getDescendantIds(marker.id));
        const affectedIds = [marker.id, ...descendantIds];

        nextAreas = nextAreas.map((area) => {
          if (!affectedIds.includes(area.unit_id) || !area.coordinates) return area;
          return {
            ...area,
            coordinates: moveAreaCoordsByWebMercatorDelta(
              area.coordinates as [number, number][],
              actualDx,
              actualDy
            ),
          };
        });

        nextUnits = nextUnits.map((u) => {
          if (!affectedIds.includes(u.id)) return u;
          if (u.id === marker.id) {
            return { ...u, x: newX, y: newY, position_lon: newLon, position_lat: newLat };
          }
          const childNewX = u.x + actualDx;
          const childNewY = u.y + actualDy;
          const [childNewLon, childNewLat] = toLonLat([childNewX, childNewY]) as [number, number];
          return { ...u, x: childNewX, y: childNewY, position_lon: childNewLon, position_lat: childNewLat };
        });

        if (newRoute.length === 0) {
          for (const affectedId of affectedIds) {
            const movedUnit = nextUnits.find(u => u.id === affectedId);
            if (movedUnit) {
              finishedUnits.push({
                id: movedUnit.id,
                x: movedUnit.x,
                y: movedUnit.y,
                lon: movedUnit.position_lon || movedUnit.x,
                lat: movedUnit.position_lat || movedUnit.y,
                movedAreas: nextAreas.filter(a => a.unit_id === movedUnit.id),
              });
            }
          }
        }

        return { ...marker, x: newX, y: newY, route: newRoute };
      });

      const finalMarkers = nextMarkers.map(m => {
        if (m.route.length > 0) return m;
        const nextU = nextUnits.find(u => u.id === m.id);
        if (nextU) return { ...m, x: nextU.x, y: nextU.y };
        return m;
      });

      // ── Engagement detection & attrition ─────────────────────────────────
      // Odstęp skalowany mnożnikiem: przy ×60 sprawdzamy co tick, żeby na jedną
      // sekundę SYMULOWANĄ przypadała ta sama liczba sprawdzeń co przy ×1.
      const engagementInterval = Math.max(1, Math.round(ENGAGEMENT_CHECK_TICKS / timeScaleRef.current));
      if (simTickCountRef.current % engagementInterval === 0) {
        const unitMap = new Map(nextUnits.map(u => [u.id, u]));
        const respAreas = nextAreas.filter(
          a => a.area_type === "responsibility" &&
               Array.isArray(a.coordinates) &&
               (a.coordinates as unknown[]).length >= 3
        );
        // Destroyed units (no personnel left to fight) drop out of engagements entirely.
        // AABB is computed once per area here, not once per pair inside the sweep below.
        const prepareSide = (side: "friendly" | "hostile") =>
          respAreas.reduce<{ unitId: string; coords: [number, number][]; bbox: Bbox }[]>((acc, a) => {
            const u = unitMap.get(a.unit_id);
            if (u?.side !== side || isUnitDestroyed(u as any)) return acc;
            if (!a.coordinates) return acc;
            const coords = a.coordinates as [number, number][];
            acc.push({ unitId: a.unit_id, coords, bbox: computeBbox(coords) });
            return acc;
          }, []);

        const friendlyAreas = prepareSide("friendly");
        const hostileAreas  = prepareSide("hostile");

        // ── Step 1: collect all overlapping pairs ──
        const friendlyToHostiles = new Map<string, Set<string>>();
        const hostileToFriendlies = new Map<string, Set<string>>();

        for (const fa of friendlyAreas) {
          for (const ha of hostileAreas) {
            // Broad phase first — disjoint AABBs skip the O(vA×vB) narrow phase entirely.
            if (!bboxesOverlap(fa.bbox, ha.bbox)) continue;
            if (!polygonsOverlap(fa.coords, ha.coords, fa.bbox, ha.bbox)) continue;
            if (!friendlyToHostiles.has(fa.unitId)) friendlyToHostiles.set(fa.unitId, new Set());
            friendlyToHostiles.get(fa.unitId)!.add(ha.unitId);
            if (!hostileToFriendlies.has(ha.unitId)) hostileToFriendlies.set(ha.unitId, new Set());
            hostileToFriendlies.get(ha.unitId)!.add(fa.unitId);
          }
        }

        // ── Step 2: BFS connected components on the bipartite overlap graph ──
        type BattleGroup = { friendlyIds: Set<string>; hostileIds: Set<string> };
        const visitedFriendly = new Set<string>();
        const visitedHostile  = new Set<string>();
        const battleGroups: BattleGroup[] = [];

        for (const startFId of friendlyToHostiles.keys()) {
          if (visitedFriendly.has(startFId)) continue;
          const group: BattleGroup = { friendlyIds: new Set(), hostileIds: new Set() };
          const queue = [startFId];
          while (queue.length > 0) {
            const fId = queue.pop()!;
            if (visitedFriendly.has(fId)) continue;
            visitedFriendly.add(fId);
            group.friendlyIds.add(fId);
            for (const hId of (friendlyToHostiles.get(fId) ?? [])) {
              if (visitedHostile.has(hId)) continue;
              visitedHostile.add(hId);
              group.hostileIds.add(hId);
              for (const f2 of (hostileToFriendlies.get(hId) ?? [])) {
                if (!visitedFriendly.has(f2)) queue.push(f2);
              }
            }
          }
          battleGroups.push(group);
        }

        // ── Step 3: build new engagement map with preserved startedAt ──
        const newActiveEngagements = new Map<string, EngagementInfo>();

        // Jednostka z aktywną trasą jest w ruchu — to ona "wjeżdża" w AO przeciwnika.
        const hasRoute = (id: string) =>
          (finalMarkers.find(m => m.id === id)?.route.length ?? 0) > 0;

        for (const group of battleGroups) {
          const sortedFIds = [...group.friendlyIds].sort();
          const sortedHIds = [...group.hostileIds].sort();
          const key = `${sortedFIds.join(",")}|vs|${sortedHIds.join(",")}`;

          let startedAt = Date.now();
          let startTick = simTickCountRef.current;
          let isNew = true;
          let attackerSide: "friendly" | "hostile" | null = null;

          const exact = activeEngagementsRef.current.get(key);
          if (exact) {
            startedAt = exact.startedAt;
            startTick  = exact.startTick;
            attackerSide = exact.attackerSide ?? null;
            isNew = false;
          } else {
            // Battle group changed shape — inherit startedAt from earliest overlapping engagement
            for (const oldEng of activeEngagementsRef.current.values()) {
              const sharesF = oldEng.friendlyUnitIds.some(id => group.friendlyIds.has(id));
              const sharesH = oldEng.hostileUnitIds.some(id => group.hostileIds.has(id));
              if (sharesF && sharesH && oldEng.startedAt < startedAt) {
                startedAt = oldEng.startedAt;
                startTick  = oldEng.startTick;
                attackerSide = oldEng.attackerSide ?? null;
                isNew = false;
              }
            }
          }

          // Ustal rolę raz, na początku starcia: strona poruszająca się = atakujący,
          // stojąca = obrońca. Jeśli ruszają się obie lub żadna — brak jednoznacznej roli.
          if (isNew) {
            const friendlyMoving = sortedFIds.some(hasRoute);
            const hostileMoving  = sortedHIds.some(hasRoute);
            attackerSide =
              friendlyMoving && !hostileMoving ? "friendly" :
              hostileMoving && !friendlyMoving ? "hostile" :
              null;
            // eslint-disable-next-line no-console
            console.log(
              `[ENGAGEMENT] START [${sortedFIds.map(id => unitMap.get(id)?.custom_name ?? id).join(", ")}]` +
              ` ↔ [${sortedHIds.map(id => unitMap.get(id)?.custom_name ?? id).join(", ")}]` +
              ` — atakujący: ${attackerSide ?? "brak (spotkaniowe)"}`
            );
          }

          newActiveEngagements.set(key, { key, friendlyUnitIds: sortedFIds, hostileUnitIds: sortedHIds, startTick, startedAt, attackerSide });

          // ── Step 4: attrition using combined potentials + typed rules ──
          // Rola jest ustalona dla całego starcia (zablokowana w attackerSide).
          const roleForSide = (side: "friendly" | "hostile") =>
            attackerSide === null ? "neutral" :
            attackerSide === side ? "attacker" : "defender";

          // Per-tick log: z jakich wartości liczony jest potencjał danej jednostki.
          const logPotential = (
            u: Unit, role: string,
            b: ReturnType<typeof computeUnitPotential>["breakdown"],
          ) => {
            if (!SIM_DEBUG) return;
            const lg = u.logistics ?? ({} as any);
            // eslint-disable-next-line no-console
            console.log(
              `[POTENCJAŁ] ${u.custom_name ?? u.symbol_name ?? u.id} (${classifyUnitType(u as any)}, ${role})` +
              ` efektywny=${(b.effectivePotential * 100).toFixed(1)} statyczny=${(b.staticPotential * 100).toFixed(1)}`,
              {
                wejscie: {
                  personel: `${lg.personnel_available ?? 0}/${lg.personnel_total ?? 0}`,
                  ammoSA: lg.ammo_small_arms ?? 0,
                  ammoAT: lg.ammo_at ?? 0,
                  ammoMozdz: lg.ammo_mortar ?? 0,
                  ammoMain: lg.ammo_main ?? "-",
                  czołgi: `${lg.tanks_operational ?? 0}/${lg.tanks_total ?? 0}`,
                  bwp: `${lg.ifv_operational ?? 0}/${lg.ifv_total ?? 0}`,
                  artOpanc: `${lg.armored_artillery_operational ?? 0}/${lg.armored_artillery_total ?? 0}`,
                  moździerze: `${lg.mortars_operational ?? 0}/${lg.mortars_total ?? 0}`,
                  drony: `${lg.drones_available ?? 0}/${lg.drones_total ?? 0}`,
                  paliwo: Math.round(lg.fuel_liters ?? 0),
                  CE: lg.combat_effectiveness_percent ?? 100,
                  teren: b.terrain,
                },
                kategorie: {
                  piechota: b.infantry.toFixed(3),
                  pancerne: b.armor.toFixed(3),
                  artyleria: b.artillery.toFixed(3),
                  przeciwlot: b.anti_air.toFixed(3),
                  powietrze: b.air.toFixed(3),
                },
                modyfikatory: {
                  gotowość: b.readinessModifier.toFixed(2),
                  personel: b.personnelModifier.toFixed(2),
                  mobilność: b.mobilityModifier.toFixed(2),
                  teren: b.terrainModifier.toFixed(2),
                  CE: b.combatEffectivenessModifier.toFixed(2),
                },
              }
            );
          };

          const friendlyBreakdowns = sortedFIds.map(id => {
            const u = unitMap.get(id);
            if (!u) return null;
            const role = roleForSide("friendly");
            if (!unitTerrainProfileRef.current.has(id)) void refreshTerrainProfile(id);
            const terrain = terrainForRole(unitTerrainProfileRef.current.get(id), role, toTerrainClass(unitTerrainClassRef.current.get(id)));
            const b = computeUnitPotential(u as any, terrain, undefined, role).breakdown;
            logPotential(u, role, b);
            return b;
          }).filter(Boolean) as ReturnType<typeof computeUnitPotential>["breakdown"][];

          const hostileBreakdowns = sortedHIds.map(id => {
            const u = unitMap.get(id);
            if (!u) return null;
            const role = roleForSide("hostile");
            if (!unitTerrainProfileRef.current.has(id)) void refreshTerrainProfile(id);
            const terrain = terrainForRole(unitTerrainProfileRef.current.get(id), role, toTerrainClass(unitTerrainClassRef.current.get(id)));
            const b = computeUnitPotential(u as any, terrain, undefined, role).breakdown;
            logPotential(u, role, b);
            return b;
          }).filter(Boolean) as ReturnType<typeof computeUnitPotential>["breakdown"][];

          const friendlyTotalPot = friendlyBreakdowns.reduce((s, b) => s + b.effectivePotential, 0);
          const hostileTotalPot  = hostileBreakdowns.reduce((s, b) => s + b.effectivePotential, 0);

          // Porażka strony: łączny potencjał (×100) poniżej progu → cała strona przegrywa starcie.
          const friendlySideDefeated = friendlyTotalPot * 100 < SIDE_DEFEAT_POTENTIAL_DISPLAY;
          const hostileSideDefeated  = hostileTotalPot  * 100 < SIDE_DEFEAT_POTENTIAL_DISPLAY;

          // Extract ammo_at per unit for hasEffectiveAT detection
          const ammoAtMap = new Map<string, number>();
          for (const id of [...sortedFIds, ...sortedHIds]) {
            const u = unitMap.get(id);
            ammoAtMap.set(id, u?.logistics?.ammo_at ?? 0);
          }

          const hostileProfile  = buildAttackerProfile(hostileBreakdowns,  ammoAtMap, sortedHIds, unitMap as Map<string, any>);
          const friendlyProfile = buildAttackerProfile(friendlyBreakdowns, ammoAtMap, sortedFIds, unitMap as Map<string, any>);

          // Compact combat log — shows what is fed into the fight and the losses applied this tick
          const logCombat = (
            u: Unit, role: string, baseLoss: number,
            c: ReturnType<typeof computeAttritionComponents>,
          ) => {
            if (!SIM_DEBUG) return;
            const lg = u.logistics ?? ({} as any);
            // eslint-disable-next-line no-console
            console.log(
              {
                stan: {
                  personel: lg.personnel_available ?? 0,
                  czołgi: lg.tanks_operational ?? 0,
                  bwp: lg.ifv_operational ?? 0,
                  moździerze: lg.mortars_operational ?? 0,
                  drony: lg.drones_available ?? 0,
                  ammoSA: lg.ammo_small_arms ?? 0,
                  ammoAT: lg.ammo_at ?? 0,
                  ammoMozdz: lg.ammo_mortar ?? 0,
                  ammoMain: lg.ammo_main ?? "-",
                  paliwo: Math.round(lg.fuel_liters ?? 0),
                  CE: (lg.combat_effectiveness_percent ?? 100).toFixed(1),
                },
                stratyTick: {
                  personel: c.personnelLoss, KIA: c.personnelDead, WIA: c.personnelWounded,
                  czołgi: c.tankLoss, bwp: c.ifvLoss, moździerze: c.mortarLoss, drony: c.droneLoss,
                  spalSA: c.ammoSmallArmsBurn, spalAT: c.ammoAtBurn, spalMozdz: c.mortarAmmoBurn,
                  spalPaliwo: Math.round(c.fuelBurn), spadekCE: c.ceDrop.toFixed(3),
                },
              }
            );
          };

          // Jednostka wypada z walki z jednego z trzech powodów:
          //  1. brak zdolnego personelu (wszyscy ranni/martwi) — zniszczona,
          //  2. łączny potencjał jej strony spadł poniżej progu — strona przegrała,
          //  3. brak amunicji dla piechoty — jednostka się poddaje.
          const markDefeatedIfNeeded = (unit: Unit, sideDefeated: boolean): Unit => {
            const lg = unit.logistics;
            if (!lg) return unit;
            if (unit.readiness_status === "destroyed") return unit;
            const name = unit.custom_name ?? unit.symbol_name ?? unit.id;
            if ((lg.personnel_available ?? 0) <= 0) {
              // eslint-disable-next-line no-console
              console.log(`[ZNISZCZONA] ${name} — brak ludzi zdolnych do walki`);
              onUnitDefeatedRef.current?.({ unitId: unit.id, name, side: unit.side, reason: "Brak ludzi zdolnych do walki — jednostka została zniszczona." });
              return { ...unit, readiness_status: "destroyed" };
            }
            if (sideDefeated) {
              // eslint-disable-next-line no-console
              console.log(`[PRZEGRANA] ${name} — łączny potencjał strony spadł poniżej ${SIDE_DEFEAT_POTENTIAL_DISPLAY}`);
              onUnitDefeatedRef.current?.({ unitId: unit.id, name, side: unit.side, reason: "Łączny potencjał strony spadł poniżej progu — jednostka przegrała walkę." });
              return { ...unit, readiness_status: "destroyed" };
            }
            if ((lg.ammo_small_arms ?? 0) <= 0) {
              // eslint-disable-next-line no-console
              console.log(`[PODDANIE] ${name} — brak amunicji dla piechoty`);
              onUnitDefeatedRef.current?.({ unitId: unit.id, name, side: unit.side, reason: "Brak amunicji dla piechoty — jednostka się poddała." });
              return { ...unit, readiness_status: "destroyed" };
            }
            return unit;
          };

          for (const fId of sortedFIds) {
            const u = unitMap.get(fId);
            if (!u) continue;
            const baseLoss = hostileTotalPot * ATTRITION_COEFFICIENT;
            const components = computeAttritionComponents(u as any, baseLoss, hostileProfile);
            logCombat(u as Unit, "obrońca/friendly", baseLoss, components);
            const after = markDefeatedIfNeeded(applyAttritionComponents(u as any, components) as Unit, friendlySideDefeated);
            if (after.readiness_status === "destroyed" && (u as Unit).readiness_status !== "destroyed") {
              void updateUnit(fId, { readiness_status: "destroyed" }).catch(err =>
                console.error(`[ENGAGEMENT] Failed to persist destroyed status for ${fId}:`, err));
            }
            nextUnits = nextUnits.map(x => x.id === fId ? after : x);
            unitMap.set(fId, after);
            if (after.logistics) pendingLogisticsRef.current.set(fId, snapshotLogisticsForPatch(after.logistics));
          }

          for (const hId of sortedHIds) {
            const u = unitMap.get(hId);
            if (!u) continue;
            const baseLoss = friendlyTotalPot * ATTRITION_COEFFICIENT;
            const components = computeAttritionComponents(u as any, baseLoss, friendlyProfile);
            logCombat(u as Unit, "obrońca/hostile", baseLoss, components);
            const after = markDefeatedIfNeeded(applyAttritionComponents(u as any, components) as Unit, hostileSideDefeated);
            if (after.readiness_status === "destroyed" && (u as Unit).readiness_status !== "destroyed") {
              void updateUnit(hId, { readiness_status: "destroyed" }).catch(err =>
                console.error(`[ENGAGEMENT] Failed to persist destroyed status for ${hId}:`, err));
            }
            nextUnits = nextUnits.map(x => x.id === hId ? after : x);
            unitMap.set(hId, after);
            if (after.logistics) pendingLogisticsRef.current.set(hId, snapshotLogisticsForPatch(after.logistics));
          }
        }

        // Detect ended engagements
        for (const [key, eng] of activeEngagementsRef.current) {
          if (!newActiveEngagements.has(key)) {
            // eslint-disable-next-line no-console
            console.log(
              `[ENGAGEMENT] END [${eng.friendlyUnitIds.join(", ")}] ↔ [${eng.hostileUnitIds.join(", ")}]` +
              ` (${simTickCountRef.current - eng.startTick} ticks)`
            );
          }
        }
        activeEngagementsRef.current = newActiveEngagements;

        // Update React state for UI indicators
        const engagedIds = new Set<string>();
        const engagementsArr: EngagementInfo[] = [];
        for (const eng of newActiveEngagements.values()) {
          eng.friendlyUnitIds.forEach(id => engagedIds.add(id));
          eng.hostileUnitIds.forEach(id => engagedIds.add(id));
          engagementsArr.push(eng);
        }
        setActiveEngagementUnitIds(engagedIds);
        setActiveEngagementsState(engagementsArr);
      }

      // ── Persist attrition to backend ──────────────────────────────────────
      if (
        simTickCountRef.current % ATTRITION_PERSIST_TICKS === 0 &&
        pendingLogisticsRef.current.size > 0
      ) {
        const toFlush = new Map(pendingLogisticsRef.current);
        pendingLogisticsRef.current.clear();
        void (async () => {
          for (const [unitId, payload] of toFlush) {
            try {
              await updateUnitLogistics(unitId, payload);
            } catch (err) {
              console.error(`[ENGAGEMENT] Failed to persist attrition for ${unitId}:`, err);
            }
          }
        })();
      }

      markersRef.current = finalMarkers;
      unitsRef.current = nextUnits;
      unitAreasRef.current = nextAreas;

      setMarkers(finalMarkers);
      setUnits(nextUnits);
      setUnitAreas(nextAreas);

      // Zegar misji: 1 tick = 100 ms rzeczywiste × mnożnik czasu.
      missionClockRef.current += 0.1 * timeScaleRef.current;
      if (simTickCountRef.current % 5 === 0) setMissionClockSec(missionClockRef.current);

      // Koniec przewijania („Krok 15 min") — zatrzymaj po osiągnięciu celu.
      if (burstTargetRef.current !== null && missionClockRef.current >= burstTargetRef.current) {
        setMissionClockSec(missionClockRef.current);
        stopSimulationRef.current?.();
      }

      simTickCountRef.current++;
      if (anyMovedInTick && simTickCountRef.current % 10 === 0 && movedMarkerIds.length > 0) {
        const tickBatch = Math.floor(simTickCountRef.current / 10);
        const unitIdToCheck = movedMarkerIds[tickBatch % movedMarkerIds.length];
        // Backend odświeża profil dopiero po przesunięciu o TERRAIN_REFRESH_DISTANCE_M.
        const knownProfile = unitIdToCheck ? unitTerrainProfileRef.current.get(unitIdToCheck) : undefined;
        if (unitIdToCheck) void refreshTerrainProfile(unitIdToCheck);
        // Analiza kolorów mapy — tylko gdy backend nie ma danych terenu.
        if (unitIdToCheck && mapHandleRef.current && !knownProfile?.available) {
          const unitToCheck = nextUnits.find(u => u.id === unitIdToCheck);
          if (unitToCheck) {
            const unitArea = nextAreas.find(a => a.unit_id === unitIdToCheck && a.area_type === "responsibility");

            if (unitArea?.coordinates) {
              // Unit has AO — analyse the whole polygon
              const coords3857 = (unitArea.coordinates as [number, number][]).map(
                ([lon, lat]) => fromLonLat([lon, lat]) as [number, number]
              );
              const canvasData = mapHandleRef.current.captureCanvasForArea(coords3857);
              if (canvasData) {
                void classifyTerrainForAreaCanvas(
                  canvasData.image, canvasData.width, canvasData.height,
                  canvasData.dpr, canvasData.pixelCoords,
                ).then(result => {
                  if (!result || unitTerrainProfileRef.current.get(unitIdToCheck)?.available) return;
                  const mod = weightedTerrainModifier(result.breakdown);
                  unitTerrainModifiersRef.current.set(unitIdToCheck, mod);
                  unitTerrainClassRef.current.set(unitIdToCheck, result.dominant);
                  if (unitIdToCheck === selectedUnitIdRef.current) {
                    setTerrainPreview({
                      imageUrl: `data:image/png;base64,${canvasData.image}`,
                      terrain: result.dominant,
                      confidence: result.breakdown.find(b => b.terrain === result.dominant)?.percent ?? 0,
                      areaBreakdown: result.breakdown,
                    });
                  }
                });
              }
            } else {
              // No AO — point-based check at unit position
              const canvasData = mapHandleRef.current.captureCanvasAtZoom(
                [unitToCheck.x, unitToCheck.y], TERRAIN_ANALYSIS_ZOOM
              );
              if (canvasData) {
                void classifyTerrainFromCanvas(canvasData.image, canvasData.cx, canvasData.cy, 64, false)
                  .then(result => {
                    if (!result || unitTerrainProfileRef.current.get(unitIdToCheck)?.available) return;
                    const mod = TERRAIN_SPEED_MODIFIERS[result.terrain] ?? 1.0;
                    unitTerrainModifiersRef.current.set(unitIdToCheck, mod);
                    unitTerrainClassRef.current.set(unitIdToCheck, result.terrain);
                    if (unitIdToCheck === selectedUnitIdRef.current) {
                      void cropTerrainWindow(canvasData.image, canvasData.cx, canvasData.cy)
                        .then(cropUrl => {
                          setTerrainPreview({ imageUrl: cropUrl ?? "", terrain: result.terrain, confidence: result.confidence });
                        });
                    }
                  });
              }
            }
          }
        }
      }

      if (finishedUnits.length > 0) {
        for (const finish of finishedUnits) {
          try {
            await updateUnit(finish.id, {
              x: finish.x,
              y: finish.y,
              position_lon: finish.lon,
              position_lat: finish.lat,
            });
            for (const area of finish.movedAreas) {
              if (!area.coordinates) continue;
              await updatePolygonArea(area.id, {
                coordinates: area.coordinates as [number, number][],
                name: area.name || undefined,
                area_type: area.area_type,
                recenter_unit: false,
                skip_validation: true,
              });
            }
          } catch (err) {
            console.error(`Failed to save unit ${finish.id} final state:`, err);
          }
        }
        await refreshState();
        await refreshAreas();
      }
    }, 100);
  }, [
    markersRef, unitsRef, unitAreasRef, fullStateRef,
    mapHandleRef, selectedUnitIdRef,
    setMarkers, setUnits, setUnitAreas, setTerrainPreview,
    refreshState, refreshAreas,
  ]);

  const stopSimulation = useCallback(() => {
    if (simRef.current) {
      clearInterval(simRef.current);
      simRef.current = null;
    }
    // Zdejmij ewentualny tryb przewijania i przywróć tempo sprzed niego.
    burstTargetRef.current = null;
    if (scaleBeforeBurstRef.current !== null) {
      timeScaleRef.current = scaleBeforeBurstRef.current;
      setTimeScaleState(scaleBeforeBurstRef.current);
      scaleBeforeBurstRef.current = null;
    }
    setSimRunning(false);
  }, []);

  stopSimulationRef.current = stopSimulation;

  /** Przewiń symulację o `minutes` minut symulowanych i zatrzymaj. */
  const stepMinutes = useCallback((minutes: number) => {
    if (burstTargetRef.current !== null) return;      // już przewijamy
    burstTargetRef.current = missionClockRef.current + minutes * 60;
    // Przewijamy przy ×60, żeby 15 minut symulacji zajęło ~15 s realnych.
    scaleBeforeBurstRef.current = timeScaleRef.current;
    timeScaleRef.current = 60;
    setTimeScaleState(60);
    if (!simRef.current) startSimulation();
  }, [startSimulation]);

  return {
    simRunning,
    simRef,
    simSpeedKmh,
    simSpeedRef,
    timeScale,
    setTimeScale,
    missionClockSec,
    resetMissionClock,
    stepMinutes,
    isStepping: burstTargetRef.current !== null,
    unitTerrainModifiersRef,
    unitTerrainClassRef,
    unitTerrainProfileRef,
    refreshTerrainProfile,
    activeEngagementUnitIds,
    activeEngagementsState,
    setSimSpeedKmh,
    startSimulation,
    stopSimulation,
    checkTerrainForUnit,
    checkTerrainForUnitArea,
  };
}
