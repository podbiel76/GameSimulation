/**
 * generate_golden.ts — zrzuca "golden" wyniki referencyjne z PRAWDZIWEGO modelu TS
 * (src/utils/combatPotential.ts), żeby port Pythona mógł je odtworzyć 1:1.
 *
 * Uruchom z katalogu repo:
 *     npx tsx rl/parity/generate_golden.ts
 *
 * Wynik: rl/parity/golden_potential.json  (wejście + oczekiwany breakdown)
 *
 * Uwaga: tu testujemy DETERMINISTYCZNĄ część modelu (computeUnitPotential).
 * Atrycja (computeAttritionComponents) używa losowego stochRound — parity dla niej
 * wymaga wstrzykiwanego, seedowalnego RNG i jest realizowana w kroku M3.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  computeUnitPotential,
  type UnitLike,
  type TerrainClass,
  type CombatRole,
} from "../../src/utils/combatPotential";

const __dirname = dirname(fileURLToPath(import.meta.url));

type GoldenCase = {
  name: string;
  unit: UnitLike;
  terrain: TerrainClass;
  role: CombatRole;
};

// Reprezentatywne przypadki: różne klasy, szczeble, teren, role, stany logistyki.
const CASES: GoldenCase[] = [
  {
    name: "infantry_company_full_open_neutral",
    terrain: "open", role: "neutral",
    unit: {
      id: "u1", symbol_name: "Infantry Company", unit_type: "infantry",
      echelon: "company_battery_troop", base_speed_kmh: 10, readiness_status: "ready",
      logistics: {
        personnel_total: 120, personnel_available: 120,
        ammo_small_arms: 4000, ammo_at: 20, ammo_mortar: 250,
        fuel_liters: 2000, combat_effectiveness_percent: 100,
      },
    },
  },
  {
    name: "infantry_company_depleted_forest_defender",
    terrain: "forest", role: "defender",
    unit: {
      id: "u2", symbol_name: "Infantry Company", unit_type: "infantry",
      echelon: "company_battery_troop", base_speed_kmh: 10, readiness_status: "limited",
      logistics: {
        personnel_total: 120, personnel_available: 50,
        ammo_small_arms: 800, ammo_at: 5, ammo_mortar: 40,
        fuel_liters: 500, combat_effectiveness_percent: 60,
      },
    },
  },
  {
    name: "armor_battalion_full_road_attacker",
    terrain: "road", role: "attacker",
    unit: {
      id: "u3", symbol_name: "Armored Battalion", unit_type: "armor",
      echelon: "battalion_squadron", base_speed_kmh: 40, readiness_status: "ready",
      logistics: {
        personnel_total: 400, personnel_available: 380,
        tanks_total: 40, tanks_operational: 38, ifv_total: 20, ifv_operational: 18,
        ammo_small_arms: 9000, ammo_main: 90, ammo_secondary: 450, ammo_at: 40,
        fuel_liters: 480, fuel_capacity_liters: 500, combat_effectiveness_percent: 100,
      },
    },
  },
  {
    name: "armor_battalion_no_fuel_open_neutral",
    terrain: "open", role: "neutral",
    unit: {
      id: "u4", symbol_name: "Armored Battalion", unit_type: "armor",
      echelon: "battalion_squadron", base_speed_kmh: 40, readiness_status: "ready",
      logistics: {
        personnel_total: 400, personnel_available: 380,
        tanks_total: 40, tanks_operational: 38, ifv_total: 20, ifv_operational: 18,
        ammo_small_arms: 9000, ammo_main: 90, ammo_secondary: 450, ammo_at: 40,
        fuel_liters: 0, fuel_capacity_liters: 500, combat_effectiveness_percent: 100,
      },
    },
  },
  {
    name: "artillery_battery_urban_defender",
    terrain: "urban", role: "defender",
    unit: {
      id: "u5", symbol_name: "Artillery Battery", unit_type: "artillery",
      echelon: "company_battery_troop", base_speed_kmh: 10, readiness_status: "ready",
      logistics: {
        personnel_total: 90, personnel_available: 85,
        mortars_total: 6, mortars_operational: 6, ammo_mortar: 250,
        ammo_small_arms: 1000, fuel_liters: 1500, combat_effectiveness_percent: 95,
      },
    },
  },
  {
    name: "infantry_squad_minimal_water_attacker",
    terrain: "water", role: "attacker",
    unit: {
      id: "u6", symbol_name: "Infantry Squad", unit_type: "infantry",
      echelon: "squad", base_speed_kmh: 8, readiness_status: "incomplete",
      logistics: {
        personnel_total: 9, personnel_available: 4,
        ammo_small_arms: 120, ammo_at: 2, fuel_liters: 100,
        combat_effectiveness_percent: 40,
      },
    },
  },
];

const out = CASES.map(c => ({
  name: c.name,
  input: { unit: c.unit, terrain: c.terrain, role: c.role },
  expected: computeUnitPotential(c.unit, c.terrain, undefined, c.role).breakdown,
}));

const target = resolve(__dirname, "golden_potential.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n", "utf-8");
console.log(`Zapisano ${out.length} golden cases -> ${target}`);
