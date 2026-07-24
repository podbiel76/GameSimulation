"""Terrain assessment API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..terrain_service import assess_unit_terrain, assess_position_terrain

router = APIRouter(prefix="/terrain", tags=["terrain"])


@router.post("/assess-unit/{unit_id}", response_model=schemas.TerrainAssessmentRead)
def assess_unit(unit_id: str, db: Session = Depends(get_db)):
    """Assess terrain at a unit's current position."""
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    assessment = assess_unit_terrain(db, unit_id)
    if not assessment:
        raise HTTPException(status_code=500, detail="Failed to assess terrain")

    return assessment


@router.post("/assess-position")
def assess_position(lon: float, lat: float):
    """Quick terrain assessment at arbitrary coordinates (no DB record)."""
    return assess_position_terrain(lon, lat)
