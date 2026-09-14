/**
 * Profil terenu jednostki → wejście terenu dla modelu potencjału.
 *
 * Uzgodniony model:
 *  · obrońca    — teren w promieniu wokół jednostki (TERRAIN_DEFENSE_RADIUS_M),
 *  · atakujący, manewr i rola neutralna — rozkład terenu w AO
 *    (gdy jednostka nie ma AO — ten sam promień wokół niej).
 *
 * Abstrakcyjny model symulacyjny — nie realne doradztwo taktyczne.
 */
import type { CombatRole, TerrainClass, TerrainInput } from "./combatPotential";
import type { TerrainProfileResponse } from "../api/terrainApi";

/** Musi odpowiadać shared/combat_constants.json → potential.terrainProfile.defenseRadiusM. */
export const TERRAIN_DEFENSE_RADIUS_M = 1500;

export type UnitTerrainProfile = TerrainProfileResponse & {
  /** Pozycja i obrys AO, dla których profil policzono — do wykrycia nieaktualności. */
  lon: number;
  lat: number;
  aoKey: string;
  fetchedAt: number;
};

const VALID = new Set<string>(["open", "road", "urban", "forest", "wetland", "water"]);

export function toTerrainClass(raw: string | undefined): TerrainClass {
  return (raw && VALID.has(raw) ? raw : "open") as TerrainClass;
}

/** Klucz obrysu AO — zmiana kształtu lub położenia AO unieważnia profil. */
export function aoKeyOf(coords: [number, number][] | null | undefined): string {
  if (!coords || coords.length < 3) return "";
  return coords.map(([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`).join(";");
}

/** Teren do obliczenia potencjału w danej roli; bez profilu — klasa z analizy mapy. */
export function terrainForRole(
  profile: UnitTerrainProfile | undefined,
  role: CombatRole,
  fallbackClass?: string,
): TerrainInput {
  if (profile?.available) {
    const local = profile.local?.shares;
    const ao = profile.ao?.shares;
    if (role === "defender") {
      if (local) return local;
    } else {
      if (ao) return ao;
      if (local) return local;
    }
  }
  return toTerrainClass(fallbackClass);
}
