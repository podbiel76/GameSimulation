import math
from sqlalchemy.orm import Session
from . import models
from pyproj import Transformer
from .terrain_service import get_terrain_type_at_position

_to_4326 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

# Distance per simulation step (in coordinate units)
STEP_DISTANCE = 50.0


def simulate_step(db: Session, unit_id: str) -> dict:
    """
    Execute one simulation step for a unit:
    1. Find the active route
    2. Take the first RoutePoint (lowest order_index)
    3. Move Unit toward that point by STEP_DISTANCE
    4. If close enough, snap to point and consume it
    5. Record a UnitState in the active track
    6. If no points remain, mark route + track as completed
    """

    # ── Find unit ──
    db_unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not db_unit:
        return {"ok": False, "detail": "Unit not found", "moved": False}

    # ── Find active route ──
    db_route = (
        db.query(models.Route)
        .filter(models.Route.unit_id == unit_id, models.Route.status == "active")
        .first()
    )
    if not db_route:
        return {
            "ok": False,
            "unit_id": unit_id,
            "detail": "No active route for this unit",
            "moved": False,
        }

    # ── Get next point (lowest order_index) ──
    next_point = (
        db.query(models.RoutePoint)
        .filter(models.RoutePoint.route_id == db_route.id)
        .order_by(models.RoutePoint.order_index.asc())
        .first()
    )
    if not next_point:
        db_route.status = "completed"
        _complete_active_track(db, unit_id)
        db.commit()
        return {
            "ok": True,
            "unit_id": unit_id,
            "route_id": db_route.id,
            "track_id": None,
            "moved": False,
            "reached_point": False,
            "completed_route": True,
            "x": db_unit.x,
            "y": db_unit.y,
            "detail": "Route completed (no points remaining)",
        }

    # capture old position
    old_x, old_y = db_unit.x, db_unit.y
    old_lon = db_unit.position_lon
    old_lat = db_unit.position_lat

    # Initialize lon/lat if missing
    if old_lon is None or old_lat is None:
        old_lon, old_lat = _to_4326.transform(old_x, old_y)
        db_unit.position_lon = old_lon
        db_unit.position_lat = old_lat

    # ── Calculate movement vector ──
    dx = next_point.x - db_unit.x
    dy = next_point.y - db_unit.y
    distance = math.sqrt(dx * dx + dy * dy)

    heading = math.degrees(math.atan2(dy, dx))

    reached_point = False
    completed_route = False

    if distance <= STEP_DISTANCE:
        # Close enough — snap to point
        db_unit.x = next_point.x
        db_unit.y = next_point.y
        speed = distance
        reached_point = True

        # Remove consumed point
        db.delete(next_point)
        db.flush()

        # Check remaining points
        remaining = (
            db.query(models.RoutePoint)
            .filter(models.RoutePoint.route_id == db_route.id)
            .count()
        )

        if remaining == 0:
            db_route.status = "completed"
            completed_route = True
    else:
        # Move toward point by STEP_DISTANCE
        ratio = STEP_DISTANCE / distance
        db_unit.x += dx * ratio
        db_unit.y += dy * ratio
        speed = STEP_DISTANCE

    # Update geographic position
    new_lon, new_lat = _to_4326.transform(db_unit.x, db_unit.y)
    db_unit.position_lon = new_lon
    db_unit.position_lat = new_lat

    if models.HAS_GEOALCHEMY2:
        from geoalchemy2.elements import WKTElement
        db_unit.position_geom = WKTElement(f"POINT({new_lon} {new_lat})", srid=4326)

    # ── Terrain Check & Log ──
    terrain_type = get_terrain_type_at_position(db, new_lon, new_lat)
    print(f"[TERRAIN] Unit {db_unit.id} ({db_unit.symbol_name}) terrain={terrain_type} lon={new_lon:.6f} lat={new_lat:.6f}")

    # ── Shift associated areas ──
    d_lon = new_lon - old_lon
    d_lat = new_lat - old_lat

    if d_lon != 0 or d_lat != 0:
        for area in db_unit.areas:
            if area.coordinates:
                new_coords = []
                for p in area.coordinates:
                    new_coords.append([p[0] + d_lon, p[1] + d_lat])
                area.coordinates = new_coords

                # Update bbox
                if area.bbox:
                    area.bbox = [
                        area.bbox[0] + d_lon,
                        area.bbox[1] + d_lat,
                        area.bbox[2] + d_lon,
                        area.bbox[3] + d_lat
                    ]

                # Update geometry
                if models.HAS_GEOALCHEMY2:
                    from geoalchemy2.elements import WKTElement
                    wkt_points = ", ".join([f"{c[0]} {c[1]}" for c in new_coords])
                    wkt = f"POLYGON(({wkt_points}))"
                    area.geometry = WKTElement(wkt, srid=4326)

    # ── Ensure active track exists ──
    db_track = (
        db.query(models.UnitTrack)
        .filter(models.UnitTrack.unit_id == unit_id, models.UnitTrack.status == "active")
        .first()
    )
    if not db_track:
        db_track = models.UnitTrack(unit_id=unit_id, status="active")
        db.add(db_track)
        db.flush()

    # ── Record state ──
    db_state = models.UnitState(
        track_id=db_track.id,
        x=db_unit.x,
        y=db_unit.y,
        heading=heading,
        speed=speed,
        source="simulation",
    )
    db.add(db_state)

    # ── Complete track if route done ──
    if completed_route:
        _complete_active_track(db, unit_id)

    db.commit()

    return {
        "ok": True,
        "unit_id": unit_id,
        "route_id": db_route.id,
        "track_id": db_track.id,
        "moved": True,
        "reached_point": reached_point,
        "completed_route": completed_route,
        "x": db_unit.x,
        "y": db_unit.y,
        "detail": (
            f"Reached waypoint, route {'completed' if completed_route else 'continuing'}"
            if reached_point
            else f"Moved {speed:.1f} units toward waypoint ({distance - speed:.1f} remaining)"
        ),
    }


def _complete_active_track(db: Session, unit_id: str):
    """Mark the active track for unit as completed and set ended_at."""
    db_track = (
        db.query(models.UnitTrack)
        .filter(models.UnitTrack.unit_id == unit_id, models.UnitTrack.status == "active")
        .first()
    )
    if db_track:
        db_track.status = "completed"
        db_track.ended_at = models.utc_now()
