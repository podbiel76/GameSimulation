from sqlalchemy.orm import Session
from . import models, schemas
from .terrain_service import assess_terrain_at

# ── Conditionally import GeoAlchemy2 ────────────────────────────────
try:
    from geoalchemy2.elements import WKTElement
    HAS_GEOALCHEMY2 = True
except ImportError:
    HAS_GEOALCHEMY2 = False


def _set_position_geom(unit, lon: float, lat: float):
    """Set PostGIS geometry on a unit if GeoAlchemy2 is available."""
    if HAS_GEOALCHEMY2 and lon is not None and lat is not None:
        unit.position_geom = WKTElement(f"POINT({lon} {lat})", srid=4326)


# ═══════════════════════════════════════════════════════════════════════
#  Logistics Completion Logic
# ═══════════════════════════════════════════════════════════════════════

REQUIRED_LOGISTICS_FIELDS = [
    "personnel_total",
    "fuel_liters",
]


def check_logistics_completion(logistics: models.UnitLogistics) -> bool:
    """Check if all required logistics fields are filled."""
    for field in REQUIRED_LOGISTICS_FIELDS:
        val = getattr(logistics, field, None)
        if val is None or val <= 0:
            return False
    return True


def compute_combat_effectiveness(logistics: models.UnitLogistics) -> float:
    """Compute combat effectiveness based on logistics state."""
    scores = []

    # Personnel ratio
    if logistics.personnel_total > 0:
        scores.append(min(logistics.personnel_available / logistics.personnel_total, 1.0))
    else:
        scores.append(0)

    # Fuel ratio
    if logistics.fuel_capacity_liters > 0:
        scores.append(min(logistics.fuel_liters / logistics.fuel_capacity_liters, 1.0))
    elif logistics.fuel_liters > 0:
        scores.append(min(logistics.fuel_liters / 500.0, 1.0))  # default capacity
    else:
        scores.append(0)

    # Vehicle readiness — sum of armored sub-types (tanks + IFV + armored artillery)
    vehicles_total = (
        (logistics.tanks_total or 0)
        + (logistics.ifv_total or 0)
        + (logistics.armored_artillery_total or 0)
    )
    vehicles_operational = (
        (logistics.tanks_operational or 0)
        + (logistics.ifv_operational or 0)
        + (logistics.armored_artillery_operational or 0)
    )
    # Brak pojazdów = jednostka nie używa pojazdów → nie wliczamy do średniej
    # (zamiast sztucznego 0.5, które zaniżało/zawyżało CE jednostek pieszych).
    if vehicles_total > 0:
        scores.append(vehicles_operational / vehicles_total)

    if not scores:
        return 0.0
    # Zabezpieczenie przed >100 (błędy zaokrągleń / dane wejściowe poza zakresem),
    # bo schemat odpowiedzi wymaga combat_effectiveness_percent <= 100.
    return round(min(max(sum(scores) / len(scores) * 100, 0.0), 100.0), 1)


def compute_readiness_status(unit: models.Unit) -> str:
    """Compute unit readiness status based on logistics."""
    # Jednostka zniszczona/wyeliminowana pozostaje zniszczona — strat bojowych nie cofamy
    # przy kolejnych aktualizacjach logistyki.
    if unit.readiness_status == "destroyed":
        return "destroyed"
    if not unit.logistics:
        return "incomplete"

    effectiveness = unit.logistics.combat_effectiveness_percent

    if unit.requires_logistics_completion:
        return "incomplete"
    if effectiveness >= 70:
        return "ready"
    if effectiveness >= 40:
        return "incomplete"
    return "critical"


# ═══════════════════════════════════════════════════════════════════════
#  Unit CRUD
# ═══════════════════════════════════════════════════════════════════════

def get_units(db: Session):
    return db.query(models.Unit).all()


def get_unit(db: Session, unit_id: str):
    return db.query(models.Unit).filter(models.Unit.id == unit_id).first()


def validate_unique_unit_number_in_parent_scope(db: Session, unit_id: str | None, parent_unit_id: str | None, echelon: str, unit_number: int | None, side: str | None = None, custom_name: str | None = None):
    if unit_number is None:
        return
    if unit_number <= 0:
        raise ValueError("Numer jednostki musi być dodatnią liczbą całkowitą.")

    if parent_unit_id:
        query = db.query(models.Unit).join(
            models.UnitHierarchy, models.UnitHierarchy.child_unit_id == models.Unit.id
        ).filter(
            models.UnitHierarchy.parent_unit_id == parent_unit_id,
            models.Unit.echelon == echelon,
            models.Unit.unit_number == unit_number
        )
        # Numer jednostki musi być unikalny tylko w obrębie tej samej strony —
        # jednostki przeciwnych stron mogą mieć ten sam numer.
        if side is not None:
            query = query.filter(models.Unit.side == side)
        # Ten sam numer i szczebel są dozwolone, o ile nazwy własne się różnią
        # (np. "1. gt" i "1. rt" to różne jednostki).
        query = query.filter(models.Unit.custom_name == custom_name)
        for sibling in query.all():
            if sibling.id != unit_id:
                raise ValueError("Jednostka o tym numerze, szczeblu i nazwie już istnieje w tej strukturze.")
    else:
        # Check roots
        subquery = db.query(models.UnitHierarchy.child_unit_id)
        query = db.query(models.Unit).filter(
            ~models.Unit.id.in_(subquery),
            models.Unit.echelon == echelon,
            models.Unit.unit_number == unit_number
        )
        if side is not None:
            query = query.filter(models.Unit.side == side)
        query = query.filter(models.Unit.custom_name == custom_name)
        for root in query.all():
            if root.id != unit_id:
                raise ValueError("Jednostka o tym numerze, szczeblu i nazwie już istnieje w tej strukturze.")

def choose_default_speed(symbol_name: str) -> float:
    name_lower = symbol_name.lower()
    if "mechanized" in name_lower and "armored" in name_lower:
        return 50.0
    if "mechanized" in name_lower or "combined" in name_lower or "motorized" in name_lower:
        return 60.0
    if "armored" in name_lower:
        return 40.0
    if "chemical" in name_lower or "artillery" in name_lower or "infantry" in name_lower or "antitank" in name_lower:
        return 10.0
    return 10.0 

def create_unit(db: Session, unit: schemas.UnitCreate):
    validate_unique_unit_number_in_parent_scope(db, None, None, unit.echelon, unit.unit_number, unit.side, unit.custom_name)

    lon = unit.position_lon if unit.position_lon is not None else unit.x
    lat = unit.position_lat if unit.position_lat is not None else unit.y

    db_unit = models.Unit(
        symbol_id=unit.symbol_id,
        symbol_name=unit.symbol_name,
        unit_number=unit.unit_number,
        custom_name=unit.custom_name,
        side=unit.side,
        unit_type=unit.unit_type,
        echelon=unit.echelon,
        call_sign=unit.call_sign,
        x=unit.x,
        y=unit.y,
        position_lon=lon,
        position_lat=lat,
        bbox=unit.bbox,
        confidence=unit.confidence,
        source=unit.source,
        requires_logistics_completion=True,
        readiness_status="incomplete",
        base_speed_kmh=unit.base_speed_kmh or choose_default_speed(unit.symbol_name)
    )
    if db_unit.unit_number or db_unit.custom_name:
        db_unit.symbol_name = build_unit_display_name(
            db_unit.custom_name,
            db_unit.unit_type,
            db_unit.echelon,
            db_unit.unit_number
        )
    _set_position_geom(db_unit, lon, lat)
    db.add(db_unit)
    db.flush()  # flush to get the unit ID

    # Create logistics entry (business rule: every unit MUST have logistics)
    logistics_data = unit.logistics.model_dump() if unit.logistics else {}
    db_logistics = models.UnitLogistics(unit_id=db_unit.id, **logistics_data)
    db.add(db_logistics)

    # Assess terrain at creation position
    try:
        terrain = assess_terrain_at(unit.x, unit.y)
        db_unit.current_elevation_m = terrain["elevation_m"]
    except Exception:
        pass

    db.commit()
    db.refresh(db_unit)
    return db_unit


def build_unit_display_name(custom_name: str | None, unit_type: str, echelon: str, unit_number: int | None):
    if custom_name and custom_name.strip():
        base = custom_name.strip()
    else:
        type_label = unit_type.replace("_", " ").title()
        echelon_label = echelon.replace("_", " ").title()
        base = f"{type_label} — {echelon_label}"

    if unit_number:
        return f"{unit_number}. {base}"
    return base

def update_unit(db: Session, unit_id: str, payload: schemas.UnitUpdate):
    db_unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not db_unit:
        return None

    data = payload.model_dump(exclude_unset=True)

    if "unit_number" in data or "echelon" in data or "custom_name" in data or "side" in data:
        new_number = data.get("unit_number", db_unit.unit_number)
        new_echelon = data.get("echelon", db_unit.echelon)
        parent_link = db.query(models.UnitHierarchy).filter(models.UnitHierarchy.child_unit_id == unit_id).first()
        parent_id = parent_link.parent_unit_id if parent_link else None
        new_side = data.get("side", db_unit.side)
        new_custom_name = data.get("custom_name", db_unit.custom_name)
        validate_unique_unit_number_in_parent_scope(db, unit_id, parent_id, new_echelon, new_number, new_side, new_custom_name)

    for key, value in data.items():
        setattr(db_unit, key, value)

    # Auto-update symbol_name if relevant fields changed
    if any(k in data for k in ["unit_number", "unit_type", "echelon", "custom_name"]):
        db_unit.symbol_name = build_unit_display_name(
            db_unit.custom_name,
            db_unit.unit_type,
            db_unit.echelon,
            db_unit.unit_number
        )
        # Nazwa AO jednostki śledzi nazwę jednostki (np. "AO 1. gt" → "AO 2. rt").
        responsibility_area = db.query(models.UnitArea).filter(
            models.UnitArea.unit_id == unit_id,
            models.UnitArea.area_type == "responsibility",
        ).first()
        if responsibility_area is not None:
            responsibility_area.name = f"AO {db_unit.symbol_name}"

    lon = data.get("position_lon", db_unit.position_lon)
    lat = data.get("position_lat", db_unit.position_lat)

    if lon is not None and lat is not None:
        _set_position_geom(db_unit, lon, lat)

    db.commit()
    db.refresh(db_unit)
    return db_unit


def update_unit_position(db: Session, unit_id: str, pos: schemas.UnitPositionUpdate):
    """Update unit position and re-assess terrain."""
    db_unit = get_unit(db, unit_id)
    if not db_unit:
        return None

    db_unit.x = pos.x
    db_unit.y = pos.y
    db_unit.position_lon = pos.x
    db_unit.position_lat = pos.y
    _set_position_geom(db_unit, pos.x, pos.y)

    # Assess terrain at new position
    try:
        terrain = assess_terrain_at(pos.x, pos.y)
        db_unit.current_elevation_m = terrain["elevation_m"]

        # Create terrain assessment record
        db_assessment = models.TerrainAssessment(
            unit_id=unit_id,
            **terrain,
        )
        db.add(db_assessment)
    except Exception:
        pass

    db.commit()
    db.refresh(db_unit)
    return db_unit


def update_unit_logistics(db: Session, unit_id: str, updates: schemas.UnitLogisticsUpdate):
    db_logistics = db.query(models.UnitLogistics).filter(
        models.UnitLogistics.unit_id == unit_id
    ).first()

    if not db_logistics:
        # If it doesn't exist for some reason, create it
        db_logistics = models.UnitLogistics(unit_id=unit_id)
        db.add(db_logistics)
        db.flush()

    update_data = updates.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_logistics, key, value)

    # Auto-compute combat effectiveness
    db_logistics.combat_effectiveness_percent = compute_combat_effectiveness(db_logistics)

    # Check logistics completion
    is_complete = check_logistics_completion(db_logistics)

    # Update unit flags
    db_unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if db_unit:
        db_unit.requires_logistics_completion = not is_complete
        db_unit.readiness_status = compute_readiness_status(db_unit)

    db.commit()
    db.refresh(db_logistics)
    return db_logistics


def delete_unit(db: Session, unit_id: str):
    """
    Recursively deletes a unit, its subordinates, and all associated data.
    Uses a single commit for efficiency and atomicity.
    """
    db_unit = get_unit(db, unit_id)
    if not db_unit:
        return False

    def _delete_recursive(uid: str):
        u = get_unit(db, uid)
        if not u:
            return

        # Find all children via hierarchy links
        # Important: we must fetch IDs before deleting the parent links to avoid issues
        child_ids = [link.child_unit_id for link in db.query(models.UnitHierarchy).filter(
            models.UnitHierarchy.parent_unit_id == uid
        ).all()]
        
        for cid in child_ids:
            _delete_recursive(cid)

        # The unit's links (parent_links and subordinate_links) 
        # have cascade="all, delete-orphan", so they will be deleted 
        # automatically when the unit is deleted.
        db.delete(u)

    _delete_recursive(unit_id)
    db.commit()
    return True


def create_unit_from_detection(db: Session, payload: schemas.CreateFromDetectionPayload):
    # Percepcja (M7): z nazwy klasy YOLO wyciągamy typ/szczebel/stronę, a siłę DOMNIEMYWAMY
    # (detekcja nie podaje logistyki). Dzięki temu wykryty wróg jest zdolny do walki.
    from .presumed import parse_class_name, presumed_logistics

    unit_type, echelon, side = parse_class_name(payload.class_name)
    if side is None:
        side = "unknown"

    symbol_id = payload.class_name
    symbol_name = f"Detected {payload.class_name.split('_')[-1].capitalize()}"

    db_unit = models.Unit(
        symbol_id=symbol_id,
        symbol_name=symbol_name,
        side=side,
        unit_type=unit_type,
        echelon=echelon,
        x=payload.lon,
        y=payload.lat,
        position_lon=payload.lon,
        position_lat=payload.lat,
        bbox=payload.bbox,
        confidence=payload.confidence,
        source="yolo",
        requires_logistics_completion=False,
        readiness_status="incomplete",
    )
    _set_position_geom(db_unit, db_unit.position_lon, db_unit.position_lat)
    db.add(db_unit)
    db.flush()

    # Domniemana logistyka wg typu/szczebla — wróg z detekcji ma siłę, nie jest "duchem".
    db_logistics = models.UnitLogistics(unit_id=db_unit.id, **presumed_logistics(unit_type, echelon))
    db.add(db_logistics)
    db.flush()
    db_unit.readiness_status = compute_readiness_status(db_unit)

    db.commit()
    db.refresh(db_unit)
    return db_unit


# ═══════════════════════════════════════════════════════════════════════
#  Unit Area CRUD (delegated to services/unit_area_service)
# ═══════════════════════════════════════════════════════════════════════

def get_unit_areas(db: Session, unit_id: str):
    from .services.unit_area_service import get_unit_areas as _get
    return _get(db, unit_id)
