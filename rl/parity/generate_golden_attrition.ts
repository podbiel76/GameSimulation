/**
 * generate_golden_attrition.ts — zrzuca deterministyczne "raw" straty z modelu TS
 * (computeAttritionRaw) dla zestawu (jednostka, baseLoss, profil atakującego),
 * by port Pythona (compute_attrition_raw) odtworzył je 1:1 (bez RNG).
 *
 *     npx tsx rl/parity/generate_golden_attrition.ts   ->  rl/parity/golden_attrition.json
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { computeAttritionRaw, type AttackerProfile } from "../../src/utils/attritionRules";
import type { UnitLike } from "../../src/utils/combatPotential";

const __dirname = dirname(fileURLToPath(import.meta.url));

const profileArmor: AttackerProfile = {
  armorShare: 0.5, artilleryShare: 0.2, antiTankShare: 0.1,
  hasEffectiveAT: true, hasArmoredVehicles: true,
};
const profileInfantry: AttackerProfile = {
  armorShare: 0.0, artilleryShare: 0.1, antiTankShare: 0.05,
  hasEffectiveAT: false, hasArmoredVehicles: false,
};
const profileAT: AttackerProfile = {
  armorShare: 0.1, artilleryShare: 0.1, antiTankShare: 0.4,
  hasEffectiveAT: true, hasArmoredVehicles: false,
};

const units: Record<string, UnitLike> = {
  infantry: {
    id: "d1", symbol_name: "Infantry Company", unit_type: "infantry",
    echelon: "company_battery_troop", logistics: {
      personnel_total: 120, personnel_available: 120,
      ammo_small_arms: 4000, ammo_at: 20, ammo_mortar: 250,
      mortars_total: 4, mortars_operational: 4, drones_total: 6, drones_available: 6,
      fuel_liters: 2000,
    },
  },
  armor: {
    id: "d2", symbol_name: "Armored Battalion", unit_type: "armor",
    echelon: "battalion_squadron", logistics: {
      personnel_total: 400, personnel_available: 380,
      tanks_total: 40, tanks_operational: 38, ifv_total: 20, ifv_operational: 18,
      ammo_main: 90, ammo_secondary: 450, ammo_at: 40, ammo_small_arms: 9000,
      fuel_liters: 480,
    },
  },
  artillery: {
    id: "d3", symbol_name: "Artillery Battery", unit_type: "artillery",
    echelon: "company_battery_troop", logistics: {
      personnel_total: 90, personnel_available: 85,
      armored_artillery_total: 6, armored_artillery_operational: 6,
      mortars_total: 6, mortars_operational: 6, ammo_mortar: 250, ammo_small_arms: 1000,
      fuel_liters: 1500,
    },
  },
  anti_tank: {
    id: "d4", symbol_name: "Antitank Company", unit_type: "infantry",
    echelon: "company_battery_troop", logistics: {
      personnel_total: 60, personnel_available: 55, ammo_at: 200, ammo_small_arms: 2000,
      fuel_liters: 800,
    },
  },
};

const baseLosses = [0.05, 0.2, 0.5];
const profiles = { armor: profileArmor, infantry: profileInfantry, at: profileAT };

const cases: any[] = [];
for (const [uName, unit] of Object.entries(units)) {
  for (const bl of baseLosses) {
    for (const [pName, prof] of Object.entries(profiles)) {
      cases.push({
        name: `${uName}__bl${bl}__${pName}`,
        input: { unit, baseLoss: bl, profile: prof },
        expected: computeAttritionRaw(unit, bl, prof),
      });
    }
  }
}

const target = resolve(__dirname, "golden_attrition.json");
writeFileSync(target, JSON.stringify(cases, null, 2) + "\n", "utf-8");
console.log(`Zapisano ${cases.length} golden attrition cases -> ${target}`);
