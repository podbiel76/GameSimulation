import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Integer, Boolean, ForeignKey, DateTime, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base

# ── Conditionally import GeoAlchemy2 ────────────────────────────────
# Falls back gracefully if PostGIS is not available (e.g. SQLite dev mode)
try:
    from geoalchemy2 import Geometry as GeoGeometry
    HAS_GEOALCHEMY2 = True
except ImportError:
    HAS_GEOALCHEMY2 = False
    GeoGeometry = None


def generate_uuid():
    return str(uuid.uuid4())


def utc_now():
    return datetime.now(timezone.utc)


# ─── Unit ────────────────────────────────────────────────────────────

class Unit(Base):
    __tablename__ = "units"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    symbol_id = Column(String, index=True, nullable=False)
    symbol_name = Column(String, nullable=False)
    side = Column(String, default="unknown", nullable=False)  # friendly, hostile, neutral, unknown
    unit_type = Column(String, default="infantry", nullable=False)  # infantry, armor, artillery, etc.
    echelon = Column(String, default="team", nullable=False)  # team, squad, platoon, company, battalion, etc.
    unit_number = Column(Integer, nullable=True)
    custom_name = Column(String, nullable=True)
    call_sign = Column(String, nullable=True)
    readiness_status = Column(String, default="incomplete", nullable=False)  # ready, incomplete, critical
    requires_logistics_completion = Column(Boolean, default=True, nullable=False)

    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    # PostGIS-ready: store lon/lat separately for geometry creation
    position_lon = Column(Float, nullable=True)
    position_lat = Column(Float, nullable=True)
    current_elevation_m = Column(Float, nullable=True, default=0.0)
    base_speed_kmh = Column(Float, nullable=True)  # unit's own base movement speed in km/h

    # PostGIS geometry column — only created when GeoAlchemy2 is available
    if HAS_GEOALCHEMY2:
        position_geom = Column(GeoGeometry("POINT", srid=4326), nullable=True)

    bbox = Column(JSON, nullable=True)  # [x1, y1, x2, y2]
    confidence = Column(Float, nullable=True)
    source = Column(String, default="manual", nullable=False)  # manual or yolo
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    logistics = relationship("UnitLogistics", back_populates="unit", uselist=False, cascade="all, delete-orphan")
    routes = relationship("Route", back_populates="unit", cascade="all, delete-orphan")
    tracks = relationship("UnitTrack", back_populates="unit", cascade="all, delete-orphan")
    areas = relationship("UnitArea", back_populates="unit", cascade="all, delete-orphan")
    terrain_assessments = relationship("TerrainAssessment", back_populates="unit", cascade="all, delete-orphan")

    # Hierarchy relationships
    subordinate_links = relationship(
        "UnitHierarchy",
        foreign_keys="UnitHierarchy.parent_unit_id",
        back_populates="parent_unit",
        cascade="all, delete-orphan",
    )
    parent_links = relationship(
        "UnitHierarchy",
        foreign_keys="UnitHierarchy.child_unit_id",
        back_populates="child_unit",
        cascade="all, delete-orphan",
    )


# ─── Unit Logistics ──────────────────────────────────────────────────

class UnitLogistics(Base):
    __tablename__ = "unit_logistics"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    unit_id = Column(String, ForeignKey("units.id", ondelete="CASCADE"), unique=True, index=True)

    personnel_total = Column(Integer, default=0)
    personnel_available = Column(Integer, default=0)
    personnel_wounded = Column(Integer, default=0)
    personnel_dead = Column(Integer, default=0)       # KIA (zamiast missing)

    ammo_small_arms = Column(Integer, default=0)
    ammo_at = Column(Integer, default=0)
    ammo_main = Column(Integer, default=0)
    ammo_secondary = Column(Integer, default=0)
    ammo_mortar = Column(Integer, default=0)

    drones_total = Column(Integer, default=0)
    drones_available = Column(Integer, default=0)

    # Sub-typy pojazdów opancerzonych
    tanks_total = Column(Integer, default=0)
    tanks_operational = Column(Integer, default=0)
    ifv_total = Column(Integer, default=0)            # BWP / APC
    ifv_operational = Column(Integer, default=0)
    armored_artillery_total = Column(Integer, default=0)
    armored_artillery_operational = Column(Integer, default=0)

    # Moździerze
    mortars_total = Column(Integer, default=0)
    mortars_operational = Column(Integer, default=0)

    fuel_liters = Column(Float, default=0.0)
    fuel_capacity_liters = Column(Float, default=0.0)

    supply_priority = Column(String, default="normal", nullable=False)  # low, normal, high, critical
    evacuation_required = Column(Boolean, default=False, nullable=False)
    combat_effectiveness_percent = Column(Float, default=100.0)  # 0–100; 100 = pełna sprawność

    notes = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    unit = relationship("Unit", back_populates="logistics")


# ─── Route ───────────────────────────────────────────────────────────

class Route(Base):
    __tablename__ = "routes"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    unit_id = Column(String, ForeignKey("units.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String, default="Unnamed Route", nullable=False)
    status = Column(String, default="draft", nullable=False)  # draft, active, completed, cancelled
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    unit = relationship("Unit", back_populates="routes")
    points = relationship("RoutePoint", back_populates="route", cascade="all, delete-orphan",
                          order_by="RoutePoint.order_index")


# ─── RoutePoint ──────────────────────────────────────────────────────

class RoutePoint(Base):
    __tablename__ = "route_points"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    route_id = Column(String, ForeignKey("routes.id", ondelete="CASCADE"), index=True, nullable=False)
    order_index = Column(Integer, nullable=False)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    planned_arrival_time = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    route = relationship("Route", back_populates="points")


# ─── UnitTrack ───────────────────────────────────────────────────────

class UnitTrack(Base):
    __tablename__ = "unit_tracks"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    unit_id = Column(String, ForeignKey("units.id", ondelete="CASCADE"), index=True, nullable=False)
    status = Column(String, default="active", nullable=False)  # active, completed, lost
    confidence = Column(Float, nullable=True)
    started_at = Column(DateTime(timezone=True), default=utc_now)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    unit = relationship("Unit", back_populates="tracks")
    states = relationship("UnitState", back_populates="track", cascade="all, delete-orphan",
                          order_by="UnitState.timestamp")


# ─── UnitState ───────────────────────────────────────────────────────

class UnitState(Base):
    __tablename__ = "unit_states"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    track_id = Column(String, ForeignKey("unit_tracks.id", ondelete="CASCADE"), index=True, nullable=False)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    heading = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    source = Column(String, default="manual", nullable=False)  # manual, simulation, yolo
    timestamp = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    # Extended terrain fields
    elevation_m = Column(Float, nullable=True)
    slope_deg = Column(Float, nullable=True)
    terrain_type = Column(String, nullable=True)  # urban, forest, open, water, mountain
    cover_score = Column(Float, nullable=True)  # 0-1
    defense_score = Column(Float, nullable=True)  # 0-1

    track = relationship("UnitTrack", back_populates="states")


# ─── UnitArea ────────────────────────────────────────────────────────

class UnitArea(Base):
    __tablename__ = "unit_areas"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    unit_id = Column(String, ForeignKey("units.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String, nullable=True)
    area_type = Column(String, default="responsibility", nullable=False)  # responsibility, defense, observation, danger

    # Rotated square properties
    bearing_deg = Column(Float, nullable=True, default=0.0)
    coordinates = Column(JSON, nullable=True) # Actual polygon points [[lon, lat], ...]

    # PostGIS geometry — polygon stored with SRID 4326
    if HAS_GEOALCHEMY2:
        geometry = Column(GeoGeometry("POLYGON", srid=4326), nullable=True)

    # Bounding box as JSON [min_lon, min_lat, max_lon, max_lat]
    bbox = Column(JSON, nullable=True)
    # Approximate area in square kilometers
    area_km2 = Column(Float, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    unit = relationship("Unit", back_populates="areas")


# ─── UnitHierarchy ───────────────────────────────────────────────────

class UnitHierarchy(Base):
    __tablename__ = "unit_hierarchy"
    __table_args__ = (
        UniqueConstraint("parent_unit_id", "child_unit_id", name="uq_parent_child"),
    )

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    parent_unit_id = Column(String, ForeignKey("units.id", ondelete="CASCADE"), index=True, nullable=False)
    child_unit_id = Column(String, ForeignKey("units.id", ondelete="CASCADE"), index=True, nullable=False)
    relation_type = Column(String, default="subordinate", nullable=False)
    order_index = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    parent_unit = relationship("Unit", foreign_keys=[parent_unit_id], back_populates="subordinate_links")
    child_unit = relationship("Unit", foreign_keys=[child_unit_id], back_populates="parent_links")


# ─── TerrainAssessment ───────────────────────────────────────────────

class TerrainAssessment(Base):
    __tablename__ = "terrain_assessments"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    unit_id = Column(String, ForeignKey("units.id", ondelete="CASCADE"), index=True, nullable=False)
    elevation_m = Column(Float, nullable=False, default=0.0)
    slope_deg = Column(Float, nullable=False, default=0.0)
    terrain_type = Column(String, nullable=False, default="open")
    cover_score = Column(Float, nullable=False, default=0.0)
    defense_score = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    unit = relationship("Unit", back_populates="terrain_assessments")


# ─── TerrainPolygon ──────────────────────────────────────────────────

class TerrainPolygon(Base):
    __tablename__ = "terrain_polygons"

    id = Column(String, primary_key=True, default=generate_uuid)
    terrain_type = Column(String, nullable=False, index=True)
    source = Column(String, nullable=True)  # "bdot10k"
    source_class = Column(String, nullable=True)
    name = Column(String, nullable=True)

    if HAS_GEOALCHEMY2:
        geometry = Column(GeoGeometry("POLYGON", srid=4326), nullable=False, index=True)


# ─── ScenarioRule ────────────────────────────────────────────────────

class ScenarioRule(Base):
    __tablename__ = "scenario_rules"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    rule_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    rule_type = Column(String, nullable=False)  # low_fuel, low_personnel, route_too_long, etc.
    severity = Column(String, default="warning", nullable=False)  # info, warning, critical
    params = Column(JSON, default=dict, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


# ─── Assessment ──────────────────────────────────────────────────────

class Assessment(Base):
    __tablename__ = "assessments"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    rule_id = Column(String, index=True, nullable=False)
    subject_type = Column(String, nullable=False)  # unit, track, route
    subject_id = Column(String, index=True, nullable=False)
    severity = Column(String, nullable=False)  # info, warning, critical
    status = Column(String, nullable=False)  # ok, warning, critical, uncertain
    confidence = Column(Float, nullable=True)
    explanation = Column(String, nullable=True)
    data = Column(JSON, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)
