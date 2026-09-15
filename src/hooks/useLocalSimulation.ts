import { useState, useRef, useCallback } from "react";
import type { MutableRefObject } from "react";
import { toLonLat } from "ol/proj";
import type { ScenarioMarker, Unit, UnitLogistics, UpdateUnitLogisticsPayload } from "../types/map";
import type { FullState } from "../types/simulation";
import type { UnitArea } from "../api/unitAreasApi";
import type { MapViewHandle } from "../map/MapView";
import type { AreaTerrainBreakdown } from "../utils/terrainClassifier";
import { updateUnit, updateUnitLogistics } from "../api/unitsApi";
import { updatePolygonArea } from "../api/unitAreasApi";
import type { TerrainClass } from "../utils/combatPotential";
import { createRng } from "../utils/rng";
import { fetchTerrainProfile } from "../api/terrainApi";
import { TERRAIN_DEFENSE_RADIUS_M, aoKeyOf, terrainForRole, type UnitTerrainProfile } from "../utils/terrainProfile";
import {
  stepSimulation,
  TERRAIN_SPEED_MODIFIERS,
  TICK_MS,
  SIDE_DEFEAT_POTENTIAL_DISPLAY,
  type EngagementInfo,
  type SimEvent,
  type SimTerrain,
  type DefeatKind,
} from "../sim/engine";

// Stałe i typy silnika — ponownie eksportowane dla dotychczasowych importów w panelach.
export {
  TERRAIN_SPEED_MODIFIERS,
  TICK_MS,
  ATTRITION_COEFFICIENT,
  SIDE_DEFEAT_POTENTIAL_DISPLAY,
} from "../sim/engine";
export type { EngagementInfo } from "../sim/engine";

/**
 * useLocalSimulation — warstwa Reacta nad silnikiem `src/sim/engine.ts`.
 *
 * Silnik liczy krok (ruch, starcia, atrycja) jako czystą funkcję. Tutaj zostaje to,
 * czego silnik świadomie nie robi: refy i stan Reacta, akumulator czasu, zapisy
 * do backendu, profile terenu z API i powiadomienia UI.
 */

/** Profil terenu odświeżany dopiero po przesunięciu jednostki o tyle metrów. */
const TERRAIN_REFRESH_DISTANCE_M = 250;
const ATTRITION_PERSIST_TICKS = 50;          // co ile kroków zapisywać straty w backendzie (5 s)
/** Maks. liczba kroków nadrabianych w jednym wywołaniu (karta w tle, zacięcie przeglądarki). */
const MAX_CATCHUP_TICKS = 20;
/** Ziarno generatora losowego — ten sam scenariusz i ta sama liczba kroków dają te same straty. */
const SIM_RNG_SEED = 20260914;

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

const DEFEAT_LOG: Record<DefeatKind, [string, string]> = {
  destroyed: ["ZNISZCZONA", "brak ludzi zdolnych do walki"],
  side_defeated: ["PRZEGRANA", `łączny potencjał strony spadł poniżej ${SIDE_DEFEAT_POTENTIAL_DISPLAY}`],
  surrendered: ["PODDANIE", "brak amunicji dla piechoty"],
};

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
  // Generator losowy w stanie symulacji — odtwarzany od ziarna przy nowym przebiegu.
  const rngRef = useRef(createRng(SIM_RNG_SEED));

  // ── Skala czasu (mnożnik ×1/×8/×20/×60 z górnego paska) ────────────────────
  // Mnoży dystans pokonywany w kroku. Bezpieczne, bo krok jest mały względem AO:
  // przy 30 km/h krok to 0,83 m, więc nawet ×60 daje 50 m — a AO mają kilometry.
  // Gęstość wykrywania starć utrzymujemy stałą w czasie SYMULOWANYM, skracając
  // odstęp między sprawdzeniami proporcjonalnie do mnożnika.
  const timeScaleRef = useRef(1);
  const [timeScale, setTimeScaleState] = useState(1);
  const setTimeScale = useCallback((v: number) => {
    timeScaleRef.current = v;
    setTimeScaleState(v);
  }, []);

  // Zegar misji w sekundach symulowanych. Trzymany w refie (rośnie co krok),
  // do stanu przepisywany rzadziej — inaczej wymuszałby render 10×/s.
  const missionClockRef = useRef(0);
  const [missionClockSec, setMissionClockSec] = useState(0);
  const resetMissionClock = useCallback(() => {
    missionClockRef.current = 0;
    rngRef.current = createRng(SIM_RNG_SEED);
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
  // Klasa dominująca terenu jednostki — z profilu terenu (refreshTerrainProfile)
  const unitTerrainClassRef = useRef<Map<string, string>>(new Map());

  // Śledzenie starć
  const activeEngagementsRef = useRef<Map<string, EngagementInfo>>(new Map());
  const pendingLogisticsRef  = useRef<Map<string, UpdateUnitLogisticsPayload>>(new Map());
  const [activeEngagementUnitIds, setActiveEngagementUnitIds] = useState<Set<string>>(new Set());
  const [activeEngagementsState, setActiveEngagementsState] = useState<EngagementInfo[]>([]);

  const setSimSpeedKmh = useCallback((v: number) => {
    setSimSpeedKmhState(v);
    simSpeedRef.current = v;
  }, []);

  // Profil terenu z backendu (WorldCover + DEM): obrona — otoczenie jednostki,
  // natarcie i manewr — AO.
  const unitTerrainProfileRef = useRef<Map<string, UnitTerrainProfile>>(new Map());
  const terrainInflightRef = useRef<Set<string>>(new Set());
  const terrainWarnedRef = useRef(false);
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
      } else {
        // Poza danymi rastrowymi teren = „open" (neutralny, jak domyślnie) — bez
        // analizy kolorów mapy, która zależała od podkładu i zoomu.
        unitTerrainClassRef.current.delete(unitId);
        unitTerrainModifiersRef.current.delete(unitId);
        if (!terrainWarnedRef.current) {
          terrainWarnedRef.current = true;
          console.warn(`[TERRAIN] Brak danych terenu (${res.reason ?? "poza zasięgiem"}) — liczę teren otwarty.`);
        }
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

  // Teren wyłącznie z danych rastrowych (faza 1). Obie funkcje zostają jako punkty
  // wejścia dla UI — profil liczy jednocześnie otoczenie jednostki i jej AO.
  const checkTerrainForUnit = useCallback(async (unitId: string) => {
    await refreshTerrainProfile(unitId, { force: true });
  }, [refreshTerrainProfile]);

  const checkTerrainForUnitArea = checkTerrainForUnit;

  const startSimulation = useCallback(() => {
    if (simRef.current) return;

    setSimRunning(true);
    simTickCountRef.current = 0;
    // Nowy przebieg (zegar misji od zera) zaczyna od tego samego ziarna.
    if (missionClockRef.current === 0) rngRef.current = createRng(SIM_RNG_SEED);

    // Teren dla silnika: prędkość i teren według roli z profili backendu.
    const engineTerrain: SimTerrain = {
      speedModifier: id => unitTerrainModifiersRef.current.get(id) ?? 1.0,
      forRole: (id, role) => {
        if (!unitTerrainProfileRef.current.has(id)) void refreshTerrainProfile(id);
        return terrainForRole(unitTerrainProfileRef.current.get(id), role, toTerrainClass(unitTerrainClassRef.current.get(id)));
      },
    };

    const handleEvent = (ev: SimEvent) => {
      switch (ev.type) {
        case "engagement_start":
          // eslint-disable-next-line no-console
          console.log(
            `[ENGAGEMENT] START [${ev.friendlyNames.join(", ")}] ↔ [${ev.hostileNames.join(", ")}]` +
            ` — atakujący: ${ev.attackerSide ?? "brak (spotkaniowe)"}`
          );
          break;
        case "engagement_end":
          // eslint-disable-next-line no-console
          console.log(
            `[ENGAGEMENT] END [${ev.friendlyUnitIds.join(", ")}] ↔ [${ev.hostileUnitIds.join(", ")}]` +
            ` (${ev.ticks} ticks)`
          );
          break;
        case "unit_defeated": {
          const [label, text] = DEFEAT_LOG[ev.kind];
          // eslint-disable-next-line no-console
          console.log(`[${label}] ${ev.name} — ${text}`);
          onUnitDefeatedRef.current?.({ unitId: ev.unitId, name: ev.name, side: ev.side, reason: ev.reason });
          void updateUnit(ev.unitId, { readiness_status: "destroyed" }).catch(err =>
            console.error(`[ENGAGEMENT] Failed to persist destroyed status for ${ev.unitId}:`, err));
          break;
        }
      }
    };

    // ── Jeden krok symulacji o stałej długości TICK_MS ──
    // Synchroniczny: nadrabianie kilku kroków w jednym wywołaniu nie może
    // przeplatać się z await (zapisy do backendu idą poza krokiem).
    const runTick = () => {
      const stepTick = simTickCountRef.current;
      const result = stepSimulation(
        {
          tick: stepTick,
          missionClockSec: missionClockRef.current,
          markers: markersRef.current,
          units: unitsRef.current,
          areas: unitAreasRef.current,
          hierarchy: fullStateRef.current?.hierarchy || [],
          engagements: activeEngagementsRef.current,
        },
        {
          timeScale: timeScaleRef.current,
          defaultSpeedKmh: simSpeedRef.current,
          rng: rngRef.current,
          nowMs: Date.now(),
          terrain: engineTerrain,
        },
      );
      const { state } = result;

      result.events.forEach(handleEvent);
      for (const [unitId, logistics] of result.attritionLogistics) {
        pendingLogisticsRef.current.set(unitId, snapshotLogisticsForPatch(logistics));
      }

      if (result.engagementsChecked) {
        activeEngagementsRef.current = state.engagements;
        const engagedIds = new Set<string>();
        const engagementsArr: EngagementInfo[] = [];
        for (const eng of state.engagements.values()) {
          eng.friendlyUnitIds.forEach(id => engagedIds.add(id));
          eng.hostileUnitIds.forEach(id => engagedIds.add(id));
          engagementsArr.push(eng);
        }
        setActiveEngagementUnitIds(engagedIds);
        setActiveEngagementsState(engagementsArr);
      }

      // ── Zapis atrycji w backendzie ──
      if (stepTick % ATTRITION_PERSIST_TICKS === 0 && pendingLogisticsRef.current.size > 0) {
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

      // Stan kroku trafia do refów; do Reacta raz na wywołanie interwału (po nadrobieniu).
      markersRef.current = state.markers;
      unitsRef.current = state.units;
      unitAreasRef.current = state.areas;

      missionClockRef.current = state.missionClockSec;
      if (stepTick % 5 === 0) setMissionClockSec(missionClockRef.current);

      // Koniec przewijania („Krok 15 min") — zatrzymaj po osiągnięciu celu.
      if (burstTargetRef.current !== null && missionClockRef.current >= burstTargetRef.current) {
        setMissionClockSec(missionClockRef.current);
        stopSimulationRef.current?.();
      }

      simTickCountRef.current = state.tick;
      if (result.movedUnitIds.length > 0 && state.tick % 10 === 0) {
        const tickBatch = Math.floor(state.tick / 10);
        const unitIdToCheck = result.movedUnitIds[tickBatch % result.movedUnitIds.length];
        // Profil terenu z danych rastrowych; backend liczy go ponownie dopiero po
        // przesunięciu o TERRAIN_REFRESH_DISTANCE_M.
        if (unitIdToCheck) void refreshTerrainProfile(unitIdToCheck);
      }

      if (result.finishedUnits.length > 0) {
        const finishedUnits = result.finishedUnits;
        // Zapis poza krokiem — krok pozostaje synchroniczny.
        void (async () => {
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
        })();
      }
    };

    // ── Akumulator czasu: liczba kroków wynika z upływu czasu, nie z liczby
    // wywołań interwału (przeglądarka dławi timery w karcie w tle). ──
    let lastMs = performance.now();
    let accumulatorMs = 0;
    simRef.current = setInterval(() => {
      const nowMs = performance.now();
      accumulatorMs += nowMs - lastMs;
      lastMs = nowMs;

      let ticks = 0;
      while (accumulatorMs >= TICK_MS && ticks < MAX_CATCHUP_TICKS && simRef.current) {
        runTick();
        accumulatorMs -= TICK_MS;
        ticks++;
      }
      // Po długim uśpieniu karty nie nadrabiamy minut naraz — nadwyżka przepada.
      if (accumulatorMs >= TICK_MS) accumulatorMs = 0;

      if (ticks > 0) {
        setMarkers(markersRef.current);
        setUnits(unitsRef.current);
        setUnitAreas(unitAreasRef.current);
      }
    }, TICK_MS);
  }, [
    markersRef, unitsRef, unitAreasRef, fullStateRef,
    mapHandleRef, selectedUnitIdRef,
    setMarkers, setUnits, setUnitAreas, setTerrainPreview,
    refreshState, refreshAreas, refreshTerrainProfile,
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
