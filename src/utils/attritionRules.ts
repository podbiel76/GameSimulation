/**
 * attritionRules.ts
 *
 * Typowany model strat bojowych — różnicuje straty wg klasy jednostki i składu
 * atakującej strony. Wyłącznie abstrakcyjny model symulacyjny, nie doradztwo taktyczne.
 */

import type { UnitLike, PotentialBreakdown } from "./combatPotential";

// ─── Klasyfikacja jednostki ───────────────────────────────────────────────────

export type UnitClass = "armor" | "infantry" | "artillery" | "anti_tank";

export function classifyUnitType(unit: UnitLike): UnitClass {
  const type = (unit.unit_type ?? "").toLowerCase();
  if (type === "armor") return "armor";
  if (type === "artillery") return "artillery";
  const name = (unit.symbol_name ?? "").toLowerCase();
  if (/panc|armor|tank|czołg|kto|bwp|abrams|leopard|mechani|zmech/.test(name)) return "armor";
  if (/artyler|artillery|haubic|rakiet|moździerz/.test(name)) return "artillery";
  if (/ppanc|anti.?tank|antitank|przeciwpancern/.test(name)) return "anti_tank";
  return "infantry";
}

/**
 * A unit is combat-destroyed once it has no personnel left to fight — vehicles cannot be
 * crewed without people, so the unit stops participating in engagements. An explicit
 * "destroyed" readiness status also counts.
 */
export function isUnitDestroyed(unit: UnitLike): boolean {
  if ((unit as { readiness_status?: string }).readiness_status === "destroyed") return true;
  const log = unit.logistics;
  if (!log) return false;
  return (log.personnel_available ?? 0) <= 0;
}

// ─── Profil atakującego ───────────────────────────────────────────────────────

export type AttackerProfile = {
  armorShare: number;          // 0–1 fraction of combined static potential from armor component
  artilleryShare: number;      // 0–1
  antiTankShare: number;       // 0–1
  hasEffectiveAT: boolean;     // any unit in the attacker group has ammo_at > 5
  hasArmoredVehicles: boolean; // any unit has tanks_operational + ifv_operational > 0
};

export function buildAttackerProfile(
  breakdowns: PotentialBreakdown[],
  ammoAtByUnitId: Map<string, number>,
  unitIds: string[],
  unitMap?: Map<string, UnitLike>,
): AttackerProfile {
  const totalStatic = breakdowns.reduce((s, b) => s + b.staticPotential, 0);
  if (totalStatic <= 0) {
    return { armorShare: 0, artilleryShare: 0, antiTankShare: 0, hasEffectiveAT: false, hasArmoredVehicles: false };
  }

  const ARMOR_W = 0.30;
  const ARTILLERY_W = 0.25;
  const ANTI_AIR_W = 0.10;

  const armorContrib = breakdowns.reduce((s, b) => s + b.armor * ARMOR_W, 0);
  const artContrib   = breakdowns.reduce((s, b) => s + b.artillery * ARTILLERY_W, 0);
  const atContrib    = breakdowns.reduce((s, b) => s + b.anti_air * ANTI_AIR_W, 0);

  const hasEffectiveAT = unitIds.some(id => (ammoAtByUnitId.get(id) ?? 0) > 5);
  const hasArmoredVehicles = unitMap != null && unitIds.some(id => {
    const u = unitMap.get(id);
    return ((u?.logistics?.tanks_operational ?? 0) + (u?.logistics?.ifv_operational ?? 0)) > 0;
  });

  return {
    armorShare: armorContrib / totalStatic,
    artilleryShare: artContrib / totalStatic,
    antiTankShare: atContrib / totalStatic,
    hasEffectiveAT,
    hasArmoredVehicles,
  };
}

// ─── Składniki atrycji ────────────────────────────────────────────────────────

export type AttritionComponents = {
  personnelLoss: number;          // head count lost total
  personnelDead: number;          // KIA (30% of personnelLoss)
  personnelWounded: number;       // WIA (70% of personnelLoss)
  tankLoss: number;               // czołgi
  ifvLoss: number;                // BWP/KTO
  armoredArtilleryLoss: number;   // artylerja opancerzona
  mortarLoss: number;             // moździerze (mortars_operational)
  droneLoss: number;              // drony (drones_available)
  ammoSmallArmsBurn: number;
  ammoMainBurn: number;
  ammoSecondaryBurn: number;
  ammoAtBurn: number;
  mortarAmmoBurn: number;
  fuelBurn: number;               // litry
  ceDrop: number;                 // punkty procentowe
};

/**
 * Stochastic integer rounding: raw=0.216 → 21.6% chance of 1, else 0.
 * Ensures correct EXPECTED loss rate even for sub-1 values.
 */
function stochRound(raw: number, rng: () => number = Math.random): number {
  if (raw <= 0) return 0;
  const floor = Math.floor(raw);
  return floor + (rng() < (raw - floor) ? 1 : 0);
}

/**
 * Surowe (przed losowym zaokrągleniem) wartości strat — deterministyczne.
 * Pola liczbowe to oczekiwane straty (wartość średnia stochRound).
 * Wyodrębnione, by port Pythona mógł je odtworzyć 1:1 (parity, bez RNG).
 */
export type AttritionRaw = Omit<AttritionComponents, "personnelDead" | "personnelWounded">;

/**
 * Compute the deterministic (pre-rounding) loss values for `defUnit` in one tick.
 * `baseLoss` = opponentTotalEffectivePot × ATTRITION_COEFFICIENT
 */
export function computeAttritionRaw(
  defUnit: UnitLike,
  baseLoss: number,
  attackerProfile: AttackerProfile,
): AttritionRaw {
  const log = defUnit.logistics ?? {};
  const cls = classifyUnitType(defUnit);

  const personnelTotal = log.personnel_total ?? 0;
  // Losses scale off OPERATIONAL counts — only vehicles/tubes that still exist can be destroyed,
  // and this ties directly to what the UI shows (operational), avoiding the null-total trap
  // (manually created units often leave *_total at 0, which previously zeroed all vehicle losses).
  const tanksOp     = log.tanks_operational ?? 0;
  const ifvOp       = log.ifv_operational ?? 0;
  const armArtOp    = log.armored_artillery_operational ?? 0;
  const mortarsOp   = log.mortars_operational ?? 0;
  const dronesAvail = log.drones_available ?? 0;
  const opVehicles  = tanksOp + ifvOp + armArtOp;

  // Combined vehicle kill factor — based on both own armor AND dedicated AT weapons:
  //   Own armor + AT:    1.0  (full armored assault)
  //   Own armor + no AT: 0.60 (still effective direct-fire)
  //   No armor + AT:     0.40 (infantry ppanc can kill tanks)
  //   No armor + no AT:  0.05 (virtually immune to vehicle kills)
  const vehicleKillFactor = attackerProfile.hasArmoredVehicles
    ? (attackerProfile.hasEffectiveAT ? 1.0 : 0.60)
    : (attackerProfile.hasEffectiveAT ? 0.40 : 0.05);

  // Armored ammo gated by whether unit actually has operational armored vehicles
  const ownArmoredOp = (log.tanks_operational ?? 0) + (log.ifv_operational ?? 0);
  const hasOwnArmor = ownArmoredOp > 0;

  // Armor provides crew/vehicle protection — units riding in armored vehicles take fewer personnel
  // losses and morale hits. "armor" class already models this via the 0.3× crew multiplier,
  // so we only apply the factor to other classes that happen to have armored support.
  const armorProtectionFactor = (ownArmoredOp > 0 && cls !== "armor") ? 0.55 : 1.0;

  // SA ammo rates per class (always consumed in combat)
  const SA_RATE: Record<UnitClass, number> = {
    infantry:  3000,
    armor:      400,
    artillery:  600,
    anti_tank:  800,
  };

  // AT ammo rates per class (ppanc/OPL ręczna)
  const AT_RATE: Record<UnitClass, number> = {
    infantry:    150,
    armor:        50,
    artillery:    30,
    anti_tank:   800,
  };

  // Mortar ammo rates per class (indirect fire support during engagement)
  const MORTAR_AMMO_RATE: Record<UnitClass, number> = {
    infantry:   80,
    armor:      20,  // may have attached mortar support
    artillery: 150,
    anti_tank:  40,
  };
  // Whether this unit actually has indirect-fire weapons to burn ammo for
  const hasIndirectFire = mortarsOp > 0 || armArtOp > 0;

  // Combat fuel burn per OPERATIONAL vehicle, per attrition check (~1 s sim time).
  // Engines idle, vehicles reposition and run generators under fire even when the unit is
  // stationary — so any unit WITH vehicles drains fuel while engaged. Foot units burn nothing.
  const COMBAT_FUEL_PER_VEHICLE: Record<UnitClass, number> = {
    armor:     0.25,
    artillery: 0.18,
    anti_tank: 0.15,
    infantry:  0.12,
  };

  let personnelLoss: number;
  let tankLoss: number;
  let ifvLoss: number;
  let armoredArtilleryLoss: number;
  let ammoMainBurn: number;
  let ammoSecondaryBurn: number;
  let ceDrop: number;

  switch (cls) {
    case "infantry": {
      const personnelMult =
        1.2 * (1 + attackerProfile.armorShare * 1.5 + attackerProfile.artilleryShare * 1.0);
      personnelLoss        = baseLoss * personnelTotal * personnelMult * armorProtectionFactor;
      tankLoss             = baseLoss * tanksOp * 1.0 * vehicleKillFactor;
      ifvLoss              = baseLoss * ifvOp * 1.0 * vehicleKillFactor;
      armoredArtilleryLoss = baseLoss * armArtOp * 0.8 * vehicleKillFactor;
      ammoMainBurn         = 0;
      ammoSecondaryBurn    = 0;
      ceDrop               = baseLoss * 20 * armorProtectionFactor;
      break;
    }

    case "armor": {
      const vehicleMult = 1.0 + attackerProfile.armorShare * 0.8;
      personnelLoss        = baseLoss * personnelTotal * 0.3;
      tankLoss             = baseLoss * tanksOp * vehicleMult * vehicleKillFactor;
      ifvLoss              = baseLoss * ifvOp * vehicleMult * vehicleKillFactor;
      armoredArtilleryLoss = baseLoss * armArtOp * vehicleMult * vehicleKillFactor;
      ammoMainBurn         = hasOwnArmor ? baseLoss * 8 : 0;
      ammoSecondaryBurn    = hasOwnArmor ? baseLoss * 40 : 0;
      ceDrop               = baseLoss * 12;
      break;
    }

    case "artillery": {
      personnelLoss        = baseLoss * personnelTotal * 0.7 * armorProtectionFactor;
      tankLoss             = baseLoss * tanksOp * 0.8 * vehicleKillFactor;
      ifvLoss              = baseLoss * ifvOp * 0.8 * vehicleKillFactor;
      armoredArtilleryLoss = baseLoss * armArtOp * 0.9 * vehicleKillFactor;
      ammoMainBurn         = hasOwnArmor ? baseLoss * 4 : 0;
      ammoSecondaryBurn    = hasOwnArmor ? baseLoss * 20 : 0;
      ceDrop               = baseLoss * 18 * armorProtectionFactor;
      break;
    }

    case "anti_tank": {
      personnelLoss        = baseLoss * personnelTotal * 0.8 * armorProtectionFactor;
      tankLoss             = baseLoss * tanksOp * 0.6 * vehicleKillFactor;
      ifvLoss              = baseLoss * ifvOp * 0.6 * vehicleKillFactor;
      armoredArtilleryLoss = baseLoss * armArtOp * 0.5 * vehicleKillFactor;
      ammoMainBurn         = 0;
      ammoSecondaryBurn    = 0;
      ceDrop               = baseLoss * 15 * armorProtectionFactor;
      break;
    }
  }

  // Fuel drains while engaged for any unit that still has operational vehicles —
  // independent of baseLoss, so even a stationary unit under fire loses fuel.
  const fuelBurn = opVehicles * COMBAT_FUEL_PER_VEHICLE[cls];

  return {
    personnelLoss,
    tankLoss,
    ifvLoss,
    armoredArtilleryLoss,
    mortarLoss:        baseLoss * mortarsOp * 0.8,
    droneLoss:         baseLoss * dronesAvail * 0.6,
    ammoSmallArmsBurn: baseLoss * SA_RATE[cls],
    ammoMainBurn,
    ammoSecondaryBurn,
    ammoAtBurn:        baseLoss * AT_RATE[cls],
    mortarAmmoBurn:    hasIndirectFire ? baseLoss * MORTAR_AMMO_RATE[cls] : 0,
    fuelBurn,
    ceDrop,
  };
}

/**
 * Compute what is lost by `defUnit` in one attrition tick (integer losses).
 * Cienka nakładka na computeAttritionRaw: stosuje stochastyczne zaokrąglenie.
 * Zachowanie identyczne jak poprzednio (kolejność stochRound bez zmian).
 */
export function computeAttritionComponents(
  defUnit: UnitLike,
  baseLoss: number,
  attackerProfile: AttackerProfile,
  /** Generator losowy symulacji (seedowany); domyślnie Math.random — golden cases i testy. */
  rng: () => number = Math.random,
): AttritionComponents {
  const raw = computeAttritionRaw(defUnit, baseLoss, attackerProfile);
  const round = (value: number) => stochRound(value, rng);

  const personnelLoss    = round(raw.personnelLoss);
  const personnelDead    = round(personnelLoss * 0.30);
  const personnelWounded = personnelLoss - personnelDead;

  return {
    personnelLoss,
    personnelDead,
    personnelWounded,
    tankLoss:             round(raw.tankLoss),
    ifvLoss:              round(raw.ifvLoss),
    armoredArtilleryLoss: round(raw.armoredArtilleryLoss),
    mortarLoss:           round(raw.mortarLoss),
    droneLoss:            round(raw.droneLoss),
    ammoSmallArmsBurn:    round(raw.ammoSmallArmsBurn),
    ammoMainBurn:         round(raw.ammoMainBurn),
    ammoSecondaryBurn:    round(raw.ammoSecondaryBurn),
    ammoAtBurn:           round(raw.ammoAtBurn),
    mortarAmmoBurn:       round(raw.mortarAmmoBurn),
    fuelBurn:             raw.fuelBurn,
    ceDrop:               raw.ceDrop,
  };
}

/**
 * Apply computed AttritionComponents to a unit and return updated unit.
 */
export function applyAttritionComponents(unit: UnitLike & { logistics?: any }, c: AttritionComponents): typeof unit {
  if (!unit.logistics) return unit;
  const log = unit.logistics;
  return {
    ...unit,
    logistics: {
      ...log,
      personnel_available:           Math.max(0, (log.personnel_available ?? 0) - c.personnelLoss),
      personnel_dead:                (log.personnel_dead ?? 0) + c.personnelDead,
      personnel_wounded:             (log.personnel_wounded ?? 0) + c.personnelWounded,
      tanks_operational:             Math.max(0, (log.tanks_operational ?? 0) - c.tankLoss),
      ifv_operational:               Math.max(0, (log.ifv_operational ?? 0) - c.ifvLoss),
      armored_artillery_operational: Math.max(0, (log.armored_artillery_operational ?? 0) - c.armoredArtilleryLoss),
      mortars_operational:           Math.max(0, (log.mortars_operational ?? 0) - c.mortarLoss),
      drones_available:              Math.max(0, (log.drones_available ?? 0) - c.droneLoss),
      ammo_small_arms:               Math.max(0, (log.ammo_small_arms ?? 0) - c.ammoSmallArmsBurn),
      ammo_main:                     log.ammo_main != null ? Math.max(0, log.ammo_main - c.ammoMainBurn) : null,
      ammo_secondary:                log.ammo_secondary != null ? Math.max(0, log.ammo_secondary - c.ammoSecondaryBurn) : null,
      ammo_at:                       Math.max(0, (log.ammo_at ?? 0) - c.ammoAtBurn),
      ammo_mortar:                   Math.max(0, (log.ammo_mortar ?? 0) - c.mortarAmmoBurn),
      fuel_liters:                   Math.max(0, (log.fuel_liters ?? 0) - c.fuelBurn),
      combat_effectiveness_percent:  Math.max(0, (log.combat_effectiveness_percent ?? 100) - c.ceDrop),
    },
  };
}

// ─── Spalanie paliwa podczas ruchu ───────────────────────────────────────────

/**
 * Fuel burned when a unit moves `distanceMeters` in EPSG:3857 space.
 */
export function computeMovementFuelBurn(unit: UnitLike, distanceMeters: number): number {
  if (distanceMeters <= 0) return 0;
  const distanceKm = distanceMeters / 1000;
  switch (classifyUnitType(unit)) {
    case "armor":     return distanceKm * 3.0;
    case "artillery": return distanceKm * 1.5;
    case "anti_tank": return distanceKm * 1.5;
    case "infantry":  return distanceKm * 0.2;
  }
}
