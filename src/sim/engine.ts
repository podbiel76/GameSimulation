/**
 * engine.ts — jeden krok symulacji bez Reacta, API i DOM.
 *
 * Wejście: stan (jednostki, AO, trasy, hierarchia, aktywne starcia) i kontekst
 * (tempo, generator losowy, teren). Wyjście: nowy stan i zdarzenia. Zapisy do
 * backendu, logi i powiadomienia UI wykonuje wywołujący (useLocalSimulation).
 *
 * Dzięki temu ten sam krok liczy gra w przeglądarce, przebiegi referencyjne
 * (tests/sim) i — w fazie 4 — silnik serwerowy porównywany z tymi przebiegami.
 *
 * Abstrakcyjny model symulacyjny — nie realne doradztwo taktyczne.
 */

import { toLonLat } from "ol/proj";
import type { ScenarioMarker, Unit, UnitLogistics } from "../types/map";
import type { UnitArea } from "../api/unitAreasApi";
import type { HierarchyLink } from "../types/simulation";
import { moveAreaCoordsByWebMercatorDelta, polygonsOverlap, computeBbox, bboxesOverlap } from "../utils/geoUtils";
import type { Bbox } from "../utils/geoUtils";
import { SIM_DEBUG, simLog } from "../utils/debug";
import { computeUnitPotential, type CombatRole, type TerrainInput } from "../utils/combatPotential";
import {
  buildAttackerProfile,
  computeAttritionComponents,
  applyAttritionComponents,
  computeMovementFuelBurn,
  classifyUnitType,
  isUnitDestroyed,
} from "../utils/attritionRules";
import type { Rng } from "../utils/rng";

// ─── Stałe modelu (strażnik: rl/parity/test_ts_json_parity.py) ───────────────

export const TERRAIN_SPEED_MODIFIERS: Record<string, number> = {
  open: 1.0,
  road: 1.3,
  urban: 0.7,
  forest: 0.5,
  wetland: 0.4,
  water: 0.1,
};

/** Długość kroku symulacji [ms] — shared/combat_constants.json → simulation.tick_ms. */
export const TICK_MS = 100;
const ENGAGEMENT_CHECK_TICKS = 10;           // co ile kroków sprawdzać nakładanie AO (1 s przy ×1)
export const ATTRITION_COEFFICIENT = 0.02;  // ułamek potencjału przeciwnika → straty na sprawdzenie
// Strona przegrywa, gdy jej łączny potencjał (skala wyświetlana ×100) spadnie poniżej 1.0,
// czyli suma effectivePotential < 0.01 — strona praktycznie nie ma już zdolności bojowej.
export const SIDE_DEFEAT_POTENTIAL_DISPLAY = 1.0;

// ─── Typy ─────────────────────────────────────────────────────────────────────

export type EngagementInfo = {
  key: string;                  // "fId1,fId2|vs|hId1,hId2"
  friendlyUnitIds: string[];
  hostileUnitIds: string[];
  startTick: number;
  startedAt: number;            // znacznik czasu z kontekstu (Date.now() w grze)
  // Strona, która w chwili rozpoczęcia starcia była w ruchu (wjechała w AO przeciwnika)
  // jest atakującym, druga — obrońcą. Rola jest ustalana raz i nie zmienia się,
  // nawet gdy atakujący zatrzyma się w AO. null = brak jednoznacznej roli (spotkaniowe / oba w miejscu).
  attackerSide?: "friendly" | "hostile" | null;
};

export type SimState = {
  /** Numer kroku, który zostanie wykonany jako następny. */
  tick: number;
  missionClockSec: number;
  markers: ScenarioMarker[];
  units: Unit[];
  areas: UnitArea[];
  hierarchy: Pick<HierarchyLink, "parent_unit_id" | "child_unit_id">[];
  engagements: Map<string, EngagementInfo>;
};

/** Teren widziany przez silnik — w grze z profili backendu, w testach ze scenariusza. */
export type SimTerrain = {
  /** Mnożnik prędkości ruchu (1 = teren neutralny). */
  speedModifier: (unitId: string) => number;
  /** Teren do potencjału w danej roli (obrona — otoczenie, natarcie — AO). */
  forRole: (unitId: string, role: CombatRole) => TerrainInput;
};

export type SimContext = {
  timeScale: number;
  /** Prędkość jednostek bez base_speed_kmh [km/h]. */
  defaultSpeedKmh: number;
  rng: Rng;
  /** Znacznik czasu dla EngagementInfo.startedAt — w testach stały. */
  nowMs: number;
  terrain: SimTerrain;
};

export type DefeatKind = "destroyed" | "side_defeated" | "surrendered";

export type SimEvent =
  | {
      type: "engagement_start";
      key: string;
      friendlyUnitIds: string[];
      hostileUnitIds: string[];
      friendlyNames: string[];
      hostileNames: string[];
      attackerSide: "friendly" | "hostile" | null;
    }
  | { type: "engagement_end"; key: string; friendlyUnitIds: string[]; hostileUnitIds: string[]; ticks: number }
  | { type: "unit_defeated"; unitId: string; name: string; side: string; kind: DefeatKind; reason: string };

export type FinishedUnit = {
  id: string;
  x: number;
  y: number;
  lon: number;
  lat: number;
  movedAreas: UnitArea[];
};

export type StepResult = {
  state: SimState;
  events: SimEvent[];
  /** Czy w tym kroku sprawdzano starcia (wtedy `state.engagements` jest świeże). */
  engagementsChecked: boolean;
  /** Logistyka jednostek zmieniona przez atrycję — do zapisu w backendzie. */
  attritionLogistics: Map<string, UnitLogistics>;
  /** Jednostki, które dojechały do końca trasy — do zapisu pozycji i AO. */
  finishedUnits: FinishedUnit[];
  movedUnitIds: string[];
};

const DEFEAT_REASON: Record<DefeatKind, string> = {
  destroyed: "Brak ludzi zdolnych do walki — jednostka została zniszczona.",
  side_defeated: "Łączny potencjał strony spadł poniżej progu — jednostka przegrała walkę.",
  surrendered: "Brak amunicji dla piechoty — jednostka się poddała.",
};

// ─── Krok ─────────────────────────────────────────────────────────────────────

export function stepSimulation(state: SimState, ctx: SimContext): StepResult {
  const tick = state.tick;
  const hierarchy = state.hierarchy;

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

  const finishedUnits: FinishedUnit[] = [];
  const movedMarkerIds: string[] = [];

  let nextAreas = state.areas;
  let nextUnits = state.units;

  // ── Ruch po trasach ──
  const nextMarkers = state.markers.map((marker) => {
    if (marker.route.length === 0) return marker;
    // Jednostka podległa porusza się razem z przełożonym — własna trasa jest zdejmowana.
    if (parentByChild.has(marker.id)) return { ...marker, route: [] };

    movedMarkerIds.push(marker.id);

    const sortedRoute = [...marker.route].sort((a, b) => a.order - b.order);
    const target = sortedRoute[0];

    const currentUnit = nextUnits.find((u) => u.id === marker.id);
    const oldX = currentUnit?.x ?? marker.x;
    const oldY = currentUnit?.y ?? marker.y;

    const unitBaseSpeed = currentUnit?.base_speed_kmh ?? ctx.defaultSpeedKmh;
    const terrainMod = ctx.terrain.speedModifier(marker.id);
    // km/h → metry na krok: v · 1000 m/km / 3600 s/h · TICK_MS/1000 s = v · TICK_MS / 3600
    const speedMpt = unitBaseSpeed * terrainMod * TICK_MS / 3600 * ctx.timeScale;
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

    // Spalanie paliwa proporcjonalne do przebytej drogi
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

  const events: SimEvent[] = [];
  const attritionLogistics = new Map<string, UnitLogistics>();
  let engagements = state.engagements;
  let engagementsChecked = false;

  // ── Wykrywanie starć i atrycja ──
  // Odstęp skalowany mnożnikiem: przy ×60 sprawdzamy co krok, żeby na jedną
  // sekundę SYMULOWANĄ przypadała ta sama liczba sprawdzeń co przy ×1.
  const engagementInterval = Math.max(1, Math.round(ENGAGEMENT_CHECK_TICKS / ctx.timeScale));
  if (tick % engagementInterval === 0) {
    engagementsChecked = true;
    const unitMap = new Map(nextUnits.map(u => [u.id, u]));
    const respAreas = nextAreas.filter(
      a => a.area_type === "responsibility" &&
           Array.isArray(a.coordinates) &&
           (a.coordinates as unknown[]).length >= 3
    );
    // Jednostki zniszczone (bez zdolnych ludzi) wypadają ze starć.
    // Prostokąt otaczający liczony raz na obszar, nie raz na parę.
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

    // ── Krok 1: wszystkie nakładające się pary ──
    const friendlyToHostiles = new Map<string, Set<string>>();
    const hostileToFriendlies = new Map<string, Set<string>>();

    for (const fa of friendlyAreas) {
      for (const ha of hostileAreas) {
        // Najpierw prostokąty — rozłączne pomijają kosztowny test wielokątów.
        if (!bboxesOverlap(fa.bbox, ha.bbox)) continue;
        if (!polygonsOverlap(fa.coords, ha.coords, fa.bbox, ha.bbox)) continue;
        if (!friendlyToHostiles.has(fa.unitId)) friendlyToHostiles.set(fa.unitId, new Set());
        friendlyToHostiles.get(fa.unitId)!.add(ha.unitId);
        if (!hostileToFriendlies.has(ha.unitId)) hostileToFriendlies.set(ha.unitId, new Set());
        hostileToFriendlies.get(ha.unitId)!.add(fa.unitId);
      }
    }

    // ── Krok 2: spójne składowe grafu nakładania (BFS) = grupy bojowe ──
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

    // ── Krok 3: nowa mapa starć z zachowanym początkiem ──
    const newActiveEngagements = new Map<string, EngagementInfo>();

    // Jednostka z aktywną trasą jest w ruchu — to ona „wjeżdża" w AO przeciwnika.
    const hasRoute = (id: string) =>
      (finalMarkers.find(m => m.id === id)?.route.length ?? 0) > 0;

    for (const group of battleGroups) {
      const sortedFIds = [...group.friendlyIds].sort();
      const sortedHIds = [...group.hostileIds].sort();
      const key = `${sortedFIds.join(",")}|vs|${sortedHIds.join(",")}`;

      let startedAt = ctx.nowMs;
      let startTick = tick;
      let isNew = true;
      let attackerSide: "friendly" | "hostile" | null = null;

      const exact = state.engagements.get(key);
      if (exact) {
        startedAt = exact.startedAt;
        startTick  = exact.startTick;
        attackerSide = exact.attackerSide ?? null;
        isNew = false;
      } else {
        // Grupa zmieniła skład — dziedziczy początek najwcześniejszego nakładającego się starcia.
        for (const oldEng of state.engagements.values()) {
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

      // Rola ustalana raz, na początku starcia: strona poruszająca się = atakujący,
      // stojąca = obrońca. Jeśli ruszają się obie lub żadna — brak jednoznacznej roli.
      if (isNew) {
        const friendlyMoving = sortedFIds.some(hasRoute);
        const hostileMoving  = sortedHIds.some(hasRoute);
        attackerSide =
          friendlyMoving && !hostileMoving ? "friendly" :
          hostileMoving && !friendlyMoving ? "hostile" :
          null;
        events.push({
          type: "engagement_start",
          key,
          friendlyUnitIds: sortedFIds,
          hostileUnitIds: sortedHIds,
          friendlyNames: sortedFIds.map(id => unitMap.get(id)?.custom_name ?? id),
          hostileNames: sortedHIds.map(id => unitMap.get(id)?.custom_name ?? id),
          attackerSide,
        });
      }

      newActiveEngagements.set(key, { key, friendlyUnitIds: sortedFIds, hostileUnitIds: sortedHIds, startTick, startedAt, attackerSide });

      // ── Krok 4: atrycja z łącznych potencjałów i typowanych reguł ──
      const roleForSide = (side: "friendly" | "hostile"): CombatRole =>
        attackerSide === null ? "neutral" :
        attackerSide === side ? "attacker" : "defender";

      const potentialOf = (id: string, role: CombatRole) => {
        const u = unitMap.get(id);
        if (!u) return null;
        const b = computeUnitPotential(u as any, ctx.terrain.forRole(id, role), undefined, role).breakdown;
        logPotential(u, role, b);
        return b;
      };

      const friendlyBreakdowns = sortedFIds.map(id => potentialOf(id, roleForSide("friendly")))
        .filter(Boolean) as ReturnType<typeof computeUnitPotential>["breakdown"][];
      const hostileBreakdowns = sortedHIds.map(id => potentialOf(id, roleForSide("hostile")))
        .filter(Boolean) as ReturnType<typeof computeUnitPotential>["breakdown"][];

      const friendlyTotalPot = friendlyBreakdowns.reduce((s, b) => s + b.effectivePotential, 0);
      const hostileTotalPot  = hostileBreakdowns.reduce((s, b) => s + b.effectivePotential, 0);

      // Porażka strony: łączny potencjał (×100) poniżej progu → cała strona przegrywa starcie.
      const friendlySideDefeated = friendlyTotalPot * 100 < SIDE_DEFEAT_POTENTIAL_DISPLAY;
      const hostileSideDefeated  = hostileTotalPot  * 100 < SIDE_DEFEAT_POTENTIAL_DISPLAY;

      // ammo_at na jednostkę — do wykrycia skutecznej obrony przeciwpancernej
      const ammoAtMap = new Map<string, number>();
      for (const id of [...sortedFIds, ...sortedHIds]) {
        const u = unitMap.get(id);
        ammoAtMap.set(id, u?.logistics?.ammo_at ?? 0);
      }

      const hostileProfile  = buildAttackerProfile(hostileBreakdowns,  ammoAtMap, sortedHIds, unitMap as Map<string, any>);
      const friendlyProfile = buildAttackerProfile(friendlyBreakdowns, ammoAtMap, sortedFIds, unitMap as Map<string, any>);

      // Jednostka wypada z walki z jednego z trzech powodów:
      //  1. brak zdolnego personelu (wszyscy ranni/martwi) — zniszczona,
      //  2. łączny potencjał jej strony spadł poniżej progu — strona przegrała,
      //  3. brak amunicji dla piechoty — jednostka się poddaje.
      const markDefeatedIfNeeded = (unit: Unit, sideDefeated: boolean): Unit => {
        const lg = unit.logistics;
        if (!lg) return unit;
        if (unit.readiness_status === "destroyed") return unit;
        const kind: DefeatKind | null =
          (lg.personnel_available ?? 0) <= 0 ? "destroyed" :
          sideDefeated ? "side_defeated" :
          (lg.ammo_small_arms ?? 0) <= 0 ? "surrendered" :
          null;
        if (!kind) return unit;
        const name = unit.custom_name ?? unit.symbol_name ?? unit.id;
        events.push({ type: "unit_defeated", unitId: unit.id, name, side: unit.side, kind, reason: DEFEAT_REASON[kind] });
        return { ...unit, readiness_status: "destroyed" };
      };

      const applyLosses = (ids: string[], opponentTotalPot: number, opponentProfile: typeof hostileProfile, sideDefeated: boolean, label: string) => {
        for (const id of ids) {
          const u = unitMap.get(id);
          if (!u) continue;
          const baseLoss = opponentTotalPot * ATTRITION_COEFFICIENT;
          const components = computeAttritionComponents(u as any, baseLoss, opponentProfile, ctx.rng);
          logCombat(u, label, components);
          const after = markDefeatedIfNeeded(applyAttritionComponents(u as any, components) as Unit, sideDefeated);
          nextUnits = nextUnits.map(x => x.id === id ? after : x);
          unitMap.set(id, after);
          if (after.logistics) attritionLogistics.set(id, after.logistics);
        }
      };

      applyLosses(sortedFIds, hostileTotalPot, hostileProfile, friendlySideDefeated, "obrońca/friendly");
      applyLosses(sortedHIds, friendlyTotalPot, friendlyProfile, hostileSideDefeated, "obrońca/hostile");
    }

    // Zakończone starcia
    for (const [key, eng] of state.engagements) {
      if (!newActiveEngagements.has(key)) {
        events.push({
          type: "engagement_end",
          key,
          friendlyUnitIds: eng.friendlyUnitIds,
          hostileUnitIds: eng.hostileUnitIds,
          ticks: tick - eng.startTick,
        });
      }
    }
    engagements = newActiveEngagements;
  }

  return {
    state: {
      tick: tick + 1,
      // Zegar misji: 1 krok = TICK_MS czasu symulowanego × mnożnik tempa.
      missionClockSec: state.missionClockSec + (TICK_MS / 1000) * ctx.timeScale,
      markers: finalMarkers,
      units: nextUnits,
      areas: nextAreas,
      hierarchy,
      engagements,
    },
    events,
    engagementsChecked,
    attritionLogistics,
    finishedUnits,
    movedUnitIds: movedMarkerIds,
  };
}

// ─── Diagnostyka (tylko gdy SIM_DEBUG) ────────────────────────────────────────

function logPotential(u: Unit, role: string, b: ReturnType<typeof computeUnitPotential>["breakdown"]) {
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
}

function logCombat(u: Unit, role: string, c: ReturnType<typeof computeAttritionComponents>) {
  if (!SIM_DEBUG) return;
  const lg = u.logistics ?? ({} as any);
  // eslint-disable-next-line no-console
  console.log(role, {
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
  });
}
