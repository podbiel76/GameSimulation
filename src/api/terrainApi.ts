import type { TerrainClass } from "../utils/combatPotential";

/** Statystyki terenu obszaru — udziały klas (0–1) i rzeźba z DEM. */
export type TerrainAreaStats = {
  shares: Record<TerrainClass, number>;
  dominant: TerrainClass;
  resolution_m: number;
  /** Część obszaru pokryta danymi (reszta poza zasięgiem plików). */
  valid_fraction: number;
  elevation_m?: number | null;
  mean_elevation_m?: number | null;
  mean_slope_deg?: number | null;
  relief_m?: number | null;
  radius_m?: number;
  area_km2?: number | null;
};

export type TerrainProfileResponse = {
  available: boolean;
  reason: string | null;
  /** Teren w promieniu wokół jednostki — obrona. */
  local: TerrainAreaStats | null;
  /** Teren w AO — natarcie i manewr. */
  ao: TerrainAreaStats | null;
  sources: { landcover: string; dem: string | null; roads?: string | null };
};

export async function fetchTerrainProfile(body: {
  lon: number;
  lat: number;
  radius_m?: number;
  ao?: [number, number][] | null;
}): Promise<TerrainProfileResponse> {
  const res = await fetch("/api/terrain/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Terrain profile failed: ${res.status}`);
  return res.json();
}
