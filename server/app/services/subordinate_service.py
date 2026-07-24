import math
from typing import Optional, List
from sqlalchemy.orm import Session
from shapely.geometry import Point as ShapePoint, Polygon as ShapePolygon, box
from shapely import intersection
from pyproj import Transformer

from .. import models, schemas
from ..constants import UNIT_CHILDREN, get_area_size_for_echelon
from .hierarchy_service import add_subordinate, build_child_symbol_id
from .unit_area_service import area_to_coordinates

try:
    from geoalchemy2.elements import WKTElement
    HAS_GEOALCHEMY2 = True
except ImportError:
    HAS_GEOALCHEMY2 = False

to_3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
to_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

def create_subordinate_in_area(db: Session, parent_id: str) -> dict:
    # 1. Load Parent
    parent = db.query(models.Unit).filter(models.Unit.id == parent_id).first()
    if not parent:
        raise ValueError("Parent unit not found")

    # 2. Load Parent AO
    parent_area = (
        db.query(models.UnitArea)
        .filter(models.UnitArea.unit_id == parent_id, models.UnitArea.area_type == "responsibility")
        .order_by(models.UnitArea.created_at.desc())
        .first()
    )
    if not parent_area or not parent_area.coordinates:
        raise ValueError("Parent must have a responsibility area (AO) to create subordinates inside it")

    # 3. Determine Child Echelon
    child_echelon = UNIT_CHILDREN.get(parent.echelon)
    if not child_echelon:
        raise ValueError(f"Echelon '{parent.echelon}' has no defined subordinate echelon")

    # 4. Determine Position
    parent_coords = area_to_coordinates(parent_area) # List of [lon, lat]
    parent_poly = ShapePolygon(parent_coords)
    
    # Get current subordinates count to pick a slot
    existing_count = db.query(models.UnitHierarchy).filter(models.UnitHierarchy.parent_unit_id == parent_id).count()
    
    # Start with centroid
    centroid = parent_poly.centroid
    target_lon = centroid.x
    target_lat = centroid.y
    
    # Offset based on count (simple radial layout in Web Mercator meters)
    if existing_count > 0:
        # Distance based on echelon size (approx 1/4 of parent side)
        parent_side_km = get_area_size_for_echelon(parent.echelon)
        offset_dist_m = (parent_side_km * 1000) / 3.0
        
        angle = math.radians(45 + existing_count * 90) # Offset from 45deg
        dx = offset_dist_m * math.cos(angle)
        dy = offset_dist_m * math.sin(angle)
        
        # Convert centroid to 3857
        cx, cy = to_3857.transform(target_lon, target_lat)
        nx, ny = cx + dx, cy + dy
        target_lon, target_lat = to_4326.transform(nx, ny)
        
        # Check if inside
        if not parent_poly.contains(ShapePoint(target_lon, target_lat)):
            # Try a smaller offset or fallback
            target_lon, target_lat = centroid.x, centroid.y

    # 5. Build Child Symbol & Name
    child_symbol_id = build_child_symbol_id(parent.symbol_id, child_echelon)
    # E.g. "🔵 Infantry — Section" -> replace Section with child echelon label
    # Or just use parent name + suffix
    child_name = f"{parent.symbol_name} - {child_echelon.replace('_', ' ')}"

    # 6. Create Child Unit
    cx_3857, cy_3857 = to_3857.transform(target_lon, target_lat)
    child_unit = models.Unit(
        symbol_id=child_symbol_id,
        symbol_name=child_name,
        side=parent.side,
        unit_type=parent.unit_type,
        echelon=child_echelon,
        x=cx_3857,
        y=cy_3857,
        position_lon=target_lon,
        position_lat=target_lat,
        current_elevation_m=parent.current_elevation_m or 0.0,
        source="generated",
        readiness_status="ready"
    )
    if HAS_GEOALCHEMY2:
        child_unit.position_geom = WKTElement(f"POINT({target_lon} {target_lat})", srid=4326)
    
    db.add(child_unit)
    db.flush()

    # 7. Create Hierarchy Link
    link = add_subordinate(db, parent_id, child_unit.id, order_index=existing_count)

    # 8. Create Child AO
    # Small square based on echelon size
    child_size_km = get_area_size_for_echelon(child_echelon)
    half_side_deg = (child_size_km / 111.32) / 2.0
    
    child_box = box(
        target_lon - half_side_deg, 
        target_lat - half_side_deg, 
        target_lon + half_side_deg, 
        target_lat + half_side_deg
    )
    
    # Intersect with parent
    child_poly = intersection(child_box, parent_poly)
    
    # If MultiPolygon, pick largest
    if child_poly.geom_type == 'MultiPolygon':
        child_poly = max(child_poly.geoms, key=lambda p: p.area)
    
    # Extract coordinates
    if not child_poly.is_empty:
        child_coords = list(child_poly.exterior.coords)
        # Convert to list of lists for JSON
        coords_list = [ [float(p[0]), float(p[1])] for p in child_coords ]
    else:
        # Fallback to a very small box if intersection failed for some reason
        coords_list = [
            [target_lon - 0.001, target_lat - 0.001],
            [target_lon + 0.001, target_lat - 0.001],
            [target_lon + 0.001, target_lat + 0.001],
            [target_lon - 0.001, target_lat + 0.001],
            [target_lon - 0.001, target_lat - 0.001]
        ]

    # Calculate bbox and area
    min_lon = min(p[0] for p in coords_list)
    min_lat = min(p[1] for p in coords_list)
    max_lon = max(p[0] for p in coords_list)
    max_lat = max(p[1] for p in coords_list)
    
    child_area = models.UnitArea(
        unit_id=child_unit.id,
        name=f"AO {child_name}",
        area_type="responsibility",
        coordinates=coords_list,
        bbox=[min_lon, min_lat, max_lon, max_lat],
        area_km2=(child_size_km * child_size_km) # Approx
    )
    
    if HAS_GEOALCHEMY2:
        wkt_points = ", ".join([f"{c[0]} {c[1]}" for c in coords_list])
        wkt = f"POLYGON(({wkt_points}))"
        child_area.geometry = WKTElement(wkt, srid=4326)
        
    db.add(child_area)
    
    # Create default logistics
    child_logistics = models.UnitLogistics(unit_id=child_unit.id)
    db.add(child_logistics)
    
    db.commit()
    db.refresh(child_unit)
    db.refresh(child_area)
    
    return {
        "created_unit": schemas.Unit.model_validate(child_unit),
        "created_area": {
            "id": child_area.id,
            "name": child_area.name,
            "coordinates": coords_list,
            "area_type": child_area.area_type
        },
        "created_link": {
            "parent_id": parent_id,
            "child_id": child_unit.id,
            "order_index": existing_count
        },
        "parent_unit_id": parent_id,
        "child_echelon": child_echelon
    }

def close_polygon_ring(coordinates: list[list[float]]) -> list[list[float]]:
    if len(coordinates) < 3:
        raise ValueError("Polygon requires at least 3 points")

    closed = [[float(p[0]), float(p[1])] for p in coordinates]

    first = closed[0]
    last = closed[-1]

    if first[0] != last[0] or first[1] != last[1]:
        closed.append(first.copy())

    return closed

def create_child_with_area(db: Session, parent_id: str, coordinates: List[List[float]], unit_number: int | None = None, custom_name: str | None = None) -> dict:
    """
    Creates a subordinate unit at the centroid of a user-provided AO polygon.
    Validates that the polygon is inside the parent's AO.
    """
    # 1. Load Parent
    parent = db.query(models.Unit).filter(models.Unit.id == parent_id).first()
    if not parent:
        raise ValueError("Parent unit not found")

    # 2. Load Parent AO
    parent_area = (
        db.query(models.UnitArea)
        .filter(models.UnitArea.unit_id == parent_id, models.UnitArea.area_type == "responsibility")
        .order_by(models.UnitArea.created_at.desc())
        .first()
    )
    if not parent_area or not parent_area.coordinates:
        raise ValueError("Parent must have a responsibility area (AO)")

    # 3. Validate Containment
    coordinates = close_polygon_ring(coordinates)

    child_poly = ShapePolygon(coordinates)
    if not child_poly.is_valid:
        raise ValueError("Invalid polygon geometry")
        
    parent_poly = ShapePolygon(area_to_coordinates(parent_area))
    if not parent_poly.contains(child_poly):
        # We can also check intersection if strict containment is too hard, 
        # but user asked for "completely inside".
        if not parent_poly.intersects(child_poly):
            raise ValueError("Child AO must be inside parent AO")
        # Optional: check if all vertices are inside
        for p in coordinates:
            if not parent_poly.contains(ShapePoint(p[0], p[1])):
                 raise ValueError("Child AO points must be inside parent AO")

    # 4. Determine Child Echelon
    child_echelon = UNIT_CHILDREN.get(parent.echelon)
    if not child_echelon:
        raise ValueError(f"No subordinate echelon for {parent.echelon}")

    # 4.5. Determine unit_number
    if unit_number is not None:
        from app.crud import validate_unique_unit_number_in_parent_scope
        validate_unique_unit_number_in_parent_scope(db, None, parent_id, child_echelon, unit_number)
    else:
        # Auto-pick next available number among siblings
        siblings = db.query(models.Unit).join(
            models.UnitHierarchy, models.UnitHierarchy.child_unit_id == models.Unit.id
        ).filter(
            models.UnitHierarchy.parent_unit_id == parent_id,
            models.Unit.echelon == child_echelon
        ).all()
        max_num = 0
        for sib in siblings:
            if sib.unit_number and sib.unit_number > max_num:
                max_num = sib.unit_number
        unit_number = max_num + 1

    # 5. Calculate Centroid for Unit Position
    centroid = child_poly.centroid
    target_lon = centroid.x
    target_lat = centroid.y

    # 6. Build Child Symbol & Name
    child_symbol_id = build_child_symbol_id(parent.symbol_id, child_echelon)
    
    from app.crud import build_unit_display_name
    child_name = build_unit_display_name(custom_name, parent.unit_type, child_echelon, unit_number)

    # 7. Create Child Unit
    cx_3857, cy_3857 = to_3857.transform(target_lon, target_lat)
    child_unit = models.Unit(
        symbol_id=child_symbol_id,
        symbol_name=child_name,
        unit_number=unit_number,
        custom_name=custom_name,
        side=parent.side,
        unit_type=parent.unit_type,
        echelon=child_echelon,
        x=cx_3857,
        y=cy_3857,
        position_lon=target_lon,
        position_lat=target_lat,
        current_elevation_m=parent.current_elevation_m or 0.0,
        source="manual",
        readiness_status="ready"
    )
    if HAS_GEOALCHEMY2:
        child_unit.position_geom = WKTElement(f"POINT({target_lon} {target_lat})", srid=4326)
    
    db.add(child_unit)
    db.flush()

    # 8. Create Hierarchy Link
    existing_count = db.query(models.UnitHierarchy).filter(models.UnitHierarchy.parent_unit_id == parent_id).count()
    link = add_subordinate(db, parent_id, child_unit.id, order_index=existing_count)

    # 9. Create Child AO
    min_lon = min(p[0] for p in coordinates)
    min_lat = min(p[1] for p in coordinates)
    max_lon = max(p[0] for p in coordinates)
    max_lat = max(p[1] for p in coordinates)
    
    # Approx area
    area_km2 = child_poly.area * 111.32 * 111.32 * math.cos(math.radians(target_lat))

    child_area = models.UnitArea(
        unit_id=child_unit.id,
        name=f"AO {child_name}",
        area_type="responsibility",
        coordinates=coordinates,
        bbox=[min_lon, min_lat, max_lon, max_lat],
        area_km2=abs(area_km2)
    )
    
    if HAS_GEOALCHEMY2:
        wkt_points = ", ".join([f"{c[0]} {c[1]}" for c in coordinates])
        wkt = f"POLYGON(({wkt_points}))"
        child_area.geometry = WKTElement(wkt, srid=4326)
        
    db.add(child_area)
    
    # Logistics
    child_logistics = models.UnitLogistics(unit_id=child_unit.id)
    db.add(child_logistics)
    
    db.commit()
    db.refresh(child_unit)
    db.refresh(child_area)
    
    return {
        "created_unit": schemas.Unit.model_validate(child_unit),
        "created_area": {
            "id": child_area.id,
            "name": child_area.name,
            "coordinates": coordinates,
            "area_type": child_area.area_type
        },
        "created_link": {
            "parent_id": parent_id,
            "child_id": child_unit.id,
            "order_index": existing_count
        }
    }
