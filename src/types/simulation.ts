// ─── Simulation Types ───────────────────────────────────────────────

export type SimUnitLogistics = {
  id: string;
  unit_id: string;
  personnel_total: number;
  personnel_available: number;
  personnel_wounded: number;
  personnel_missing: number;
  ammo_small_arms: number;
  ammo_at: number;
  ammo_artillery: number;
  grenades: number;
  drones_total: number;
  drones_available: number;
  vehicles_total: number;
  vehicles_operational: number;
  fuel_liters: number;
  notes: string | null;
  updated_at: string;
};

export type SimUnit = {
  readiness_status: any;
  current_elevation_m: any;
  position_lat: any;
  position_lon: any;
  id: string;
  symbol_id: string;
  symbol_name: string;
  side: string;
  x: number;
  y: number;
  bbox: number[] | null;
  confidence: number | null;
  source: string;
  created_at: string;
  updated_at: string;
  echelon: string;
  unit_type: string;
  unit_number: number | null;
  custom_name: string | null;
  logistics: SimUnitLogistics | null;
  base_speed_kmh: number | null;
  requires_logistics_completion: boolean;
};

export type SimRoutePoint = {
  id: string;
  route_id: string;
  order_index: number;
  x: number;
  y: number;
  planned_arrival_time: string | null;
  created_at: string;
};

export type SimRoute = {
  id: string;
  unit_id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  points: SimRoutePoint[];
};

export type SimUnitState = {
  id: string;
  track_id: string;
  x: number;
  y: number;
  heading: number | null;
  speed: number | null;
  source: string;
  timestamp: string;
  created_at: string;
};

export type SimUnitTrack = {
  id: string;
  unit_id: string;
  status: string;
  confidence: number | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  states: SimUnitState[];
};

export type SimAssessment = {
  id: string;
  rule_id: string;
  subject_type: string;
  subject_id: string;
  severity: string;
  status: string;
  confidence: number | null;
  explanation: string | null;
  data: Record<string, unknown> | null;
  timestamp: string;
  created_at: string;
};

export type SimScenarioRule = {
  id: string;
  rule_id: string;
  name: string;
  rule_type: string;
  severity: string;
  params: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type HierarchyLink = {
  id: string;
  parent_unit_id: string;
  child_unit_id: string;
  relation_type: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export type FullState = {
  units: SimUnit[];
  routes: SimRoute[];
  tracks: SimUnitTrack[];
  assessments: SimAssessment[];
  rules: SimScenarioRule[];
  hierarchy: HierarchyLink[];
};
