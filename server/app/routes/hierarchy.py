"""Unit hierarchy API endpoints."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.hierarchy_service import (
    add_subordinate,
    remove_subordinate,
    get_subordinates,
    get_hierarchy_tree,
    HierarchyCycleError,
    HierarchySelfLinkError,
)

router = APIRouter(tags=["hierarchy"])


@router.post(
    "/units/{parent_unit_id}/subordinates/{child_unit_id}",
    response_model=schemas.UnitHierarchyRead,
)
def create_subordinate_link(
    parent_unit_id: str,
    child_unit_id: str,
    payload: schemas.UnitHierarchyCreate = None,
    db: Session = Depends(get_db),
):
    """Add a subordinate unit to a parent unit."""
    if payload is None:
        payload = schemas.UnitHierarchyCreate()

    try:
        link = add_subordinate(
            db,
            parent_unit_id=parent_unit_id,
            child_unit_id=child_unit_id,
            relation_type=payload.relation_type,
            order_index=payload.order_index,
        )
    except HierarchySelfLinkError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HierarchyCycleError as e:
        raise HTTPException(status_code=409, detail=str(e))

    if link is None:
        raise HTTPException(status_code=404, detail="Parent or child unit not found")

    return link


@router.delete("/units/{parent_unit_id}/subordinates/{child_unit_id}")
def delete_subordinate_link(
    parent_unit_id: str,
    child_unit_id: str,
    db: Session = Depends(get_db),
):
    """Remove a subordinate link between two units."""
    deleted = remove_subordinate(db, parent_unit_id, child_unit_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Hierarchy link not found")

    return {"status": "ok", "parent_unit_id": parent_unit_id, "child_unit_id": child_unit_id}


@router.get("/units/{unit_id}/subordinates", response_model=List[schemas.Unit])
def list_subordinates(unit_id: str, db: Session = Depends(get_db)):
    """Get direct subordinate units of a given unit."""
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    return get_subordinates(db, unit_id)


@router.get("/units/{unit_id}/hierarchy")
def get_unit_hierarchy(unit_id: str, db: Session = Depends(get_db)):
    """Get the full hierarchy tree starting from a unit."""
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    return get_hierarchy_tree(db, unit_id)
