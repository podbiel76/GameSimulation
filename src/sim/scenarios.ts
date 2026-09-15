/**
 * scenarios.ts — scenariusze przebiegów referencyjnych (faza 3).
 *
 * Każdy scenariusz pokrywa jedną mechanikę silnika (src/sim/engine.ts).
 * Scenariusz jest w pełni opisany tutaj: jednostki z logistyką, AO, trasy,
 * hierarchia i teren — bez backendu i bez mapy, więc przebieg jest odtwarzalny.
 *
 * Współrzędne podawane w kilometrach od punktu bazowego (wschód, północ).
 */

import { fromLonLat } from "ol/proj";
import type { ScenarioMarker, Unit, UnitLogistics } from "../types/map";
import type { UnitArea } from "../api/unitAreasApi";
import type { TerrainInput } from "../utils/combatPotential";
import type { SimState } from "./engine";

const BASE_LON = 20.0;
const BASE_LAT = 52.0;
const EPOCH = "2026-01-01T00:00:00Z";

type Km = [east: number, north: number];

export type UnitSpec = {
  id: string;
  side: "friendly" | "hostile";
  at: Km;
  /** Połowa boku kwadratowego AO [km]; brak = jednostka bez AO. */
  aoHalfKm?: number;
  type?: "infantry" | "armor";
  speedKmh?: number;
  readiness?: string;
  logistics?: Partial<UnitLogistics>;
};

export type ScenarioTerrain = {
  /** Otoczenie jednostki — teren obrony. */
  local?: TerrainInput;
  /** Teren AO — natarcie, manewr, rola neutralna. */
  ao?: TerrainInput;
  /** Mnożnik prędkości ruchu. */
  speed?: number;
};

export type Scenario = {
  name: string;
  description: string;
  ticks: number;
  snapshotEvery: number;
  timeScale: number;
  units: UnitSpec[];
  routes?: Record<string, Km[]>;
  /** Pary [przełożony, podległy]. */
  hierarchy?: [string, string][];
  terrain?: Record<string, ScenarioTerrain>;
};

// ─── Budowanie stanu ──────────────────────────────────────────────────────────

const lonLatAt = ([east, north]: Km): [number, number] => {
  const cos = Math.cos((BASE_LAT * Math.PI) / 180);
  return [BASE_LON + east / (111.32 * cos), BASE_LAT + north / 110.574];
};

const xyAt = (km: Km) => fromLonLat(lonLatAt(km)) as [number, number];

function squareRing(center: Km, halfKm: number): [number, number][] {
  const [e, n] = center;
  const ring = [
    lonLatAt([e - halfKm, n - halfKm]),
    lonLatAt([e + halfKm, n - halfKm]),
    lonLatAt([e + halfKm, n + halfKm]),
    lonLatAt([e - halfKm, n + halfKm]),
  ];
  return [...ring, ring[0]];
}

function makeLogistics(spec: UnitSpec): UnitLogistics {
  const armor = spec.type === "armor";
  return {
    id: `log-${spec.id}`,
    unit_id: spec.id,
    personnel_total: armor ? 400 : 600,
    personnel_available: armor ? 400 : 600,
    personnel_wounded: 0,
    personnel_dead: 0,
    ammo_small_arms: armor ? 9000 : 10000,
    ammo_at: armor ? 40 : 50,
    ammo_mortar: armor ? 0 : 700,
    ammo_main: armor ? 100 : null,
    ammo_secondary: armor ? 500 : null,
    drones_total: 4,
    drones_available: 4,
    tanks_total: armor ? 40 : 0,
    tanks_operational: armor ? 40 : 0,
    ifv_total: armor ? 20 : 40,
    ifv_operational: armor ? 20 : 40,
    armored_artillery_total: 0,
    armored_artillery_operational: 0,
    mortars_total: armor ? 0 : 18,
    mortars_operational: armor ? 0 : 18,
    fuel_liters: 500,
    fuel_capacity_liters: 500,
    supply_priority: "normal",
    evacuation_required: false,
    combat_effectiveness_percent: 100,
    notes: null,
    updated_at: EPOCH,
    ...spec.logistics,
  };
}

function makeUnit(spec: UnitSpec): Unit {
  const armor = spec.type === "armor";
  const [lon, lat] = lonLatAt(spec.at);
  const [x, y] = xyAt(spec.at);
  return {
    id: spec.id,
    symbol_id: `${spec.side === "hostile" ? "EN_" : ""}Land_unit__${armor ? "Armored" : "Infantry"}__Battalion_Squadron`,
    symbol_name: armor ? "Armored Battalion" : "Infantry Battalion",
    side: spec.side,
    unit_type: armor ? "armor" : "infantry",
    position_lon: lon,
    position_lat: lat,
    x,
    y,
    bbox: null,
    confidence: null,
    source: "reference",
    created_at: EPOCH,
    updated_at: EPOCH,
    echelon: "Battalion_Squadron",
    unit_number: null,
    custom_name: spec.id,
    logistics: makeLogistics(spec),
    current_elevation_m: null,
    readiness_status: spec.readiness ?? "ready",
    requires_logistics_completion: false,
    base_speed_kmh: spec.speedKmh ?? (armor ? 50 : 30),
  };
}

export function buildInitialState(sc: Scenario): SimState {
  const units = sc.units.map(makeUnit);
  const areas: UnitArea[] = sc.units
    .filter(s => s.aoHalfKm)
    .map(s => ({
      id: `ao-${s.id}`,
      unit_id: s.id,
      name: `AO ${s.id}`,
      area_type: "responsibility",
      area_km2: (2 * s.aoHalfKm!) ** 2,
      bearing_deg: 0,
      coordinates: squareRing(s.at, s.aoHalfKm!),
      bbox: null,
      unit_side: s.side,
    }));
  const markers: ScenarioMarker[] = units.map(u => ({
    id: u.id,
    symbolId: u.symbol_id,
    echelon: u.echelon,
    x: u.x,
    y: u.y,
    side: u.side,
    route: (sc.routes?.[u.id] ?? []).map((km, i) => {
      const [x, y] = xyAt(km);
      return { id: `${u.id}-wp${i}`, x, y, order: i };
    }),
  }));
  return {
    tick: 0,
    missionClockSec: 0,
    markers,
    units,
    areas,
    hierarchy: (sc.hierarchy ?? []).map(([parent, child]) => ({ parent_unit_id: parent, child_unit_id: child })),
    engagements: new Map(),
  };
}

// ─── Scenariusze ──────────────────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [
  {
    name: "ruch",
    description: "Sam ruch po trasie z trzema punktami zwrotu, spalanie paliwa, mnożnik terenu 0.8.",
    ticks: 260,
    snapshotEvery: 20,
    timeScale: 60,
    units: [{ id: "F1", side: "friendly", at: [0, 0], aoHalfKm: 1 }],
    routes: { F1: [[2, 0], [2, 2], [0, 2]] },
    terrain: { F1: { speed: 0.8 } },
  },
  {
    name: "ruch_z_hierarchia",
    description: "Przełożony jedzie, podległy przesuwa się razem z nim wraz z AO; własna trasa podległego jest zdejmowana.",
    ticks: 150,
    snapshotEvery: 15,
    timeScale: 60,
    units: [
      { id: "P", side: "friendly", at: [0, 0], aoHalfKm: 2 },
      { id: "C", side: "friendly", at: [0.5, 0.5], aoHalfKm: 0.5 },
    ],
    routes: { P: [[3, 0]], C: [[3, 3]] },
    hierarchy: [["P", "C"]],
  },
  {
    name: "natarcie_1v1",
    description: "Sojusznik wjeżdża trasą w AO przeciwnika — atakujący friendly, obrońca w lesie.",
    ticks: 300,
    snapshotEvery: 20,
    timeScale: 60,
    units: [
      { id: "F1", side: "friendly", at: [0, 0], aoHalfKm: 1 },
      { id: "H1", side: "hostile", at: [3, 0], aoHalfKm: 1 },
    ],
    routes: { F1: [[3, 0]] },
    terrain: {
      F1: { ao: { open: 0.7, forest: 0.3 } },
      H1: { local: { forest: 0.8, open: 0.2 } },
    },
  },
  {
    name: "starcie_grupowe",
    description: "Łańcuch nakładających się AO F1–H1–F2–H2 tworzy jedną grupę bojową 2 na 2 (BFS).",
    ticks: 200,
    snapshotEvery: 20,
    timeScale: 60,
    units: [
      { id: "F1", side: "friendly", at: [0, 0], aoHalfKm: 1 },
      { id: "H1", side: "hostile", at: [1.6, 0], aoHalfKm: 1 },
      { id: "F2", side: "friendly", at: [3.2, 0], aoHalfKm: 1 },
      { id: "H2", side: "hostile", at: [4.8, 0], aoHalfKm: 1 },
    ],
  },
  {
    name: "zniszczenie_brak_ludzi",
    // Straty liczone są od etatu jednostki, a potencjał maleje razem ze stanem osobowym —
    // pojedyncza wykrwawiona jednostka przegrywa przez próg potencjału strony, zanim straci
    // ostatniego żołnierza. Dlatego F2 w pełnej sile trzyma potencjał strony, a F1 (etat 600,
    // zdolnych 60) traci ludzi szybciej, niż strona przegrywa.
    description: "Wykrwawiony batalion (60 zdolnych z 600) traci ostatnich ludzi; strona walczy dalej dzięki drugiej jednostce.",
    ticks: 150,
    snapshotEvery: 10,
    timeScale: 60,
    units: [
      {
        id: "F1", side: "friendly", at: [0, 0], aoHalfKm: 1,
        logistics: { personnel_available: 60, personnel_wounded: 540 },
      },
      { id: "F2", side: "friendly", at: [0.6, 0], aoHalfKm: 1 },
      { id: "H1", side: "hostile", at: [1.8, 0], aoHalfKm: 1 },
    ],
  },
  {
    name: "poddanie_brak_amunicji",
    description: "Piechota z resztką amunicji strzeleckiej wystrzeliwuje ją w starciu i się poddaje.",
    ticks: 200,
    snapshotEvery: 10,
    timeScale: 60,
    units: [
      { id: "F1", side: "friendly", at: [0, 0], aoHalfKm: 1, logistics: { ammo_small_arms: 400 } },
      { id: "H1", side: "hostile", at: [1.5, 0], aoHalfKm: 1 },
    ],
  },
  {
    name: "porazka_strony_prog",
    description: "Strona z potencjałem poniżej progu przegrywa starcie przy pierwszym sprawdzeniu.",
    ticks: 40,
    snapshotEvery: 5,
    timeScale: 60,
    units: [
      {
        id: "F1", side: "friendly", at: [0, 0], aoHalfKm: 1, readiness: "incomplete",
        logistics: {
          personnel_available: 150, personnel_wounded: 300, personnel_dead: 150,
          ammo_small_arms: 300, ammo_at: 0, ammo_mortar: 0, ifv_operational: 2,
          mortars_operational: 0, drones_available: 0, combat_effectiveness_percent: 10,
        },
      },
      { id: "H1", side: "hostile", at: [1.5, 0], aoHalfKm: 1 },
    ],
  },
  {
    name: "wyczerpanie_paliwa",
    description: "Batalion pancerny z małym zapasem paliwa na długiej trasie — paliwo spada do zera.",
    ticks: 400,
    snapshotEvery: 25,
    timeScale: 60,
    units: [
      { id: "A1", side: "friendly", at: [0, 0], aoHalfKm: 1, type: "armor", logistics: { fuel_liters: 30 } },
    ],
    routes: { A1: [[15, 0]] },
  },
];
