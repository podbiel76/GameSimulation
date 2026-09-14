from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..database import get_db
from ..simulation_service import simulate_step
from ..rules_service import run_all_rules
from ..services.hierarchy_service import get_all_hierarchy_links
from ..services.unit_area_service import get_all_areas, area_to_coordinates
from ..terrain_service import get_terrain_type_at_position
from pyproj import Transformer

_to_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

router = APIRouter(tags=["scenario"])

# Tabela `assessments` rośnie monotonicznie (run_all_rules dopisuje przy każdym kroku),
# a full-state serializował ją w całości przy każdym pobraniu — także w pętli symulacji,
# po każdym dojściu jednostki do celu. UI pokazuje wyłącznie najnowsze wpisy.
# Limit jest świadomie hojny; docelowo full-state znika na rzecz delt po WebSockecie.
FULL_STATE_ASSESSMENT_LIMIT = 500


# ═══════════════════════════════════════════════════════════════════════
#  Full State Helper
# ═══════════════════════════════════════════════════════════════════════

def get_full_state_data(db: Session) -> dict:
    units = db.query(models.Unit).options(joinedload(models.Unit.logistics)).all()
    routes = db.query(models.Route).options(joinedload(models.Route.points)).all()
    tracks = db.query(models.UnitTrack).options(joinedload(models.UnitTrack.states)).all()
    assessments = (
        db.query(models.Assessment)
        .order_by(models.Assessment.timestamp.desc())
        .limit(FULL_STATE_ASSESSMENT_LIMIT)
        .all()
    )
    rules = db.query(models.ScenarioRule).all()
    hierarchy_links = get_all_hierarchy_links(db)
    areas = get_all_areas(db)

    return {
        "units": [schemas.Unit.model_validate(u).model_dump(mode="json") for u in units],
        "routes": [schemas.RouteRead.model_validate(r).model_dump(mode="json") for r in routes],
        "tracks": [schemas.UnitTrackRead.model_validate(t).model_dump(mode="json") for t in tracks],
        "assessments": [schemas.AssessmentRead.model_validate(a).model_dump(mode="json") for a in assessments],
        "rules": [schemas.ScenarioRuleRead.model_validate(r).model_dump(mode="json") for r in rules],
        "hierarchy": [
            schemas.UnitHierarchyRead.model_validate(h).model_dump(mode="json")
            for h in hierarchy_links
        ],
        "areas": [
            {
                "id": a.id,
                "unit_id": a.unit_id,
                "name": a.name,
                "area_type": a.area_type,
                "unit_echelon": a.unit.echelon if a.unit else None,
                "parent_unit_id": a.unit.parent_links[0].parent_unit_id if a.unit and a.unit.parent_links else None,
                "bbox": a.bbox,
                "area_km2": a.area_km2,
                "coordinates": area_to_coordinates(a),
                "bearing_deg": a.bearing_deg,
            }
            for a in areas
        ],
    }



# ═══════════════════════════════════════════════════════════════════════
#  Full State Endpoint
# ═══════════════════════════════════════════════════════════════════════

@router.get("/units/full-state")
def full_state(db: Session = Depends(get_db)):
    return get_full_state_data(db)


# ═══════════════════════════════════════════════════════════════════════
#  Routes (movement routes for units)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/units/{unit_id}/routes", response_model=schemas.RouteRead)
def create_route(unit_id: str, payload: schemas.RouteCreate, db: Session = Depends(get_db)):
    db_unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not db_unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    db_route = models.Route(
        unit_id=unit_id,
        name=payload.name,
        status=payload.status,
    )
    db.add(db_route)
    db.commit()
    db.refresh(db_route)
    return db_route


@router.get("/units/{unit_id}/routes", response_model=List[schemas.RouteRead])
def get_unit_routes(unit_id: str, db: Session = Depends(get_db)):
    db_unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not db_unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    routes = (
        db.query(models.Route)
        .filter(models.Route.unit_id == unit_id)
        .order_by(models.Route.created_at.desc())
        .all()
    )
    return routes


@router.post("/routes/{route_id}/points", response_model=schemas.RoutePointRead)
def add_route_point(route_id: str, payload: schemas.RoutePointCreate, db: Session = Depends(get_db)):
    db_route = db.query(models.Route).filter(models.Route.id == route_id).first()
    if not db_route:
        raise HTTPException(status_code=404, detail="Route not found")

    db_point = models.RoutePoint(
        route_id=route_id,
        order_index=payload.order_index,
        x=payload.x,
        y=payload.y,
        planned_arrival_time=payload.planned_arrival_time,
    )
    db.add(db_point)
    db.commit()
    db.refresh(db_point)
    return db_point


@router.delete("/routes/{route_id}/points/{point_id}", response_model=dict)
def delete_route_point(route_id: str, point_id: str, db: Session = Depends(get_db)):
    db_point = (
        db.query(models.RoutePoint)
        .filter(models.RoutePoint.id == point_id, models.RoutePoint.route_id == route_id)
        .first()
    )
    if not db_point:
        raise HTTPException(status_code=404, detail="RoutePoint not found")

    db.delete(db_point)
    db.commit()
    return {"status": "ok", "deleted_id": point_id}


# ═══════════════════════════════════════════════════════════════════════
#  Tracks
# ═══════════════════════════════════════════════════════════════════════

@router.post("/units/{unit_id}/tracks", response_model=schemas.UnitTrackRead)
def create_track(unit_id: str, payload: schemas.UnitTrackCreate, db: Session = Depends(get_db)):
    db_unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not db_unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    db_track = models.UnitTrack(
        unit_id=unit_id,
        status=payload.status,
        confidence=payload.confidence,
    )
    db.add(db_track)
    db.commit()
    db.refresh(db_track)
    return db_track


@router.post("/tracks/{track_id}/states", response_model=schemas.UnitStateRead)
def add_track_state(track_id: str, payload: schemas.UnitStateCreate, db: Session = Depends(get_db)):
    db_track = db.query(models.UnitTrack).filter(models.UnitTrack.id == track_id).first()
    if not db_track:
        raise HTTPException(status_code=404, detail="Track not found")

    db_state = models.UnitState(
        track_id=track_id,
        x=payload.x,
        y=payload.y,
        heading=payload.heading,
        speed=payload.speed,
        source=payload.source,
        timestamp=payload.timestamp or models.utc_now(),
    )
    db.add(db_state)
    db.commit()
    db.refresh(db_state)
    return db_state


@router.get("/tracks/{track_id}/states", response_model=List[schemas.UnitStateRead])
def get_track_states(track_id: str, db: Session = Depends(get_db)):
    db_track = db.query(models.UnitTrack).filter(models.UnitTrack.id == track_id).first()
    if not db_track:
        raise HTTPException(status_code=404, detail="Track not found")

    states = (
        db.query(models.UnitState)
        .filter(models.UnitState.track_id == track_id)
        .order_by(models.UnitState.timestamp.asc())
        .all()
    )
    return states


# ═══════════════════════════════════════════════════════════════════════
#  Scenario Rules
# ═══════════════════════════════════════════════════════════════════════

@router.post("/rules", response_model=schemas.ScenarioRuleRead)
def create_rule(payload: schemas.ScenarioRuleCreate, db: Session = Depends(get_db)):
    existing = db.query(models.ScenarioRule).filter(models.ScenarioRule.rule_id == payload.rule_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Rule '{payload.rule_id}' already exists")

    db_rule = models.ScenarioRule(
        rule_id=payload.rule_id,
        name=payload.name,
        rule_type=payload.rule_type,
        severity=payload.severity,
        params=payload.params,
        enabled=payload.enabled,
    )
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)
    return db_rule


@router.get("/rules", response_model=List[schemas.ScenarioRuleRead])
def get_rules(db: Session = Depends(get_db)):
    return db.query(models.ScenarioRule).order_by(models.ScenarioRule.created_at.desc()).all()


# ═══════════════════════════════════════════════════════════════════════
#  Assessments
# ═══════════════════════════════════════════════════════════════════════

@router.post("/assessments/run", response_model=List[schemas.AssessmentRead])
def run_assessments(db: Session = Depends(get_db)):
    new_assessments = run_all_rules(db)
    return new_assessments


@router.get("/assessments", response_model=List[schemas.AssessmentRead])
def get_assessments(
    subject_type: Optional[str] = None,
    subject_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.Assessment)
    if subject_type:
        query = query.filter(models.Assessment.subject_type == subject_type)
    if subject_id:
        query = query.filter(models.Assessment.subject_id == subject_id)
    if status:
        query = query.filter(models.Assessment.status == status)
    return query.order_by(models.Assessment.timestamp.desc()).all()


# ═══════════════════════════════════════════════════════════════════════
#  Simulation
# ═══════════════════════════════════════════════════════════════════════

@router.get("/simulation/units/{unit_id}/terrain")
def get_unit_terrain(unit_id: str, db: Session = Depends(get_db)):
    db_unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not db_unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    lon = db_unit.position_lon
    lat = db_unit.position_lat

    # Przelicz z EPSG:3857 na EPSG:4326 jeśli brakuje
    if lon is None or lat is None:
        if db_unit.x is None or db_unit.y is None:
            raise HTTPException(status_code=422, detail="Unit position is completely missing")
        lon, lat = _to_4326.transform(db_unit.x, db_unit.y)

    terrain_type = get_terrain_type_at_position(db, lon, lat)

    return {
        "unit_id": unit_id,
        "position_lon": lon,
        "position_lat": lat,
        "terrain_type": terrain_type
    }

@router.post("/units/{unit_id}/simulate-step")
def run_simulation_step(unit_id: str, db: Session = Depends(get_db)):
    result = simulate_step(db, unit_id)
    run_all_rules(db)
    return {
        "ok": True,
        "unit_id": unit_id,
        "message": result.get("detail", ""),
        "full_state": get_full_state_data(db),
    }


@router.post("/simulation/step-all")
def simulation_step_all(db: Session = Depends(get_db)):
    active_routes = (
        db.query(models.Route)
        .filter(models.Route.status == "active")
        .all()
    )
    unit_ids = list(set(r.unit_id for r in active_routes))
    messages = []
    for uid in unit_ids:
        result = simulate_step(db, uid)
        messages.append({"unit_id": uid, "result": result.get("detail", "")})

    run_all_rules(db)
    return {
        "ok": True,
        "stepped_units": len(unit_ids),
        "messages": messages,
        "full_state": get_full_state_data(db),
    }


@router.post("/simulation/run-rules")
def simulation_run_rules(db: Session = Depends(get_db)):
    run_all_rules(db)
    return {
        "ok": True,
        "full_state": get_full_state_data(db),
    }
