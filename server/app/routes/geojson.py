"""GeoJSON export endpoints — units as Points, areas as Polygons."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..database import get_db
from ..services.hierarchy_service import get_all_hierarchy_links
from ..services.unit_area_service import get_all_areas, area_to_coordinates

router = APIRouter(tags=["json"])


@router.get("/units.geojson")
def units_geojson(db: Session = Depends(get_db)):
    """
    Export all units as a GeoJSON FeatureCollection.
    Each unit is a Point feature at (position_lon, position_lat).
    """
    units = db.query(models.Unit).all()

    features = []
    for u in units:
        lon = u.position_lon if u.position_lon is not None else u.x
        lat = u.position_lat if u.position_lat is not None else u.y

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat],
            },
            "properties": {
                "id": u.id,
                "symbol_id": u.symbol_id,
                "symbol_name": u.symbol_name,
                "side": u.side,
                "unit_type": u.unit_type,
                "echelon": u.echelon,
                "readiness_status": u.readiness_status,
                "call_sign": u.call_sign,
            },
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features,
    }


@router.get("/unit-areas.geojson")
def unit_areas_geojson(db: Session = Depends(get_db)):
    """
    Export all unit areas as a GeoJSON FeatureCollection.
    Each area is a Polygon feature.
    """
    areas = get_all_areas(db)

    features = []
    for area in areas:
        coords = area_to_coordinates(area)
        if not coords:
            continue

        # Get unit name for properties
        unit = db.query(models.Unit).filter(models.Unit.id == area.unit_id).first()
        unit_name = unit.symbol_name if unit else "Unknown"

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],  # GeoJSON requires array of rings
            },
            "properties": {
                "id": area.id,
                "unit_id": area.unit_id,
                "unit_name": unit_name,
                "area_type": area.area_type,
                "area_km2": area.area_km2,
                "name": area.name,
                "bearing_deg": area.bearing_deg,
                "unit_echelon": unit.echelon if unit else None,
                "parent_unit_id": unit.parent_links[0].parent_unit_id if unit and unit.parent_links else None,
            },
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features,
    }


@router.get("/units/{unit_id}/areas.geojson")
def unit_areas_geojson_for_unit(unit_id: str, db: Session = Depends(get_db)):
    """
    Export areas for a specific unit as a GeoJSON FeatureCollection.
    """
    from ..services.unit_area_service import get_unit_areas

    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        return {"type": "FeatureCollection", "features": []}

    areas = get_unit_areas(db, unit_id)

    features = []
    for area in areas:
        coords = area_to_coordinates(area)
        if not coords:
            continue

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
            "properties": {
                "id": area.id,
                "unit_id": area.unit_id,
                "unit_name": unit.symbol_name,
                "area_type": area.area_type,
                "area_km2": area.area_km2,
                "name": area.name,
                "bearing_deg": area.bearing_deg,
                "unit_echelon": unit.echelon if unit else None,
                "parent_unit_id": unit.parent_links[0].parent_unit_id if unit and unit.parent_links else None,
            },
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features,
    }


@router.get("/unit-hierarchy.json")
def unit_hierarchy_json(db: Session = Depends(get_db)):
    """
    Export all hierarchy links as a flat JSON list.
    """
    links = get_all_hierarchy_links(db)

    return [
        {
            "id": link.id,
            "parent_unit_id": link.parent_unit_id,
            "child_unit_id": link.child_unit_id,
            "relation_type": link.relation_type,
            "order_index": link.order_index,
        }
        for link in links
    ]
