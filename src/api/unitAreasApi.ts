/**
 * Unit Areas API — fetches GeoJSON and creates square responsibility areas.
 */

export interface UnitAreaGeoJson {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Polygon";
      coordinates: number[][][];
    };
    properties: {
      id: string;
      unit_id: string;
      unit_name: string;
      name: string | null;
      area_type: string;
      area_km2: number;
    };
  }>;
}

export interface UnitAreaCreated {
  id: string;
  unit_id: string;
  name: string | null;
  area_type: string;
  bearing_deg: number;
  bbox: number[] | null;
  area_km2: number | null;
  coordinates: number[][] | null;
  created_at: string;
  updated_at: string;
}

export type UnitArea = {
  id: string;
  unit_id: string;
  name?: string | null;
  area_type: string;
  area_km2?: number | null;
  bearing_deg?: number | null;
  coordinates?: [number, number][] | null;
  bbox?: [number, number, number, number] | null;
  unit_side?: string;
};

/**
 * Fetch all unit areas as a list.
 */
export async function getUnitAreas(): Promise<UnitArea[]> {
  const res = await fetch("/map/unit-areas");
  if (!res.ok) throw new Error("Failed to fetch unit areas");
  return res.json();
}

/**
 * Fetch all unit areas as GeoJSON FeatureCollection.
 */
export async function getUnitAreasGeoJson(): Promise<UnitAreaGeoJson> {
  const res = await fetch("/api/unit-areas.geojson");
  if (!res.ok) throw new Error("Failed to fetch unit areas GeoJSON");
  return res.json();
}

/**
 * Fetch areas for a specific unit as GeoJSON FeatureCollection.
 */
export async function getUnitAreasGeoJsonForUnit(
  unitId: string
): Promise<UnitAreaGeoJson> {
  const res = await fetch(`/units/${unitId}/areas.geojson`);
  if (!res.ok) throw new Error("Failed to fetch unit areas GeoJSON");
  return res.json();
}

/**
 * Create a square responsibility area for a unit.
 */
export async function createSquareArea(
  unitId: string,
  sizeKm: number,
  name?: string,
  bearingDeg: number = 0
): Promise<UnitAreaCreated> {
  const res = await fetch(`/map/units/${unitId}/area/square`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size_km: sizeKm,
      name: name || null,
      bearing_deg: bearingDeg,
    }),
  });
  if (!res.ok) throw new Error("Failed to create square area");
  return res.json();
}

/**
 * Delete a unit area.
 */
export async function deleteUnitArea(areaId: string): Promise<{ deleted: boolean; area_id: string }> {
  const res = await fetch(`/map/unit-areas/${areaId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete unit area");
  return res.json();
}

/**
 * Delete a unit area and its descendants recursively.
 */
export async function deleteUnitAreaCascade(areaId: string): Promise<{ 
  deleted: boolean; 
  area_id: string; 
  deleted_count: number;
  deleted_area_ids: string[];
}> {
  const res = await fetch(`/map/unit-areas/${areaId}/cascade`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete unit areas cascade");
  return res.json();
}

/**
 * Create a polygon responsibility area for a unit.
 */
export async function createPolygonArea(
  payload: {
    unit_id: string;
    name?: string;
    area_type?: string;
    coordinates: [number, number][];
    bearing_deg?: number;
  }
): Promise<UnitAreaCreated> {
  const res = await fetch(`/map/unit-areas/polygon`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = "Nie udało się utworzyć obszaru.";
    try {
      const data = await res.json();
      if (data.detail) {
        if (typeof data.detail === "object") {
          message = data.detail.message || JSON.stringify(data.detail, null, 2);
        } else {
          message = data.detail;
        }
      }
    } catch (e) {
      console.error("Failed to parse error response:", e);
    }
    throw new Error(message);
  }
  return res.json();
}

/**
 * Update an existing polygon responsibility area.
 */
export async function updatePolygonArea(
  areaId: string,
  payload: {
    coordinates: [number, number][];
    name?: string;
    area_type?: string;
    bearing_deg?: number;
    recenter_unit?: boolean;
    skip_validation?: boolean;
  }
): Promise<UnitAreaCreated> {
  const res = await fetch(`/map/unit-areas/${areaId}/polygon`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = "Nie udało się zaktualizować obszaru.";
    try {
      const data = await res.json();
      if (data.detail) {
        if (typeof data.detail === "object") {
          message = data.detail.message || JSON.stringify(data.detail, null, 2);
        } else {
          message = data.detail;
        }
      }
    } catch (e) {
      console.error("Failed to parse error response:", e);
    }
    throw new Error(message);
  }
  return res.json();
}
