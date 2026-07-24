import math
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import models, schemas
from ..constants import UNIT_CHILDREN, get_area_size_for_echelon
from .unit_area_service import create_square_area
from pyproj import Transformer

try:
    from geoalchemy2.elements import WKTElement
    HAS_GEOALCHEMY2 = True
except ImportError:
    HAS_GEOALCHEMY2 = False

to_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)

class HierarchyCycleError(Exception):
    """Raised when adding a link would create a cycle in the hierarchy."""
    pass


class HierarchySelfLinkError(Exception):
    """Raised when attempting to make a unit subordinate to itself."""
    pass


def add_subordinate(
    db: Session,
    parent_unit_id: str,
    child_unit_id: str,
    relation_type: str = "subordinate",
    order_index: int = 0,
) -> models.UnitHierarchy:
    """
    Create a parent→child hierarchy link.
    Validates that both units exist, prevents self-links, and detects cycles.
    """
    # Prevent self-link
    if parent_unit_id == child_unit_id:
        raise HierarchySelfLinkError("A unit cannot be subordinate to itself")

    # Validate both units exist
    parent = db.query(models.Unit).filter(models.Unit.id == parent_unit_id).first()
    if not parent:
        return None

    child = db.query(models.Unit).filter(models.Unit.id == child_unit_id).first()
    if not child:
        return None

    # Check for existing link
    existing = (
        db.query(models.UnitHierarchy)
        .filter(
            models.UnitHierarchy.parent_unit_id == parent_unit_id,
            models.UnitHierarchy.child_unit_id == child_unit_id,
        )
        .first()
    )
    if existing:
        return existing

    # Detect cycles: if child_unit_id is already an ancestor of parent_unit_id,
    # adding this link would create a cycle.
    if _detect_cycle(db, parent_unit_id, child_unit_id):
        raise HierarchyCycleError(
            f"Adding {child_unit_id} as subordinate of {parent_unit_id} would create a cycle"
        )

    link = models.UnitHierarchy(
        parent_unit_id=parent_unit_id,
        child_unit_id=child_unit_id,
        relation_type=relation_type,
        order_index=order_index,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def remove_subordinate(db: Session, parent_unit_id: str, child_unit_id: str) -> bool:
    """Remove a parent→child hierarchy link. Returns True if deleted."""
    link = (
        db.query(models.UnitHierarchy)
        .filter(
            models.UnitHierarchy.parent_unit_id == parent_unit_id,
            models.UnitHierarchy.child_unit_id == child_unit_id,
        )
        .first()
    )
    if not link:
        return False

    db.delete(link)
    db.commit()
    return True


def get_subordinates(db: Session, unit_id: str) -> List[models.Unit]:
    """Get direct subordinate units of a given unit."""
    links = (
        db.query(models.UnitHierarchy)
        .filter(models.UnitHierarchy.parent_unit_id == unit_id)
        .order_by(models.UnitHierarchy.order_index)
        .all()
    )
    child_ids = [link.child_unit_id for link in links]
    if not child_ids:
        return []

    return db.query(models.Unit).filter(models.Unit.id.in_(child_ids)).all()


def get_all_descendant_ids(db: Session, unit_id: str) -> List[str]:
    """
    Find all descendant unit IDs recursively.
    """
    descendants = []
    visited = set()
    queue = [unit_id]

    while queue:
        current_id = queue.pop(0)
        if current_id in visited:
            continue
        visited.add(current_id)
        
        if current_id != unit_id:
            descendants.append(current_id)

        links = (
            db.query(models.UnitHierarchy)
            .filter(models.UnitHierarchy.parent_unit_id == current_id)
            .all()
        )
        for link in links:
            queue.append(link.child_unit_id)

    return descendants


def get_hierarchy_tree(db: Session, unit_id: str) -> dict:
    """
    Build a recursive hierarchy tree starting from unit_id.
    Returns a nested dict with unit info and subordinates.
    """
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        return {}

    return _build_tree(db, unit, visited=set())


def get_all_hierarchy_links(db: Session) -> List[models.UnitHierarchy]:
    """Get all hierarchy links in the system."""
    return db.query(models.UnitHierarchy).order_by(models.UnitHierarchy.created_at).all()

def build_child_symbol_id(parent_symbol_id: str, child_echelon: str) -> str:
    parts = parent_symbol_id.split("__")

    if len(parts) >= 2:
        base = "__".join(parts[:-1]) + "__"
        return base + child_echelon

    return child_echelon

def generate_subordinates(
    db: Session, parent_unit_id: str, child_count: int = 2
) -> dict:
    """
    Automatically creates subordinate units and responsibility areas.
    Partitions the parent area based on bearing.
    """
    parent = db.query(models.Unit).filter(models.Unit.id == parent_unit_id).first()
    if not parent:
        raise ValueError("Parent unit not found")

    child_echelon = UNIT_CHILDREN.get(parent.echelon)
    if not child_echelon:
        raise ValueError(f"No subordinate echelon defined for {parent.echelon}")

    # Get parent area to determine partitioning
    parent_area = (
        db.query(models.UnitArea)
        .filter(models.UnitArea.unit_id == parent_unit_id)
        .order_by(models.UnitArea.created_at.desc())
        .first()
    )

    # Use a default size if no area exists, or parent size
    parent_size = 5.0
    bearing = 0.0
    if parent_area:
        # Infer size from area_km2 if possible
        if parent_area.area_km2:
            parent_size = math.sqrt(parent_area.area_km2)
        bearing = parent_area.bearing_deg or 0.0

    child_size = get_area_size_for_echelon(child_echelon)
    bearing_rad = math.radians(bearing)

    # Calculate local offsets for children (rotated km)
    # We'll split the parent square into a grid
    offsets = []
    if child_count <= 2:
        side_dist = parent_size / 4.0
        forward_dist = parent_size / 4.0

        offsets = [
            (-side_dist, forward_dist),
            (side_dist, forward_dist),
        ]
    else:
        # Split into 4 quadrants
        dist = parent_size / 4.0
        offsets = [
            (-dist, -dist), (dist, -dist),
            (-dist, dist), (dist, dist)
        ]

    created_units = []
    created_areas = []
    created_links = []

    for i, (p_off, f_off) in enumerate(offsets[:child_count]):
        # Rotate offsets
        # rot_e = p_off * cos(bearing+90) + f_off * cos(bearing)
        # Simplify: rotate (p_off, f_off) as (x, y) where forward is +Y, perpendicular is +X
        # wait, in our coordinate system north is +Y, east is +X.
        # if bearing=0 (North), forward is +Y.
        # if bearing=90 (East), forward is +X.
        
        # Using the same rotation logic as in area service:
        # rot_e = e_km * cos(br) + n_km * sin(br)
        # rot_n = -e_km * sin(br) + n_km * cos(br)
        # Here e_km = p_off, n_km = f_off
        rot_e = p_off * math.cos(bearing_rad) + f_off * math.sin(bearing_rad)
        rot_n = -p_off * math.sin(bearing_rad) + f_off * math.cos(bearing_rad)

        # Convert to lon/lat
        lat_rad = math.radians(parent.position_lat)
        lon = parent.position_lon + rot_e / (111.32 * math.cos(lat_rad))
        lat = parent.position_lat + rot_n / 111.32

        # Create unit
        unit_name = f"{parent.symbol_name} - Sub {i+1}"
        x_3857, y_3857 = to_3857.transform(lon, lat)
        db_unit = models.Unit(
            symbol_id=build_child_symbol_id(parent.symbol_id, child_echelon),
            symbol_name=unit_name,
            side=parent.side,
            unit_type=parent.unit_type,
            echelon=child_echelon,
            x=x_3857,
            y=y_3857,
            position_lon=lon,
            position_lat=lat,
            current_elevation_m=parent.current_elevation_m or 0.0,
            source="generated",
            readiness_status="ready"
        )
        if HAS_GEOALCHEMY2 and hasattr(models.Unit, "position_geom"):
            db_unit.position_geom = WKTElement(f"POINT({lon} {lat})", srid=4326)

        db.add(db_unit)
        db.flush()
        created_units.append(db_unit)

        # Create area
        db_area = create_square_area(
            db,
            unit_id=db_unit.id,
            size_km=child_size,
            name=f"AO {unit_name}",
            bearing_deg=bearing
        )
        created_areas.append(db_area)

        # Create link
        link = add_subordinate(db, parent_unit_id, db_unit.id, order_index=i)
        created_links.append(link)

    db.commit()

    return {
        "parent_unit_id": parent_unit_id,
        "child_echelon": child_echelon,
        "created_units": created_units,
        "created_areas": created_areas,
        "created_links": created_links
    }


def generate_subordinate_tree(
    db: Session,
    parent_unit_id: str,
    child_count_by_echelon: Optional[dict] = None,
    max_depth: int = 10,
) -> dict:
    """
    Recursively generates the full subordinate tree for a unit.
    """
    # Default child counts if not provided
    defaults = {
        "Region_Theater": 2,
        "Army_Group_Front": 2,
        "Army": 2,
        "Corps_MEF": 2,
        "Division": 2,
        "Brigade": 2,
        "Regiment_Group": 2,
        "Battalion_Squadron": 2,
        "Company_Battery_Troop": 2,
        "Platoon_Detachment": 2,
        "Section": 2,
        "Squad": 2,
    }
    counts = {**defaults, **(child_count_by_echelon or {})}

    results = {
        "root_unit_id": parent_unit_id,
        "created_units": [],
        "created_areas": [],
        "created_links": [],
        "levels": []
    }

    def _recurse(current_parent_id: str, current_depth: int):
        if current_depth <= 0:
            return

        parent = db.query(models.Unit).filter(models.Unit.id == current_parent_id).first()
        if not parent:
            return

        child_echelon = UNIT_CHILDREN.get(parent.echelon)
        if not child_echelon:
            return

        child_count = counts.get(parent.echelon, 2)
        
        # Generate one level
        level_res = generate_subordinates(db, current_parent_id, child_count)
        
        # Accumulate results
        results["created_units"].extend(level_res["created_units"])
        results["created_areas"].extend(level_res["created_areas"])
        results["created_links"].extend(level_res["created_links"])
        
        results["levels"].append({
            "parent_unit_id": current_parent_id,
            "parent_echelon": parent.echelon,
            "child_echelon": child_echelon,
            "created_count": len(level_res["created_units"])
        })

        # Recurse for each child
        for child in level_res["created_units"]:
            _recurse(child.id, current_depth - 1)

    _recurse(parent_unit_id, max_depth)
    
    return results


# ── Internal Helpers ────────────────────────────────────────────────


def _detect_cycle(db: Session, parent_unit_id: str, child_unit_id: str) -> bool:
    """
    BFS check: walk upward from parent_unit_id through parent_links.
    If we reach child_unit_id, adding child→parent would create a cycle.
    """
    visited = set()
    queue = [parent_unit_id]

    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)

        # Find all parents of the current unit
        parent_links = (
            db.query(models.UnitHierarchy)
            .filter(models.UnitHierarchy.child_unit_id == current)
            .all()
        )
        for link in parent_links:
            if link.parent_unit_id == child_unit_id:
                return True  # Cycle detected
            queue.append(link.parent_unit_id)

    return False


def _build_tree(db: Session, unit: models.Unit, visited: set) -> dict:
    """Recursively build hierarchy tree, avoiding infinite loops."""
    if unit.id in visited:
        return {"id": unit.id, "symbol_name": unit.symbol_name, "cycle": True}

    visited.add(unit.id)

    subordinate_links = (
        db.query(models.UnitHierarchy)
        .filter(models.UnitHierarchy.parent_unit_id == unit.id)
        .order_by(models.UnitHierarchy.order_index)
        .all()
    )

    children = []
    for link in subordinate_links:
        child_unit = db.query(models.Unit).filter(models.Unit.id == link.child_unit_id).first()
        if child_unit:
            children.append(_build_tree(db, child_unit, visited.copy()))

    return {
        "id": unit.id,
        "symbol_id": unit.symbol_id,
        "symbol_name": unit.symbol_name,
        "side": unit.side,
        "unit_type": unit.unit_type,
        "echelon": unit.echelon,
        "call_sign": unit.call_sign,
        "readiness_status": unit.readiness_status,
        "position_lon": unit.position_lon,
        "position_lat": unit.position_lat,
        "subordinates": children,
    }
