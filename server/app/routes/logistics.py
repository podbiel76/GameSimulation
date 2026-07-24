"""Logistics API endpoints — independent module for logistics management."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, crud
from ..database import get_db

router = APIRouter(prefix="/logistics", tags=["logistics"])


@router.get("/units", response_model=List[schemas.Unit])
def list_logistics_units(
    status: Optional[str] = Query(None, description="Filter: ready, incomplete, critical"),
    requires_completion: Optional[bool] = Query(None),
    side: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List all units with their logistics data, with optional filters."""
    query = db.query(models.Unit).options(joinedload(models.Unit.logistics))

    if status:
        query = query.filter(models.Unit.readiness_status == status)
    if requires_completion is not None:
        query = query.filter(models.Unit.requires_logistics_completion == requires_completion)
    if side:
        query = query.filter(models.Unit.side == side)

    return query.order_by(models.Unit.created_at.desc()).all()


@router.get("/units/{unit_id}", response_model=schemas.Unit)
def get_logistics_unit(unit_id: str, db: Session = Depends(get_db)):
    """Get a single unit with full logistics detail."""
    unit = (
        db.query(models.Unit)
        .options(joinedload(models.Unit.logistics))
        .filter(models.Unit.id == unit_id)
        .first()
    )
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


@router.patch("/units/{unit_id}", response_model=schemas.UnitLogistics)
def update_logistics(
    unit_id: str,
    payload: schemas.UnitLogisticsUpdate,
    db: Session = Depends(get_db),
):
    """Update logistics for a unit. Auto-computes effectiveness and readiness."""
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    return crud.update_unit_logistics(db, unit_id=unit_id, updates=payload)


@router.get("/summary")
def logistics_summary(db: Session = Depends(get_db)):
    """Get a summary of logistics across all units."""
    units = db.query(models.Unit).options(joinedload(models.Unit.logistics)).all()

    total = len(units)
    ready = sum(1 for u in units if u.readiness_status == "ready")
    incomplete = sum(1 for u in units if u.readiness_status == "incomplete")
    critical = sum(1 for u in units if u.readiness_status == "critical")
    needs_logistics = sum(1 for u in units if u.requires_logistics_completion)

    avg_effectiveness = 0.0
    with_logistics = [u for u in units if u.logistics]
    if with_logistics:
        avg_effectiveness = round(
            sum(u.logistics.combat_effectiveness_percent for u in with_logistics) / len(with_logistics),
            1,
        )

    return {
        "total_units": total,
        "ready": ready,
        "incomplete": incomplete,
        "critical": critical,
        "needs_logistics_completion": needs_logistics,
        "avg_combat_effectiveness": avg_effectiveness,
    }
