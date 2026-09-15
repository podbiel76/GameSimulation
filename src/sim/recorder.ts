/**
 * recorder.ts — przebieg scenariusza przez silnik i zrzut stanu co K kroków.
 *
 * Wynik trafia do tests/sim/reference/<scenariusz>.json i jest porównywany
 * przy każdym uruchomieniu testów. Liczby zaokrąglane do 6 miejsc, żeby drobne
 * różnice zmiennoprzecinkowe między platformami nie dawały fałszywych alarmów.
 */

import { createRng } from "../utils/rng";
import { stepSimulation, type SimEvent, type SimState, type SimTerrain } from "./engine";
import { buildInitialState, type Scenario } from "./scenarios";

export const REFERENCE_SEED = 20260914;
const REFERENCE_NOW_MS = 0;

const round = (v: number | null | undefined, digits = 6): number | null =>
  v == null ? null : Number(v.toFixed(digits));

export type ReferenceFrame = ReturnType<typeof frameOf>;
export type ReferenceEvent =
  | { tick: number; type: "engagement_start"; key: string; attackerSide: "friendly" | "hostile" | null }
  | { tick: number; type: "engagement_end"; key: string; ticks: number }
  | { tick: number; type: "unit_defeated"; unitId: string; kind: string };

export type ReferenceRun = {
  scenario: string;
  description: string;
  seed: number;
  timeScale: number;
  ticks: number;
  snapshotEvery: number;
  frames: ReferenceFrame[];
  events: ReferenceEvent[];
};

/** Teren scenariusza w interfejsie silnika — ta sama semantyka ról co w grze. */
export function scenarioTerrain(sc: Scenario): SimTerrain {
  return {
    speedModifier: id => sc.terrain?.[id]?.speed ?? 1,
    forRole: (id, role) => {
      const t = sc.terrain?.[id];
      if (!t) return "open";
      return role === "defender" ? (t.local ?? t.ao ?? "open") : (t.ao ?? t.local ?? "open");
    },
  };
}

function frameOf(state: SimState) {
  return {
    tick: state.tick,
    clockSec: round(state.missionClockSec, 3),
    units: [...state.units]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(u => {
        const lg = u.logistics;
        return {
          id: u.id,
          x: round(u.x, 3),
          y: round(u.y, 3),
          readiness: u.readiness_status,
          personnel: lg ? [lg.personnel_available, lg.personnel_wounded, lg.personnel_dead] : null,
          ammo: lg ? { sa: lg.ammo_small_arms, at: lg.ammo_at, mortar: lg.ammo_mortar, main: lg.ammo_main } : null,
          vehicles: lg ? { tanks: lg.tanks_operational, ifv: lg.ifv_operational, mortars: lg.mortars_operational, drones: lg.drones_available } : null,
          fuel: round(lg?.fuel_liters, 4),
          ce: round(lg?.combat_effectiveness_percent, 4),
        };
      }),
    routesLeft: Object.fromEntries(
      [...state.markers].sort((a, b) => a.id.localeCompare(b.id)).map(m => [m.id, m.route.length]),
    ),
    aoFirstVertex: Object.fromEntries(
      [...state.areas]
        .sort((a, b) => a.unit_id.localeCompare(b.unit_id))
        .map(a => [a.unit_id, (a.coordinates?.[0] ?? []).map(v => round(v, 7))]),
    ),
    engagements: [...state.engagements.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(e => ({ key: e.key, startTick: e.startTick, attackerSide: e.attackerSide ?? null })),
  };
}

function compactEvent(tick: number, ev: SimEvent): ReferenceEvent {
  switch (ev.type) {
    case "engagement_start": return { tick, type: ev.type, key: ev.key, attackerSide: ev.attackerSide };
    case "engagement_end": return { tick, type: ev.type, key: ev.key, ticks: ev.ticks };
    case "unit_defeated": return { tick, type: ev.type, unitId: ev.unitId, kind: ev.kind };
  }
}

export function runScenario(sc: Scenario): ReferenceRun {
  let state = buildInitialState(sc);
  const ctx = {
    timeScale: sc.timeScale,
    defaultSpeedKmh: 30,
    rng: createRng(REFERENCE_SEED),
    nowMs: REFERENCE_NOW_MS,
    terrain: scenarioTerrain(sc),
  };

  const frames: ReferenceFrame[] = [frameOf(state)];
  const events: ReferenceEvent[] = [];
  for (let i = 0; i < sc.ticks; i++) {
    const stepTick = state.tick;
    const result = stepSimulation(state, ctx);
    for (const ev of result.events) events.push(compactEvent(stepTick, ev));
    state = result.state;
    if (state.tick % sc.snapshotEvery === 0) frames.push(frameOf(state));
  }
  if (frames[frames.length - 1].tick !== state.tick) frames.push(frameOf(state));

  return {
    scenario: sc.name,
    description: sc.description,
    seed: REFERENCE_SEED,
    timeScale: sc.timeScale,
    ticks: sc.ticks,
    snapshotEvery: sc.snapshotEvery,
    frames,
    events,
  };
}

/** Serializacja przebiegu — stabilna, jeden obiekt jednostki na linię. */
export function serializeRun(run: ReferenceRun): string {
  return JSON.stringify(run, null, 1) + "\n";
}
