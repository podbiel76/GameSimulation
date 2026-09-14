/**
 * combatPotential.ts
 *
 * Abstrakcyjny, konfigurowalny model symulacyjny potencjału bojowego.
 * Inspirowany podejściami Lanchester-like i threat evaluation.
 *
 * NIE jest to realne doradztwo taktyczne — wszystkie współczynniki
 * są parametrami konfiguracyjnymi, nie doktrynowymi wartościami.
 */

import { simLog } from "./debug";

// ─── Typy podstawowe ────────────────────────────────────────────────────────

export type TerrainClass = "forest" | "water" | "wetland" | "urban" | "road" | "open";
export type CombatCategory = "infantry" | "armor" | "artillery" | "anti_air" | "air";

/** Rozkład terenu — udziały klas (np. z WorldCover); nie muszą sumować się do 1. */
export type TerrainMix = Partial<Record<TerrainClass, number>>;
/** Teren wejściowy modelu: jedna klasa albo rozkład klas. */
export type TerrainInput = TerrainClass | TerrainMix;

const TERRAIN_ORDER: TerrainClass[] = ["forest", "water", "wetland", "urban", "road", "open"];

/** Klasa o największym udziale (remis → kolejność TERRAIN_ORDER, pusty rozkład → open). */
export function dominantTerrain(input: TerrainInput): TerrainClass {
  if (typeof input === "string") return input;
  let best: TerrainClass = "open";
  let bestShare = 0;
  for (const c of TERRAIN_ORDER) {
    const s = input[c] ?? 0;
    if (s > bestShare) { best = c; bestShare = s; }
  }
  return best;
}

/** Modyfikator terenu: dla rozkładu — średnia z tabeli ważona udziałami klas. */
export function terrainModifierFor(table: Record<TerrainClass, number>, input: TerrainInput): number {
  if (typeof input === "string") return table[input] ?? 1.0;
  let total = 0;
  let acc = 0;
  for (const c of TERRAIN_ORDER) {
    const s = input[c] ?? 0;
    if (s > 0) { total += s; acc += s * (table[c] ?? 1.0); }
  }
  return total > 0 ? acc / total : (table.open ?? 1.0);
}

// Rozszerzony typ logistyki (frontend ma podzbiór — reszta opcjonalna)
export type ExtendedLogistics = {
  personnel_total?: number | null;
  personnel_available?: number | null;
  personnel_wounded?: number | null;
  personnel_dead?: number | null;
  ammo_small_arms?: number | null;
  ammo_at?: number | null;
  ammo_mortar?: number | null;
  ammo_main?: number | null;
  ammo_secondary?: number | null;
  drones_total?: number | null;
  drones_available?: number | null;
  tanks_total?: number | null;
  tanks_operational?: number | null;
  ifv_total?: number | null;
  ifv_operational?: number | null;
  armored_artillery_total?: number | null;
  armored_artillery_operational?: number | null;
  mortars_total?: number | null;
  mortars_operational?: number | null;
  fuel_liters?: number | null;
  fuel_capacity_liters?: number | null;
  supply_priority?: string | null;
  evacuation_required?: boolean | null;
  combat_effectiveness_percent?: number | null;
  notes?: string | null;
};

// Jednostka przekazywana do obliczeń
export type UnitLike = {
  id: string;
  symbol_name?: string;
  custom_name?: string | null;
  side?: string;
  unit_type?: string;
  echelon?: string;
  base_speed_kmh?: number | null;
  readiness_status?: string | null;
  logistics?: ExtendedLogistics | null;
};

// Pełny breakdown potencjału
export type PotentialBreakdown = {
  // Punkty per kategorii (0–100 każda przed normalizacją)
  infantry: number;
  armor: number;
  artillery: number;
  anti_air: number;
  air: number;
  // Modyfikatory (0–2, terrain może być > 1 dla obrońcy)
  readinessModifier: number;
  personnelModifier: number;
  mobilityModifier: number;
  terrainModifier: number;
  combatEffectivenessModifier: number;
  // Wyniki łączne
  staticPotential: number;    // Σ(category × weight)
  effectivePotential: number; // static × wszystkie modyfikatory
  // Rola i teren użyte do obliczeń
  role: CombatRole;
  /** Klasa dominująca (przy rozkładzie — o największym udziale). */
  terrain: TerrainClass;
  /** Rozkład terenu, gdy potencjał liczono z profilu terenu. */
  terrainMix?: TerrainMix;
};

export type CombatRole = "attacker" | "defender" | "neutral";

// Konfiguracja modelu
export type PotentialConfig = {
  categoryWeights: Record<CombatCategory, number>;

  // Teren neutralny (brak roli) — bazowe wartości
  terrainModifiers: Record<TerrainClass, number>;

  // Teren dla atakujących: otwarte/droga pomaga, las/miasto utrudnia podejście
  terrainModifiersAttacker: Record<TerrainClass, number>;

  // Teren dla broniących: zakrycie i osłona zwiększają potencjał
  // (wartości mogą być > 1.0 — to celowe, obronny bonus terenu)
  terrainModifiersDefender: Record<TerrainClass, number>;

  // Skale dla amunicji (żeby nie generować inf z dużych stockpilów)
  ammoSmallArmsMax: number;
  ammoAtMax: number;
  ammoMortarMax: number;
  ammoMainMax: number;
  ammoSecondaryMax: number;
  dronesMax: number;
  // Domyślna pojemność paliwa gdy brak danych
  fuelCapacityDefault: number;
};

export type UnitPotentialResult = {
  unitId: string;
  unitName: string;
  breakdown: PotentialBreakdown;
};

export type CategoryComparison = {
  own: number;
  target: number;
  ratio: number;
};

export type EngagementPrediction = {
  predictedWinner: "own" | "target" | "draw";
  advantageRatio: number;
  // Heurystyczny szacunek czasu starcia [minuty]
  estimatedEngagementTimeMinutes: number;
  ownRemainingPercent: number;
  targetRemainingPercent: number;
  // Poziom ufności (0–1): niska przy bardzo małych potencjałach
  confidence: number;
};

export type PotentialComparisonResult = {
  ownTotalStatic: number;
  ownTotalEffective: number;
  targetTotalStatic: number;
  targetTotalEffective: number;
  ratioStatic: number;
  ratioEffective: number;
  label: string;
  ownUnits: UnitPotentialResult[];
  targetUnits: UnitPotentialResult[];
  categoryComparison: Record<CombatCategory, CategoryComparison>;
  engagementPrediction?: EngagementPrediction;
};

// ─── Domyślna konfiguracja ───────────────────────────────────────────────────

export const DEFAULT_POTENTIAL_CONFIG: PotentialConfig = {
  categoryWeights: {
    infantry: 0.25,
    armor: 0.30,
    artillery: 0.25,
    anti_air: 0.10,
    air: 0.10,
  },

  // Neutralny — brak roli
  terrainModifiers: {
    road: 1.05,
    open: 1.00,
    urban: 0.85,
    forest: 0.75,
    wetland: 0.45,
    water: 0.05,
  },

  // Atakujący: droga/open pomagają, las/miasto utrudniają manewr i osłaniają przeciwnika
  terrainModifiersAttacker: {
    road:    1.15,  // dobra droga → szybki manewr
    open:    1.00,  // standard
    urban:   0.70,  // walka w mieście kosztowna dla atakującego
    forest:  0.60,  // las hamuje natarcie, ukrywa obrońcę
    wetland: 0.35,  // mokradła — poważna przeszkoda
    water:   0.03,  // przeprawa pod ogniem
  },

  // Broniący: las/miasto/mokradła dają osłonę i opóźnienie
  // wartości > 1.0 są celowe — bonus obronny terenu
  terrainModifiersDefender: {
    road:    0.75,  // brak osłony, trudno okopać
    open:    0.70,  // pole otwarte — obrońca bez zakrycia
    urban:   1.20,  // budynki, barykady, sektory ognia
    forest:  1.30,  // las: doskonała osłona i kamuflarz
    wetland: 1.00,  // mokradła spowalniają też obrońcę, ale kanalizo atak
    water:   0.10,  // atakujący musi przeprawiać się, ale obrońca też ma problem
  },
  ammoSmallArmsMax: 10000,
  ammoAtMax: 50,
  ammoMortarMax: 700,
  ammoMainMax: 100,
  ammoSecondaryMax: 500,
  dronesMax: 20,
  fuelCapacityDefault: 500,
};

// ─── Limity normalizacji wg etatu jednostki ──────────────────────────────────
// Każda wartość = "co oznacza 100% zapasów dla danego etatu".

type AmmoCaps = Pick<PotentialConfig,
  "ammoSmallArmsMax" | "ammoAtMax" | "ammoMortarMax" |
  "ammoMainMax" | "ammoSecondaryMax" |
  "dronesMax" | "fuelCapacityDefault"
>;

export const ECHELON_CAPS: Record<string, AmmoCaps> = {
  team_crew: {
    ammoSmallArmsMax:    120,
    ammoAtMax:             2,
    ammoMortarMax:         5,
    ammoMainMax:          20,
    ammoSecondaryMax:    100,
    dronesMax:             1,
    fuelCapacityDefault:  80,
  },
  squad: {
    ammoSmallArmsMax:    400,
    ammoAtMax:             4,
    ammoMortarMax:        15,
    ammoMainMax:          40,
    ammoSecondaryMax:    300,
    dronesMax:             2,
    fuelCapacityDefault: 200,
  },
  section: {
    ammoSmallArmsMax:    800,
    ammoAtMax:             6,
    ammoMortarMax:        30,
    ammoMainMax:          60,
    ammoSecondaryMax:    600,
    dronesMax:             3,
    fuelCapacityDefault: 400,
  },
  platoon_detachment: {
    ammoSmallArmsMax:  1_500,
    ammoAtMax:            10,
    ammoMortarMax:        80,
    ammoMainMax:          80,
    ammoSecondaryMax:  1_500,
    dronesMax:             4,
    fuelCapacityDefault: 800,
  },
  company_battery_troop: {
    ammoSmallArmsMax:  4_000,
    ammoAtMax:            20,
    ammoMortarMax:       250,
    ammoMainMax:         200,
    ammoSecondaryMax:  4_000,
    dronesMax:             6,
    fuelCapacityDefault: 2_000,
  },
  battalion_squadron: {
    ammoSmallArmsMax:  10_000,
    ammoAtMax:             50,
    ammoMortarMax:        700,
    ammoMainMax:          100,
    ammoSecondaryMax:     500,
    dronesMax:             20,
    fuelCapacityDefault:  500,
  },
  regiment_group: {
    ammoSmallArmsMax:  30_000,
    ammoAtMax:            120,
    ammoMortarMax:      2_000,
    ammoMainMax:          300,
    ammoSecondaryMax:   1_500,
    dronesMax:             30,
    fuelCapacityDefault: 1_500,
  },
  brigade: {
    ammoSmallArmsMax: 100_000,
    ammoAtMax:            300,
    ammoMortarMax:      5_000,
    ammoMainMax:          800,
    ammoSecondaryMax:   5_000,
    dronesMax:             60,
    fuelCapacityDefault: 4_000,
  },
  division: {
    ammoSmallArmsMax:  500_000,
    ammoAtMax:             800,
    ammoMortarMax:      15_000,
    ammoMainMax:         2_000,
    ammoSecondaryMax:   15_000,
    dronesMax:             150,
    fuelCapacityDefault: 12_000,
  },
  corps_mef: {
    ammoSmallArmsMax:  2_000_000,
    ammoAtMax:             2_000,
    ammoMortarMax:        50_000,
    ammoMainMax:           6_000,
    ammoSecondaryMax:     50_000,
    dronesMax:               400,
    fuelCapacityDefault:  40_000,
  },
  army: {
    ammoSmallArmsMax:  8_000_000,
    ammoAtMax:             6_000,
    ammoMortarMax:       180_000,
    ammoMainMax:          20_000,
    ammoSecondaryMax:    200_000,
    dronesMax:             1_000,
    fuelCapacityDefault: 150_000,
  },
  army_group_front: {
    ammoSmallArmsMax:  30_000_000,
    ammoAtMax:              20_000,
    ammoMortarMax:         600_000,
    ammoMainMax:            70_000,
    ammoSecondaryMax:      700_000,
    dronesMax:               3_000,
    fuelCapacityDefault:   500_000,
  },
  region_theater: {
    ammoSmallArmsMax: 100_000_000,
    ammoAtMax:               60_000,
    ammoMortarMax:         2_000_000,
    ammoMainMax:             200_000,
    ammoSecondaryMax:      2_000_000,
    dronesMax:                 8_000,
    fuelCapacityDefault:   2_000_000,
  },
};

function getEchelonCaps(echelon: string | undefined): Partial<PotentialConfig> {
  if (!echelon) return {};
  return ECHELON_CAPS[echelon.toLowerCase()] ?? {};
}

// ─── Pomocnicze ──────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, isFinite(v) ? v : 0));
}

function safeRatio(num: number | null | undefined, denom: number | null | undefined, fallback = 0): number {
  const n = num ?? 0;
  const d = denom ?? 0;
  if (d <= 0) return fallback;
  return clamp(n / d);
}

function scaledAmmo(val: number | null | undefined, cap: number): number {
  const v = val ?? 0;
  if (cap <= 0) return 0;
  return clamp(v / cap);
}

// Krzywa efektywności personelu wg odsetka zdolnych do walki.
// Punkty kontrolne: ≥75% → 1.0 | 50% → 0.60 | 25% → 0.25 | 0% → 0.0 (liniowo).
function personnelEffectiveness(ratio: number): number {
  const r = clamp(ratio);
  if (r >= 0.75) return 1.0;
  if (r >= 0.50) return 0.60 + (r - 0.50) / 0.25 * (1.0 - 0.60);
  if (r >= 0.25) return 0.25 + (r - 0.25) / 0.25 * (0.60 - 0.25);
  return clamp((r / 0.25) * 0.25);
}

function resolveReadiness(status: string | null | undefined): number {
  switch ((status ?? "").toLowerCase()) {
    case "ready": return 1.0;
    case "limited": return 0.7;
    case "incomplete": return 0.4;
    case "destroyed": return 0.0;
    default: return 0.5;
  }
}

function labelForRatio(ratio: number): string {
  if (ratio < 0.5) return "duża przewaga wskazanych jednostek";
  if (ratio < 0.8) return "przewaga wskazanych jednostek";
  if (ratio <= 1.2) return "względna równowaga";
  if (ratio <= 1.8) return "przewaga własna";
  return "duża przewaga własna";
}

function mergeConfig(partial?: Partial<PotentialConfig>): PotentialConfig {
  if (!partial) return DEFAULT_POTENTIAL_CONFIG;
  return {
    ...DEFAULT_POTENTIAL_CONFIG,
    ...partial,
    categoryWeights: { ...DEFAULT_POTENTIAL_CONFIG.categoryWeights, ...partial.categoryWeights },
    terrainModifiers: { ...DEFAULT_POTENTIAL_CONFIG.terrainModifiers, ...partial.terrainModifiers },
  };
}

// ─── Główna funkcja obliczania potencjału jednej jednostki ────────────────────

export function computeUnitPotential(
  unit: UnitLike,
  terrain: TerrainInput = "open",
  partialConfig?: Partial<PotentialConfig>,
  role: CombatRole = "neutral",
): UnitPotentialResult {
  const cfg = mergeConfig({ ...getEchelonCaps(unit.echelon), ...partialConfig });
  const log = unit.logistics ?? {};

  // ── Fuel percent ─────────────────────────────────────────────────────────
  const fuelPercent = (() => {
    const cap = (log.fuel_capacity_liters && log.fuel_capacity_liters > 0)
      ? log.fuel_capacity_liters
      : cfg.fuelCapacityDefault;
    return safeRatio(log.fuel_liters, cap, 0.5);
  })();
  // Brak paliwa → pojazdy unieruchomione: nie liczą się do potencjału.
  // null/undefined = brak danych (nie karzemy); 0 = realnie pusty bak.
  const fuelEmpty = log.fuel_liters != null && log.fuel_liters <= 0;

  // ── Statusy ──────────────────────────────────────────────────────────────
  const readiness = resolveReadiness(unit.readiness_status);
  const ceRaw = log.combat_effectiveness_percent;
  // ceRaw > 0 guards against stale DB rows with 0.0 default — treat as "not set" → full effectiveness
  const ceModifier = (ceRaw != null && ceRaw > 0) ? clamp(ceRaw / 100) : 1.0;

  // ── Kategorie (0–1 każda) ─────────────────────────────────────────────────

  // infantry: zdolność walki pieszej
  const personnelRatio = safeRatio(log.personnel_available, log.personnel_total, 0.5);
  const ammoInfantry = scaledAmmo(log.ammo_small_arms, cfg.ammoSmallArmsMax);
  // Amunicja na żołnierza: poniżej 30 nabojów / zdolnego żołnierza część ludzi
  // nie ma czym strzelać → potencjał piechoty spada proporcjonalnie.
  const availableSoldiers = log.personnel_available ?? 0;
  const ammoPerSoldierFactor = availableSoldiers > 0
    ? clamp((log.ammo_small_arms ?? 0) / availableSoldiers / 30)
    : 1.0;
  const infantryRaw = clamp(personnelRatio * ammoInfantry * ammoPerSoldierFactor * readiness * ceModifier);

  // armor: potencjał pancerny — tylko sub-typy pancerne (0 gdy brak danych)
  const armoredTotal = (log.tanks_total ?? 0) + (log.ifv_total ?? 0);
  const armoredOp    = (log.tanks_operational ?? 0) + (log.ifv_operational ?? 0);
  const vehicleRatio = (armoredTotal > 0 && !fuelEmpty) ? safeRatio(armoredOp, armoredTotal, 0.5) : 0;
  const ammoArmor = (
    scaledAmmo(log.ammo_main, cfg.ammoMainMax) * 0.6 +
    scaledAmmo(log.ammo_secondary, cfg.ammoSecondaryMax) * 0.4
  );
  // When vehicle ammo not entered (both null) assume adequate supply (0.75) — but ONLY if
  // the unit is otherwise supplied. A unit that has run out of every ammo type cannot fight,
  // so it gets no benefit-of-the-doubt and armor potential collapses to 0.
  // Explicitly entering 0 is treated as truly empty.
  const hasArmorAmmoData = log.ammo_main !== null || log.ammo_secondary !== null;
  const hasAnyAmmo =
    (log.ammo_small_arms ?? 0) > 0 ||
    (log.ammo_at ?? 0) > 0 ||
    (log.ammo_mortar ?? 0) > 0 ||
    (log.ammo_main ?? 0) > 0 ||
    (log.ammo_secondary ?? 0) > 0;
  const effectiveAmmoArmor = hasArmorAmmoData ? ammoArmor : (hasAnyAmmo ? 0.75 : 0);
  const armorRaw = clamp(vehicleRatio * effectiveAmmoArmor * fuelPercent);

  // artillery: potencjał pośredniego ognia — moździerze + art. opancerzona
  const mortarRatio = (log.mortars_total ?? 0) > 0
    ? safeRatio(log.mortars_operational, log.mortars_total, 0.5) : 0;
  // Art. opancerzona to pojazdy — bez paliwa nie liczy się do potencjału.
  const armoredArtRatio = ((log.armored_artillery_total ?? 0) > 0 && !fuelEmpty)
    ? safeRatio(log.armored_artillery_operational, log.armored_artillery_total, 0.5) : 0;
  // Próg 0.3 (założenie minimalnej zdolności przy braku danych) znika gdy brak paliwa —
  // wtedy zdolność pośredniego ognia wynika wyłącznie z moździerzy (nie-pojazdów).
  const indirectFloor = fuelEmpty ? 0 : 0.3;
  const indirectCap = Math.max(mortarRatio, armoredArtRatio, indirectFloor);
  const ammoMortarScore = scaledAmmo(log.ammo_mortar, cfg.ammoMortarMax);
  const artilleryRaw = clamp(ammoMortarScore * indirectCap * personnelRatio * readiness);

  // anti_air: zdolności obrony powietrznej / przeciwpancernej (placeholder dla przyszłych pól)
  const ammoAt = scaledAmmo(log.ammo_at, cfg.ammoAtMax);
  const droneReconRatio = safeRatio(log.drones_available, log.drones_total, 0);
  const antiAirRaw = clamp(ammoAt * 0.7 + droneReconRatio * 0.3);

  // air: zdolności rozpoznawczo-lotnicze (drony)
  const airRaw = clamp(droneReconRatio);

  // ── Potencjał statyczny ───────────────────────────────────────────────────
  const w = cfg.categoryWeights;
  const staticPotential =
    infantryRaw * w.infantry +
    armorRaw * w.armor +
    artilleryRaw * w.artillery +
    antiAirRaw * w.anti_air +
    airRaw * w.air;

  // ── Modyfikatory efektywne ────────────────────────────────────────────────
  const readinessModifier = readiness;

  // Personel jako globalny modyfikator: gdy odsetek zdolnych do walki spada,
  // cały potencjał jednostki (także pancerny/artyleryjski) maleje.
  //  ≥75% → 1.0 | 50% → 0.60 | 25% → 0.25 | poniżej → liniowo do 0.
  const personnelModifier = personnelEffectiveness(personnelRatio);

  const mobilityModifier = clamp(
    ((unit.base_speed_kmh ?? 30) / 100) * 0.5 +
    vehicleRatio * 0.3 +
    fuelPercent * 0.2
  );

  // Wybierz tabelę modyfikatorów terenu zależnie od roli
  // Obrońcy mogą mieć wartości > 1.0 (bonus osłony) — clamp do [0, 2.0]
  const terrainTable =
    role === "attacker" ? cfg.terrainModifiersAttacker :
    role === "defender" ? cfg.terrainModifiersDefender :
    cfg.terrainModifiers;
  const terrainModifier = clamp(terrainModifierFor(terrainTable, terrain), 0, 2.0);
  const combatEffectivenessModifier = ceModifier;

  const effectivePotential = clamp(
    staticPotential *
    readinessModifier *
    personnelModifier *
    mobilityModifier *
    terrainModifier *
    combatEffectivenessModifier,
    0, Infinity
  );

  const unitName = unit.custom_name || unit.symbol_name || unit.id;

  return {
    unitId: unit.id,
    unitName,
    breakdown: {
      infantry: infantryRaw,
      armor: armorRaw,
      artillery: artilleryRaw,
      anti_air: antiAirRaw,
      air: airRaw,
      readinessModifier,
      personnelModifier,
      mobilityModifier,
      terrainModifier,
      combatEffectivenessModifier,
      staticPotential,
      effectivePotential,
      role,
      terrain: dominantTerrain(terrain),
      ...(typeof terrain === "string" ? {} : { terrainMix: terrain }),
    },
  };
}

// ─── Predykcja starcia (Lanchester-like heurystyka) ────────────────────────

/**
 * Uproszczony heurystyczny model predykcji starcia inspirowany Lanchester-like comparison.
 * NIE jest to rzeczywista prognoza bojowa — służy wyłącznie jako abstrakcyjna miara
 * symulacyjna do celów szkoleniowych.
 */
export function estimateEngagementOutcome(
  ownEffective: number,
  targetEffective: number,
): EngagementPrediction {
  const totalEffective = ownEffective + targetEffective;
  const diff = Math.abs(ownEffective - targetEffective);
  const ratio = ownEffective / Math.max(0.001, targetEffective);

  // Przewidywany zwycięzca
  let predictedWinner: EngagementPrediction["predictedWinner"];
  if (ratio > 1.2) predictedWinner = "own";
  else if (ratio < 0.8) predictedWinner = "target";
  else predictedWinner = "draw";

  // Szacowany czas: większa dysproporcja → krótsze starcie
  const rawTime = 60 * totalEffective / (diff + 0.1);
  const estimatedEngagementTimeMinutes = Math.round(Math.max(5, Math.min(300, rawTime)));

  // Szacowane pozostałości (proporcjonalne do stosunku sił)
  const ownRemainingPercent = predictedWinner === "own"
    ? Math.round(clamp((ownEffective - targetEffective) / Math.max(0.001, ownEffective)) * 100)
    : predictedWinner === "draw" ? 20
    : 0;
  const targetRemainingPercent = predictedWinner === "target"
    ? Math.round(clamp((targetEffective - ownEffective) / Math.max(0.001, targetEffective)) * 100)
    : predictedWinner === "draw" ? 20
    : 0;

  // Poziom ufności: niska przy bardzo małych potencjałach lub skrajnych wartościach
  const confidence = clamp(
    totalEffective < 0.02 ? 0.1
    : totalEffective < 0.1 ? 0.3
    : totalEffective < 0.5 ? 0.6
    : 0.85
  );

  return {
    predictedWinner,
    advantageRatio: ratio,
    estimatedEngagementTimeMinutes,
    ownRemainingPercent,
    targetRemainingPercent,
    confidence,
  };
}

// ─── Funkcja porównania ───────────────────────────────────────────────────────

export function compareCombatPotential(
  ownUnits: UnitLike[],
  targetUnits: UnitLike[],
  options?: {
    ownTerrainByUnitId?: Record<string, TerrainInput>;
    targetTerrainByUnitId?: Record<string, TerrainInput>;
    ownRole?: CombatRole;
    targetRole?: CombatRole;
    config?: Partial<PotentialConfig>;
    includeEngagementPrediction?: boolean;
  },
): PotentialComparisonResult {
  const cfg = options?.config;
  const ownTerrain = options?.ownTerrainByUnitId ?? {};
  const tgtTerrain = options?.targetTerrainByUnitId ?? {};
  const ownRole    = options?.ownRole    ?? "neutral";
  const targetRole = options?.targetRole ?? "neutral";

  const ownResults = ownUnits.map(u =>
    computeUnitPotential(u, ownTerrain[u.id] ?? "open", cfg, ownRole)
  );
  const targetResults = targetUnits.map(u =>
    computeUnitPotential(u, tgtTerrain[u.id] ?? "open", cfg, targetRole)
  );

  const sum = (results: UnitPotentialResult[], field: keyof PotentialBreakdown) =>
    results.reduce((acc, r) => acc + (r.breakdown[field] as number), 0);

  const ownTotalStatic = sum(ownResults, "staticPotential");
  const ownTotalEffective = sum(ownResults, "effectivePotential");
  const targetTotalStatic = sum(targetResults, "staticPotential");
  const targetTotalEffective = sum(targetResults, "effectivePotential");

  const ratioStatic = ownTotalStatic / Math.max(0.0001, targetTotalStatic);
  const ratioEffective = ownTotalEffective / Math.max(0.0001, targetTotalEffective);
  const label = labelForRatio(ratioEffective);

  const cats: CombatCategory[] = ["infantry", "armor", "artillery", "anti_air", "air"];
  const categoryComparison = Object.fromEntries(
    cats.map(cat => {
      const own = sum(ownResults, cat);
      const target = sum(targetResults, cat);
      return [cat, { own, target, ratio: own / Math.max(0.0001, target) }];
    })
  ) as Record<CombatCategory, CategoryComparison>;

  const engagementPrediction =
    options?.includeEngagementPrediction !== false
      ? estimateEngagementOutcome(ownTotalEffective, targetTotalEffective)
      : undefined;

  const result: PotentialComparisonResult = {
    ownTotalStatic,
    ownTotalEffective,
    targetTotalStatic,
    targetTotalEffective,
    ratioStatic,
    ratioEffective,
    label,
    ownUnits: ownResults,
    targetUnits: targetResults,
    categoryComparison,
    engagementPrediction,
  };

  simLog(() => ["[COMBAT POTENTIAL] comparison", {
    ownUnits: ownResults.map(r => ({ name: r.unitName, ...r.breakdown })),
    targetUnits: targetResults.map(r => ({ name: r.unitName, ...r.breakdown })),
    summary: {
      ownStatic: ownTotalStatic.toFixed(4),
      ownEffective: ownTotalEffective.toFixed(4),
      targetStatic: targetTotalStatic.toFixed(4),
      targetEffective: targetTotalEffective.toFixed(4),
      ratioEffective: ratioEffective.toFixed(3),
      label,
    },
    categoryComparison,
    engagementPrediction,
  }]);

  return result;
}
