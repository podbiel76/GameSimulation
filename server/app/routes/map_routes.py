"""Map API endpoints — unit positions, areas, and map-specific operations."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, crud
from ..database import get_db
from ..services.unit_area_service import (
    create_square_area,
    create_polygon_area,
    update_polygon_area,
    get_unit_areas,
    get_all_areas,
    delete_area,
    delete_area_cascade,
    area_to_coordinates,
)

router = APIRouter(prefix="/map", tags=["map"])


@router.get("/units", response_model=List[schemas.Unit])
def get_map_units(db: Session = Depends(get_db)):
    """Get all units for map display."""
    return (
        db.query(models.Unit)
        .options(joinedload(models.Unit.logistics))
        .all()
    )


@router.post("/units", response_model=schemas.Unit)
def create_map_unit(payload: schemas.UnitCreate, db: Session = Depends(get_db)):
    """Create a unit from the map (click-to-place)."""
    return crud.create_unit(db, payload)


@router.patch("/units/{unit_id}/position", response_model=schemas.Unit)
def update_unit_position(
    unit_id: str,
    payload: schemas.UnitPositionUpdate,
    db: Session = Depends(get_db),
):
    """Update a unit's position on the map. Triggers terrain re-assessment."""
    unit = crud.update_unit_position(db, unit_id, payload)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


# ─── Areas ───────────────────────────────────────────────────────────

@router.post("/units/{unit_id}/area/square", response_model=schemas.UnitAreaRead)
def create_square_responsibility_area(
    unit_id: str,
    payload: schemas.UnitAreaSquareCreate,
    db: Session = Depends(get_db),
):
    """Generate a square responsibility area around a unit's position."""
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    area = create_square_area(
        db,
        unit_id=unit_id,
        size_km=payload.size_km,
        name=payload.name,
        bearing_deg=payload.bearing_deg,
    )
    if not area:
        raise HTTPException(status_code=400, detail="Could not create area (missing position?)")

    # Build response with coordinates extracted from geometry/bbox
    return _area_to_read(area)


@router.post("/unit-areas/polygon", response_model=schemas.UnitAreaRead)
def create_polygon_responsibility_area(
    payload: schemas.UnitAreaPolygonCreate,
    db: Session = Depends(get_db),
):
    """Create a manual polygon responsibility area."""
    unit = db.query(models.Unit).filter(models.Unit.id == payload.unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    area = create_polygon_area(db, payload)
    if not area:
        raise HTTPException(status_code=400, detail="Could not create area (invalid coordinates?)")

    return _area_to_read(area)


@router.get("/units/{unit_id}/areas", response_model=List[schemas.UnitAreaRead])
def get_areas(unit_id: str, db: Session = Depends(get_db)):
    """Get all areas for a unit."""
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    areas = get_unit_areas(db, unit_id)
    return [_area_to_read(a) for a in areas]


@router.get("/unit-areas", response_model=List[schemas.UnitAreaRead])
def get_all_unit_areas(db: Session = Depends(get_db)):
    """Get all unit areas."""
    areas = get_all_areas(db)
    return [_area_to_read(a) for a in areas]


@router.put("/unit-areas/{area_id}/polygon", response_model=schemas.UnitAreaRead)
def update_polygon_responsibility_area(
    area_id: str,
    payload: schemas.UnitAreaPolygonUpdate,
    db: Session = Depends(get_db),
):
    """Update an existing polygon responsibility area."""
    area = update_polygon_area(db, area_id, payload)
    if not area:
        raise HTTPException(status_code=404, detail="Area not found or invalid coordinates")

    return _area_to_read(area)


@router.delete("/unit-areas/{area_id}")
def remove_area(area_id: str, db: Session = Depends(get_db)):
    """Delete a unit area."""
    deleted = delete_area(db, area_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Area not found")

    return {"deleted": True, "area_id": area_id}
 
 
@router.delete("/unit-areas/{area_id}/cascade")
def remove_area_cascade(area_id: str, db: Session = Depends(get_db)):
    """Delete a unit area and all descendant units."""
    result = delete_area_cascade(db, area_id)
    if not result:
        raise HTTPException(status_code=404, detail="Area not found")
 
    return {
        "deleted": True,
        "area_id": area_id,
        "deleted_unit_ids": result["deleted_unit_ids"],
        "affected_unit_id": result["affected_unit_id"],
        "deleted_count": result["deleted_count"]
    }


# ─── Helpers ─────────────────────────────────────────────────────────

def _area_to_read(area: models.UnitArea) -> schemas.UnitAreaRead:
    """Convert a UnitArea model to a UnitAreaRead schema with coordinates."""
    coords = area_to_coordinates(area)
    return schemas.UnitAreaRead(
        id=area.id,
        unit_id=area.unit_id,
        name=area.name,
        area_type=area.area_type,
        bearing_deg=area.bearing_deg,
        bbox=area.bbox,
        area_km2=area.area_km2,
        coordinates=coords,
        created_at=area.created_at,
        updated_at=area.updated_at,
    )
