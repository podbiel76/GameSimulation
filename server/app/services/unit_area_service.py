"""
Unit area service — creates PostGIS-backed responsibility areas.
Generates square polygons around unit positions using geodesic calculations.
"""
import math
from sqlalchemy.orm import Session
from fastapi import HTTPException
from shapely.geometry import Polygon, Point
from shapely.validation import explain_validity
from .. import models
from pyproj import Transformer, Geod

# ── Conditionally import GeoAlchemy2 ────────────────────────────────
try:
    from geoalchemy2.elements import WKTElement
    HAS_GEOALCHEMY2 = True
except ImportError:
    HAS_GEOALCHEMY2 = False

_to_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
_to_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)

geod = Geod(ellps="WGS84")


def calculate_polygon_area_km2(coords: list[list[float]]) -> float | None:
    """
    Calculate polygon area in km² from lon/lat coordinates using WGS84 geodesic area.
    coords format: [[lon, lat], [lon, lat], ...]
    """
    if not coords or len(coords) < 3:
        return None

    polygon_coords = coords[:]

    if polygon_coords[0] != polygon_coords[-1]:
        polygon_coords.append(polygon_coords[0])

    try:
        polygon = Polygon(polygon_coords)

        if polygon.is_empty or not polygon.is_valid:
            return None

        area_m2, _ = geod.geometry_area_perimeter(polygon)

        return round(abs(area_m2) / 1_000_000, 4)

    except Exception:
        return None

def create_square_area(
    db: Session,
    unit_id: str,
    size_km: float,
    name: str = None,
    area_type: str = "responsibility",
    bearing_deg: float = 0.0,
) -> models.UnitArea:
    """
    Create a square responsibility area centered on a unit's geographic position,
    rotated by bearing_deg.
    """
    if size_km <= 0:
        return None

    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        return None

    lon = unit.position_lon
    lat = unit.position_lat

    if lon is None or lat is None:
        lon = unit.x
        lat = unit.y

    # Convert to 4326 if needed
    if abs(lon) > 180 or abs(lat) > 90:
        lon, lat = _to_4326.transform(lon, lat)

    # Normalizacja bearingu
    bearing_deg = bearing_deg % 360
    bearing_rad = math.radians(bearing_deg)

    half_km = size_km / 2.0
    lat_rad = math.radians(lat)

    # Local square corners (east_km, north_km) relative to center before rotation
    # North is +Y, East is +X
    local_corners = [
        (-half_km, -half_km), # Bottom-left
        (half_km, -half_km),  # Bottom-right
        (half_km, half_km),   # Top-right
        (-half_km, half_km),  # Top-left
    ]

    rotated_coords = []
    lons = []
    lats = []

    for e_km, n_km in local_corners:
        # Rotate points:
        # rot_east = east_km * cos(bearing_rad) + north_km * sin(bearing_rad)
        # rot_north = -east_km * sin(bearing_rad) + north_km * cos(bearing_rad)
        rot_e = e_km * math.cos(bearing_rad) + n_km * math.sin(bearing_rad)
        rot_n = -e_km * math.sin(bearing_rad) + n_km * math.cos(bearing_rad)

        # Convert local km offsets to lon/lat offsets
        p_lon = lon + rot_e / (111.32 * math.cos(lat_rad))
        p_lat = lat + rot_n / 111.32

        rotated_coords.append([p_lon, p_lat])
        lons.append(p_lon)
        lats.append(p_lat)

    # Close the ring for WKT and coordinates list
    rotated_coords.append(rotated_coords[0])

    # WKT for PostGIS
    wkt_points = ", ".join([f"{c[0]} {c[1]}" for c in rotated_coords])
    wkt = f"POLYGON(({wkt_points}))"

    bbox = [min(lons), min(lats), max(lons), max(lats)]
    area_km2 = round(size_km * size_km, 2)

    db_area = models.UnitArea(
        unit_id=unit_id,
        name=name,
        area_type=area_type,
        bearing_deg=bearing_deg,
        coordinates=rotated_coords,
        bbox=bbox,
        area_km2=area_km2,
    )

    # Set PostGIS geometry if available
    if HAS_GEOALCHEMY2:
        db_area.geometry = WKTElement(wkt, srid=4326)

    db.add(db_area)
    db.commit()
    db.refresh(db_area)
    return db_area
 
def validate_area_inside_parent_ao(db: Session, unit_id: str, child_coords: list):
    """
    Validates that the new AO is completely inside the parent's AO.
    """
    print("2. Tutaj wchodzimy, kiedy robimy zmiane w AO, ale nie zmieniamy hierarchi")
    link = db.query(models.UnitHierarchy).filter(models.UnitHierarchy.child_unit_id == unit_id).first()
    if not link:
        return # No parent, no boundary
        
    parent_id = link.parent_unit_id
    
    # 2. Get parent responsibility area
    parent_area = db.query(models.UnitArea).filter(
        models.UnitArea.unit_id == parent_id,
        models.UnitArea.area_type == "responsibility"
    ).order_by(models.UnitArea.created_at.desc()).first()
    
    if not parent_area or not parent_area.coordinates:
        raise HTTPException(
            status_code=400,
            detail="Nie można zapisać AO: jednostka nadrzędna nie ma obszaru odpowiedzialności."
        )
        
    # 3. Validation
    def _to_poly(coords):
        cleaned = [[float(p[0]), float(p[1])] for p in coords]
        if cleaned[0] != cleaned[-1]:
            cleaned.append(cleaned[0])
        p = Polygon(cleaned)
        if not p.is_valid:
            raise HTTPException(status_code=400, detail=f"Invalid polygon geometry: {explain_validity(p)}")
        return p
        
    child_poly = _to_poly(child_coords)
    parent_poly = _to_poly(parent_area.coordinates)
    
    if not parent_poly.covers(child_poly):
        raise HTTPException(
            status_code=400,
            detail="Nie można zapisać AO: obszar podległej jednostki musi znajdować się wewnątrz AO jednostki nadrzędnej."
        )
 
def create_polygon_area(
    db: Session,
    payload: any  # schemas.UnitAreaPolygonCreate
) -> models.UnitArea:
    """
    Create a custom polygon responsibility area.
    """
    unit_id = payload.unit_id
    coords = payload.coordinates
    
    if not coords or len(coords) < 3:
        return None
 
    # Parent boundary validation
    if (payload.area_type or "responsibility") == "responsibility":
        validate_area_inside_parent_ao(db, unit_id, coords)
        
    # Ensure closed ring for WKT
    if coords[0] != coords[-1]:
        coords.append(coords[0])
        
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    bbox = [min(lons), min(lats), max(lons), max(lats)]
    
    db_area = models.UnitArea(
        unit_id=unit_id,
        name=payload.name,
        area_type=payload.area_type or "responsibility",
        bearing_deg=payload.bearing_deg or 0.0,
        coordinates=coords,
        bbox=bbox,
        area_km2=calculate_polygon_area_km2(coords),
    )
    
    if HAS_GEOALCHEMY2:
        wkt_points = ", ".join([f"{c[0]} {c[1]}" for c in coords])
        wkt = f"POLYGON(({wkt_points}))"
        db_area.geometry = WKTElement(wkt, srid=4326)
        
    db.add(db_area)
    db.commit()
    db.refresh(db_area)

    # Auto-move unit to centroid if it's a responsibility area
    if db_area.area_type == "responsibility":
        _move_unit_to_area_centroid(db, unit_id, coords)

    return db_area




def get_unit_areas(db: Session, unit_id: str):
    """Get all areas for a unit."""
    return (
        db.query(models.UnitArea)
        .filter(models.UnitArea.unit_id == unit_id)
        .order_by(models.UnitArea.created_at)
        .all()
    )


def get_all_areas(db: Session):
    """Get all areas across all units."""
    return db.query(models.UnitArea).order_by(models.UnitArea.created_at).all()



def validate_descendants_inside_polygon(db: Session, parent_unit_id: str, new_coords: list):
    """
    Validates that all descendant units and their responsibility areas are 
    covered by the new parent AO.
    """
    print("1. Tutaj wchodzimy, kiedy robimy zmiane w AO")
    # 1. Close ring and create polygon
    cleaned_coords = [[float(p[0]), float(p[1])] for p in new_coords]
    if cleaned_coords[0] != cleaned_coords[-1]:
        cleaned_coords.append(cleaned_coords[0])
        
    parent_poly = Polygon(cleaned_coords)
    if not parent_poly.is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid polygon geometry: {explain_validity(parent_poly)}")
        
    # 2. Get descendants
    from .hierarchy_service import get_all_descendant_ids
    descendant_ids = get_all_descendant_ids(db, parent_unit_id)
    if not descendant_ids:
        return
        
    offending_units = []
    offending_areas = []
    
    # 3. Check units
    units = db.query(models.Unit).filter(models.Unit.id.in_(descendant_ids)).all()
    for unit in units:
        lon = unit.position_lon
        lat = unit.position_lat
        if lon is None or lat is None:
            lon, lat = to_lonlat(unit.x, unit.y)
            
        if not parent_poly.covers(Point(lon, lat)):
            offending_units.append({
                "id": unit.id,
                "name": unit.symbol_name
            })
            
    # 4. Check descendant areas
    areas = db.query(models.UnitArea).filter(
        models.UnitArea.unit_id.in_(descendant_ids),
        models.UnitArea.area_type == "responsibility"
    ).all()
    
    for area in areas:
        if not area.coordinates:
            continue
            
        child_coords = [[float(p[0]), float(p[1])] for p in area.coordinates]
        if child_coords[0] != child_coords[-1]:
            child_coords.append(child_coords[0])
            
        child_poly = Polygon(child_coords)
        if not child_poly.is_valid:
            # We don't block parent edit because child is invalid, 
            # but we should probably log it or ignore? 
            # User wants to check covers.
            continue
            
        if not parent_poly.covers(child_poly):
            offending_areas.append({
                "id": area.id,
                "unit_id": area.unit_id,
                "name": area.name or f"AO {area.unit_id[:8]}"
            })
            
    if offending_units or offending_areas:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Nie można zapisać AO: jednostki podległe lub ich obszary odpowiedzialności znajdują się poza nowym obszarem.",
                "offending_units": offending_units,
                "offending_areas": offending_areas,
            }
        )
 
def update_polygon_area(
    db: Session,
    area_id: str,
    payload: any  # schemas.UnitAreaPolygonUpdate
) -> models.UnitArea:
    """
    Update an existing polygon responsibility area.
    """
    area = db.query(models.UnitArea).filter(models.UnitArea.id == area_id).first()
    if not area:
        return None
 
    coords = payload.coordinates
    if not coords or len(coords) < 3:
        return None
 
    # Cascade validation if updating a responsibility area
    if area.area_type == "responsibility" and not getattr(payload, "skip_validation", False):
        validate_descendants_inside_polygon(db, area.unit_id, coords)
        validate_area_inside_parent_ao(db, area.unit_id, coords)
 
    # Ensure closed ring for WKT
    if coords[0] != coords[-1]:
        coords.append(coords[0])

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    bbox = [min(lons), min(lats), max(lons), max(lats)]

    if payload.name is not None:
        area.name = payload.name
    if payload.area_type is not None:
        area.area_type = payload.area_type
    if payload.bearing_deg is not None:
        area.bearing_deg = payload.bearing_deg

    area.coordinates = coords
    area.bbox = bbox
    area.area_km2 = calculate_polygon_area_km2(coords)
    
    if HAS_GEOALCHEMY2:
        wkt_points = ", ".join([f"{c[0]} {c[1]}" for c in coords])
        wkt = f"POLYGON(({wkt_points}))"
        area.geometry = WKTElement(wkt, srid=4326)

    db.commit()
    db.refresh(area)

    # Auto-move unit to centroid if it's a responsibility area
    if getattr(payload, "recenter_unit", True) and area.area_type == "responsibility":
        _move_unit_to_area_centroid(db, area.unit_id, coords)

    return area

def _move_unit_to_area_centroid(db: Session, unit_id: str, coordinates: list):
    """
    Moves the unit symbol to the centroid (or representative point) of the given AO.
    """
    if not coordinates or len(coordinates) < 3:
        return

    # 1. Close ring and create polygon
    cleaned_coords = [[float(p[0]), float(p[1])] for p in coordinates]
    if cleaned_coords[0] != cleaned_coords[-1]:
        cleaned_coords.append(cleaned_coords[0])
        
    poly = Polygon(cleaned_coords)
    if not poly.is_valid:
        return

    # 2. Get centroid or representative point
    center = poly.centroid
    if not poly.covers(center):
        center = poly.representative_point()
        
    center_lon = center.x
    center_lat = center.y
    
    # 3. Convert to EPSG:3857
    x_3857, y_3857 = _to_3857.transform(center_lon, center_lat)
    
    # 4. Update Unit
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        return
        
    unit.position_lon = center_lon
    unit.position_lat = center_lat
    unit.x = x_3857
    unit.y = y_3857
    
    if HAS_GEOALCHEMY2:
        unit.position_geom = WKTElement(f"POINT({center_lon} {center_lat})", srid=4326)
        
    db.commit()
    db.refresh(unit)

def delete_area(db: Session, area_id: str) -> bool:
    """Delete an area by its ID. Returns True if deleted."""
    area = db.query(models.UnitArea).filter(models.UnitArea.id == area_id).first()
    if not area:
        return False

    db.delete(area)
    db.commit()
    return True

def delete_area_cascade(db: Session, area_id: str) -> dict:
    """
    Delete an area and recursively delete all descendant units (and their data).
    """
    area = db.query(models.UnitArea).filter(models.UnitArea.id == area_id).first()
    if not area:
        return None

    unit_id = area.unit_id

    # Import here to avoid circular dependency
    from .hierarchy_service import get_all_descendant_ids

    # 1. Find all descendant units
    descendant_ids = get_all_descendant_ids(db, unit_id)
    
    # 2. Delete the selected area (the parent AO)
    db.delete(area)

    # 3. Delete descendant units
    # Deleting a unit automatically deletes its areas, routes, tracks, etc. 
    # due to cascade="all, delete-orphan" in the models.
    units_to_delete = (
        db.query(models.Unit)
        .filter(models.Unit.id.in_(descendant_ids))
        .all()
    )
    
    deleted_unit_ids = [u.id for u in units_to_delete]
    
    for u in units_to_delete:
        db.delete(u)

    db.commit()

    return {
        "deleted_area_id": area_id,
        "deleted_unit_ids": deleted_unit_ids,
        "affected_unit_id": unit_id,
        "deleted_count": len(deleted_unit_ids) + 1  # units + parent area
    }

def looks_like_epsg3857(x, y):
    return abs(x) > 180 or abs(y) > 90


def to_lonlat(x, y):
    if looks_like_epsg3857(x, y):
        lon, lat = _to_4326.transform(x, y)
        return [lon, lat]

    return [x, y]

def area_to_coordinates(area: models.UnitArea):
    """
    Returns GeoJSON coordinates in EPSG:4326.
    Prioritizes area.coordinates JSON column.
    """
    if area.coordinates:
        return area.coordinates

    if area.bbox and len(area.bbox) == 4:
        min_x, min_y, max_x, max_y = area.bbox

        p1 = to_lonlat(min_x, min_y)
        p2 = to_lonlat(max_x, min_y)
        p3 = to_lonlat(max_x, max_y)
        p4 = to_lonlat(min_x, max_y)

        return [
            p1,
            p2,
            p3,
            p4,
            p1,
        ]

    return []
