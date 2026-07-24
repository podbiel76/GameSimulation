from app.services import subordinate_service
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import crud, models, schemas
from ..database import get_db
from ..services.hierarchy_service import generate_subordinates, generate_subordinate_tree
from ..services.subordinate_service import create_subordinate_in_area

router = APIRouter(prefix="/units", tags=["units"])

@router.post("/{unit_id}/create-subordinate-in-area")
def post_create_subordinate_in_area(unit_id: str, db: Session = Depends(get_db)):
    try:
        return create_subordinate_in_area(db, unit_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Błąd serwera: {str(e)}")

@router.post("/{unit_id}/create-child-with-area")
def post_create_child_with_area(
    unit_id: str, 
    payload: schemas.ChildWithAreaCreate, 
    db: Session = Depends(get_db)
):
    try:
        # payload.coordinates is [[lon, lat], ...]
        return subordinate_service.create_child_with_area(
            db, 
            unit_id, 
            payload.coordinates, 
            unit_number=payload.unit_number, 
            custom_name=payload.custom_name
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Błąd serwera: {str(e)}")

@router.get("", response_model=List[schemas.Unit])
def read_units(db: Session = Depends(get_db)):
    return crud.get_units(db)

@router.get("/{unit_id}", response_model=schemas.Unit)
def read_unit(unit_id: str, db: Session = Depends(get_db)):
    db_unit = crud.get_unit(db, unit_id=unit_id)
    if db_unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    return db_unit

@router.post("/create", response_model=schemas.Unit)
def create_unit(unit: schemas.UnitCreate, db: Session = Depends(get_db)):
    try:
        return crud.create_unit(db=db, unit=unit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("/{unit_id}", response_model=schemas.Unit)
def update_unit(
    unit_id: str,
    payload: schemas.UnitUpdate,
    db: Session = Depends(get_db),
):
    try:
        db_unit = crud.update_unit(db, unit_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not db_unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    return db_unit

@router.patch("/{unit_id}/logistics", response_model=schemas.UnitLogistics)
def update_unit_logistics(unit_id: str, logistics: schemas.UnitLogisticsUpdate, db: Session = Depends(get_db)):
    db_unit = crud.get_unit(db, unit_id=unit_id)
    if db_unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    return crud.update_unit_logistics(db, unit_id=unit_id, updates=logistics)

@router.delete("/{unit_id}", response_model=dict)
def delete_unit(unit_id: str, db: Session = Depends(get_db)):
    success = crud.delete_unit(db, unit_id=unit_id)
    if not success:
        raise HTTPException(status_code=404, detail="Unit not found")
    return {"status": "ok", "deleted_id": unit_id}

@router.post("/from-detection", response_model=schemas.Unit)
def create_unit_from_detection(payload: schemas.CreateFromDetectionPayload, db: Session = Depends(get_db)):
    return crud.create_unit_from_detection(db, payload)


@router.post("/{unit_id}/generate-tree", response_model=schemas.ChildGenerationTreeResponse)
def generate_unit_tree(
    unit_id: str,
    payload: schemas.ChildGenerationTreeRequest,
    db: Session = Depends(get_db)
):
    """
    Recursively generate subordinate units and areas for a parent unit.
    """
    try:
        result = generate_subordinate_tree(
            db, 
            unit_id, 
            child_count_by_echelon=payload.child_count_by_echelon,
            max_depth=payload.max_depth
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{unit_id}/generate-children", response_model=schemas.ChildGenerationResponse)
def generate_unit_children(
    unit_id: str,
    payload: dict,
    db: Session = Depends(get_db)
):
    """
    Generate subordinate units and areas for a parent unit.
    Payload: {"child_count": 2}
    """
    child_count = payload.get("child_count", 2)
    try:
        result = generate_subordinates(db, unit_id, child_count)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
