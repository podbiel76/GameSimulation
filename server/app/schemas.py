from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


# ═══════════════════════════════════════════════════════════════════════
#  Unit Logistics
# ═══════════════════════════════════════════════════════════════════════

class UnitLogisticsBase(BaseModel):
    personnel_total: int = Field(0, ge=0)
    personnel_available: int = Field(0, ge=0)
    personnel_wounded: int = Field(0, ge=0)
    personnel_dead: int = Field(0, ge=0)

    ammo_small_arms: int = Field(0, ge=0)
    ammo_at: int = Field(0, ge=0)
    ammo_main: int = Field(0, ge=0)
    ammo_secondary: int = Field(0, ge=0)
    ammo_mortar: int = Field(0, ge=0)

    drones_total: int = Field(0, ge=0)
    drones_available: int = Field(0, ge=0)

    tanks_total: int = Field(0, ge=0)
    tanks_operational: int = Field(0, ge=0)
    ifv_total: int = Field(0, ge=0)
    ifv_operational: int = Field(0, ge=0)
    armored_artillery_total: int = Field(0, ge=0)
    armored_artillery_operational: int = Field(0, ge=0)

    mortars_total: int = Field(0, ge=0)
    mortars_operational: int = Field(0, ge=0)

    fuel_liters: float = Field(0.0, ge=0.0)
    fuel_capacity_liters: float = Field(0.0, ge=0.0)

    supply_priority: str = "normal"  # low, normal, high, critical
    evacuation_required: bool = False
    combat_effectiveness_percent: float = Field(100.0, ge=0.0, le=100.0)

    notes: Optional[str] = None


class UnitLogisticsUpdate(BaseModel):
    """All fields optional for PATCH updates."""
    personnel_total: Optional[int] = None
    personnel_available: Optional[int] = None
    personnel_wounded: Optional[int] = None
    personnel_dead: Optional[int] = None

    ammo_small_arms: Optional[int] = None
    ammo_at: Optional[int] = None
    ammo_main: Optional[int] = None
    ammo_secondary: Optional[int] = None
    ammo_mortar: Optional[int] = None

    drones_total: Optional[int] = None
    drones_available: Optional[int] = None

    tanks_total: Optional[int] = None
    tanks_operational: Optional[int] = None
    ifv_total: Optional[int] = None
    ifv_operational: Optional[int] = None
    armored_artillery_total: Optional[int] = None
    armored_artillery_operational: Optional[int] = None

    mortars_total: Optional[int] = None
    mortars_operational: Optional[int] = None

    fuel_liters: Optional[float] = None
    fuel_capacity_liters: Optional[float] = None

    supply_priority: Optional[str] = None
    evacuation_required: Optional[bool] = None
    combat_effectiveness_percent: Optional[float] = None

    notes: Optional[str] = None


class UnitLogistics(UnitLogisticsBase):
    id: str
    unit_id: str
    updated_at: datetime

    class Config:
        from_attributes = True


# ═══════════════════════════════════════════════════════════════════════
#  Unit
# ═══════════════════════════════════════════════════════════════════════

class UnitBase(BaseModel):
    symbol_id: str
    symbol_name: str
    side: str = "unknown"
    unit_type: str = "infantry"
    echelon: str = "team"
    call_sign: Optional[str] = None
    x: float
    y: float
    position_lon: Optional[float] = None
    position_lat: Optional[float] = None
    bbox: Optional[List[float]] = None
    confidence: Optional[float] = None
    source: str = "manual"
    unit_number: Optional[int] = Field(None, gt=0)
    custom_name: Optional[str] = None
    base_speed_kmh: Optional[float] = None


class UnitCreate(UnitBase):
    logistics: Optional[UnitLogisticsBase] = None


class UnitUpdate(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None
    position_lon: Optional[float] = None
    position_lat: Optional[float] = None
    current_elevation_m: Optional[float] = None
    symbol_id: Optional[str] = None
    symbol_name: Optional[str] = None
    side: Optional[str] = None
    unit_type: Optional[str] = None
    echelon: Optional[str] = None
    readiness_status: Optional[str] = None
    unit_number: Optional[int] = Field(None, gt=0)
    custom_name: Optional[str] = None
    base_speed_kmh: Optional[float] = None


class UnitPositionUpdate(BaseModel):
    x: float
    y: float


class Unit(UnitBase):
    id: str
    unit_number: Optional[int] = None
    custom_name: Optional[str] = None
    readiness_status: str = "incomplete"
    requires_logistics_completion: bool = True
    position_lon: Optional[float] = None
    position_lat: Optional[float] = None
    current_elevation_m: Optional[float] = None
    created_at: datetime
    updated_at: datetime
    logistics: Optional[UnitLogistics] = None

    class Config:
        from_attributes = True


# ═══════════════════════════════════════════════════════════════════════
#  YOLO Detection
# ═══════════════════════════════════════════════════════════════════════

class CreateFromDetectionPayload(BaseModel):
    class_id: int
    class_name: str
    confidence: float
    bbox: List[float]
    center: List[float]  # [lon, lat] from frontend, or pixel coords
    lon: float
    lat: float


# ═══════════════════════════════════════════════════════════════════════
#  Route
# ═══════════════════════════════════════════════════════════════════════

class RoutePointCreate(BaseModel):
    order_index: int = Field(..., ge=0)
    x: float
    y: float
    planned_arrival_time: Optional[datetime] = None


class RoutePointRead(BaseModel):
    id: str
    route_id: str
    order_index: int
    x: float
    y: float
    planned_arrival_time: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class RouteCreate(BaseModel):
    name: str = "Unnamed Route"
    status: str = "draft"


class RouteRead(BaseModel):
    id: str
    unit_id: str
    name: str
    status: str
    created_at: datetime
    updated_at: datetime
    points: List[RoutePointRead] = []

    class Config:
        from_attributes = True


# ═══════════════════════════════════════════════════════════════════════
#  UnitTrack
# ═══════════════════════════════════════════════════════════════════════

class UnitStateCreate(BaseModel):
    x: float
    y: float
    heading: Optional[float] = None
    speed: Optional[float] = None
    source: str = "manual"
    timestamp: Optional[datetime] = None


class UnitStateRead(BaseModel):
    id: str
    track_id: str
    x: float
    y: float
    heading: Optional[float] = None
    speed: Optional[float] = None
    source: str
    timestamp: datetime
    created_at: datetime
    elevation_m: Optional[float] = None
    slope_deg: Optional[float] = None
    terrain_type: Optional[str] = None
    cover_score: Optional[float] = None
    defense_score: Optional[float] = None

    class Config:
        from_attributes = True


class UnitTrackCreate(BaseModel):
    status: str = "active"
    confidence: Optional[float] = None


class UnitTrackRead(BaseModel):
    id: str
    unit_id: str
    status: str
    confidence: Optional[float] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    created_at: datetime
    states: List[UnitStateRead] = []

    class Config:
        from_attributes = True


# ═══════════════════════════════════════════════════════════════════════
#  ScenarioRule
# ═══════════════════════════════════════════════════════════════════════

class ScenarioRuleCreate(BaseModel):
    rule_id: str
    name: str
    rule_type: str
    severity: str = "warning"
    params: dict = {}
    enabled: bool = True


class ScenarioRuleRead(BaseModel):
    id: str
    rule_id: str
    name: str
    rule_type: str
    severity: str
    params: dict
    enabled: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ═══════════════════════════════════════════════════════════════════════
#  Assessment
# ═══════════════════════════════════════════════════════════════════════

class AssessmentRead(BaseModel):
    id: str
    rule_id: str
    subject_type: str
    subject_id: str
    severity: str
    status: str
    confidence: Optional[float] = None
    explanation: Optional[str] = None
    data: Optional[dict] = None
    timestamp: datetime
    created_at: datetime

    class Config:
        from_attributes = True


# ═══════════════════════════════════════════════════════════════════════
#  UnitArea (PostGIS)
# ═══════════════════════════════════════════════════════════════════════

class UnitAreaSquareCreate(BaseModel):
    size_km: float = Field(..., gt=0, le=500, description="Side length in km")
    name: Optional[str] = Field(None, description="Area name, e.g. 'AO Alpha'")
    bearing_deg: float = Field(0.0, description="Direction of action in degrees (0-360, 0=North)")
class UnitAreaPolygonCreate(BaseModel):
    unit_id: str
    name: Optional[str] = Field(None, description="Area name, e.g. 'AO Alpha'")
    area_type: str = Field("responsibility", description="Type of area")
    coordinates: List[List[float]] = Field(..., description="[[lon, lat], ...] polygon coordinates")
    bearing_deg: Optional[float] = Field(0.0, description="Optional bearing")
    
class ChildWithAreaCreate(BaseModel):
    coordinates: List[List[float]] = Field(..., description="[[lon, lat], ...] polygon coordinates")
    unit_number: Optional[int] = Field(None, gt=0)
    custom_name: Optional[str] = None

class UnitAreaPolygonUpdate(BaseModel):
    name: Optional[str] = Field(None, description="Area name, e.g. 'AO Alpha'")
    area_type: Optional[str] = Field(None, description="Type of area")
    coordinates: List[List[float]] = Field(..., description="[[lon, lat], ...] polygon coordinates")
    bearing_deg: Optional[float] = Field(0.0, description="Optional bearing")
    recenter_unit: Optional[bool] = Field(True, description="Move unit to centroid")
    skip_validation: Optional[bool] = Field(False, description="Skip parent/child topological validation")




class UnitAreaRead(BaseModel):
    id: str
    unit_id: str
    name: Optional[str] = None
    area_type: str
    unit_echelon: Optional[str] = None
    parent_unit_id: Optional[str] = None
    bearing_deg: Optional[float] = 0.0
    bbox: Optional[List[float]] = None  # [min_lon, min_lat, max_lon, max_lat]
    area_km2: Optional[float] = None
    coordinates: Optional[List[List[float]]] = None  # [[lon,lat], ...] extracted from geometry
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ═══════════════════════════════════════════════════════════════════════
#  UnitHierarchy
# ═══════════════════════════════════════════════════════════════════════

class UnitHierarchyCreate(BaseModel):
    relation_type: str = "subordinate"
    order_index: int = Field(0, ge=0)


class UnitHierarchyRead(BaseModel):
    id: str
    parent_unit_id: str
    child_unit_id: str
    relation_type: str
    order_index: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FullHierarchyRead(BaseModel):
    units: List[Unit]
    links: List[UnitHierarchyRead]
    areas: List[UnitAreaRead]


class ChildGenerationResponse(BaseModel):
    parent_unit_id: str
    child_echelon: str
    created_units: List[Unit]
    created_areas: List[UnitAreaRead]
    created_links: List[UnitHierarchyRead]


class ChildGenerationTreeRequest(BaseModel):
    max_depth: int = Field(10, ge=1)
    child_count_by_echelon: Optional[dict] = None


class GenerationLevelInfo(BaseModel):
    parent_unit_id: str
    parent_echelon: str
    child_echelon: str
    created_count: int


class ChildGenerationTreeResponse(BaseModel):
    root_unit_id: str
    created_units: List[Unit]
    created_areas: List[UnitAreaRead]
    created_links: List[UnitHierarchyRead]
    levels: List[GenerationLevelInfo]


# ═══════════════════════════════════════════════════════════════════════
#  TerrainAssessment
# ═══════════════════════════════════════════════════════════════════════

class TerrainAssessmentRead(BaseModel):
    id: str
    unit_id: str
    elevation_m: float
    slope_deg: float
    terrain_type: str
    cover_score: float
    defense_score: float
    created_at: datetime

    class Config:
        from_attributes = True
