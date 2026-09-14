import type {
  Unit,
  CreateUnitPayload,
  UpdateUnitPayload,
  UpdateUnitLogisticsPayload,
  CreateFromDetectionPayload,
} from "../types/map";

const API_BASE = "/api/units";

export async function getUnits(): Promise<Unit[]> {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error("Failed to fetch units");
  return res.json();
}

export async function createUnit(payload: {
  symbol_id: string;
  symbol_name: string;
  side: string;
  x: number;
  y: number;
  position_lon?: number;
  position_lat?: number;
  source?: string;
  unit_type?: string;
  echelon?: string;
  unit_number?: number | null;
  custom_name?: string | null;
  base_speed_kmh?: number | null;
  logistics?: Partial<UpdateUnitLogisticsPayload>;
}): Promise<Unit> {
  const res = await fetch("/api/units/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to create unit");
  return res.json();
}

/** Podporządkowuje jednostkę `childId` jednostce `parentId`. */
export async function linkSubordinate(parentId: string, childId: string): Promise<void> {
  const res = await fetch(`/units/${parentId}/subordinates/${childId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relation_type: "subordinate", order_index: 0 }),
  });
  if (!res.ok) throw new Error(`Failed to link subordinate: ${res.status}`);
}

export async function updateUnit(
  unitId: string,
  payload: Partial<{
    x: number;
    y: number;
    position_lon: number;
    position_lat: number;
    current_elevation_m: number;
    unit_number: number | null;
    custom_name: string | null;
    base_speed_kmh: number | null;
    readiness_status: string;
  }>
): Promise<Unit> {
  const res = await fetch(`/api/units/${unitId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update unit: ${res.status} ${text}`);
  }

  return res.json();
}

export async function updateUnitLogistics(id: string, payload: UpdateUnitLogisticsPayload): Promise<any> {
  const res = await fetch(`${API_BASE}/${id}/logistics`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to update unit logistics");
  return res.json();
}

export async function deleteUnit(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete unit");
}

export async function createUnitFromDetection(payload: CreateFromDetectionPayload): Promise<Unit> {
  const res = await fetch(`${API_BASE}/from-detection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to create unit from detection");
  return res.json();
}

export async function generateUnitChildren(unitId: string, childCount: number = 2): Promise<any> {
  const res = await fetch(`${API_BASE}/${unitId}/generate-children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ child_count: childCount }),
  });
  if (!res.ok) throw new Error("Failed to generate children");
  return res.json();
}

export async function generateUnitTree(unitId: string, maxDepth: number = 10, child_count_by_echelon?: Record<string, number>): Promise<any> {
  const res = await fetch(`${API_BASE}/${unitId}/generate-tree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      max_depth: maxDepth,
      child_count_by_echelon: child_count_by_echelon
    }),
  });
  if (!res.ok) throw new Error("Failed to generate tree");
  return res.json();
}

export async function createSubordinateInArea(parentUnitId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/${parentUnitId}/create-subordinate-in-area`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = "Nie udało się dodać podwładnego.";
    try {
      const json = JSON.parse(text);
      detail = json.detail || detail;
    } catch(e) {}
    throw new Error(detail);
  }
  return res.json();
}

export async function createChildWithArea(parentUnitId: string, coordinates: [number, number][], unit_number?: number, custom_name?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/${parentUnitId}/create-child-with-area`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates, unit_number, custom_name })
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = "Nie udało się dodać podwładnego z obszarem.";
    try {
      const json = JSON.parse(text);
      detail = json.detail || detail;
    } catch(e) {}
    throw new Error(detail);
  }
  return res.json();
}
