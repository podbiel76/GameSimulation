export type RoutePoint = {
  id: string;
  x: number;
  y: number;
  order: number;
};

export type ScenarioMarker = {
  id: string;
  symbolId: string;
  echelon?: string;
  x: number;
  y: number;
  route: RoutePoint[];
  destroyed?: boolean;
};

export type EditorMode = "idle" | "draw-route" | "draw-area" | "edit-area" | "draw-subordinate-area";

export type MapDetection = {
  id: string;
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number]; // pixel: x1, y1, x2, y2
  center_px: [number, number];            // pixel center
  lon: number;                            // geographic longitude
  lat: number;                            // geographic latitude
  timestamp: number;                      // Date.now()
};

// ─── Backend Types ───

export type UnitLogistics = {
  id: string;
  unit_id: string;

  // Personel
  personnel_total: number;
  personnel_available: number;
  personnel_wounded: number;
  personnel_dead: number;

  // Amunicja
  ammo_small_arms: number;
  ammo_at: number;         // ppanc / OPL ręczna
  ammo_mortar: number;

  // Amunicja pojazdów / pancerna (używana w kategorii "armor")
  ammo_main: number | null;        // naboje główne (czołg / KTO)
  ammo_secondary: number | null;   // ammo pomocnicza pojazdu (karabin maszynowy)

  // Drony
  drones_total: number;
  drones_available: number;

  // Pojazdy opancerzone (sub-typy)
  tanks_total: number;
  tanks_operational: number;
  ifv_total: number;
  ifv_operational: number;
  armored_artillery_total: number;
  armored_artillery_operational: number;

  // Moździerze
  mortars_total: number;
  mortars_operational: number;

  // Paliwo
  fuel_liters: number;

  // Statusy jakościowe (używane jako mnożniki w modelu)
  combat_effectiveness_percent: number | null; // 0–100, ogólna sprawność bojowa

  notes: string | null;
  updated_at: string;
};

export type Unit = {
  id: string;
  symbol_id: string;
  symbol_name: string;
  side: string;
  unit_type: string;
  position_lon?: number;
  position_lat?: number;
  x: number;
  y: number;
  bbox: [number, number, number, number] | null;
  confidence: number | null;
  source: string;
  created_at: string;
  updated_at: string;
  echelon: string;
  unit_number: number | null;
  custom_name: string | null;
  logistics: UnitLogistics | null;
  current_elevation_m: number | null;
  readiness_status: string;
  requires_logistics_completion: boolean;
  base_speed_kmh: number | null;
};

export type CreateUnitPayload = {
  symbol_id: string;
  symbol_name: string;
  side: string;
  unit_type?: string;
  echelon?: string;
  position_lon?: number;
  position_lat?: number;
  x: number;
  y: number;
  source: string;
  unit_number?: number | null;
  custom_name?: string | null;
};

export type UpdateUnitPayload = {
  symbol_id?: string;
  symbol_name?: string;
  side?: string;
  x?: number;
  y?: number;
  position_lon?: number;
  position_lat?: number;
  unit_number?: number | null;
  custom_name?: string | null;
};

export type UpdateUnitLogisticsPayload = Partial<Omit<UnitLogistics, "id" | "unit_id" | "updated_at">>;

export type CreateFromDetectionPayload = {
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number];
  center: [number, number];
  lon: number;
  lat: number;
};
export type UnitAreaPolygonCreate = {
  unit_id: string;
  name?: string;
  area_type?: string;
  coordinates: [number, number][]; // [[lon, lat], ...]
  bearing_deg?: number;
};
