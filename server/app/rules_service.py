from typing import List
from sqlalchemy.orm import Session
from . import models


def run_all_rules(db: Session) -> List[models.Assessment]:
    """
    Evaluate all enabled ScenarioRules against all units.
    Creates Assessment records for each violation.
    Returns list of newly created assessments.
    """
    rules = (
        db.query(models.ScenarioRule)
        .filter(models.ScenarioRule.enabled == True)
        .all()
    )

    new_assessments: List[models.Assessment] = []

    for rule in rules:
        handler = RULE_HANDLERS.get(rule.rule_type)
        if not handler:
            continue
        assessments = handler(db, rule)
        new_assessments.extend(assessments)

    if new_assessments:
        db.add_all(new_assessments)
        db.commit()
        for a in new_assessments:
            db.refresh(a)

    return new_assessments


# ═══════════════════════════════════════════════════════════════════════
#  Rule Handlers
# ═══════════════════════════════════════════════════════════════════════

def _handle_low_fuel(db: Session, rule: models.ScenarioRule) -> List[models.Assessment]:
    """
    Check all units with logistics for fuel below threshold.
    Params: {"min_fuel_liters": 20}
    """
    min_fuel = rule.params.get("min_fuel_liters", 20)

    units_with_logistics = (
        db.query(models.Unit)
        .join(models.UnitLogistics, models.UnitLogistics.unit_id == models.Unit.id)
        .filter(models.UnitLogistics.fuel_liters < min_fuel)
        .all()
    )

    results = []
    for unit in units_with_logistics:
        current_fuel = unit.logistics.fuel_liters if unit.logistics else 0

        # Calculate severity based on how low the fuel is
        if current_fuel <= 0:
            status = "critical"
        elif current_fuel < min_fuel * 0.5:
            status = "critical"
        else:
            status = "warning"

        assessment = models.Assessment(
            rule_id=rule.rule_id,
            subject_type="unit",
            subject_id=unit.id,
            severity=rule.severity,
            status=status,
            confidence=1.0,
            explanation=f"Fuel level {current_fuel:.1f}L is below minimum {min_fuel:.1f}L",
            data={
                "current_fuel_liters": current_fuel,
                "threshold_fuel_liters": min_fuel,
                "unit_name": unit.symbol_name,
            },
        )
        results.append(assessment)

    return results


def _handle_low_personnel(db: Session, rule: models.ScenarioRule) -> List[models.Assessment]:
    """
    Check all units for personnel availability ratio below threshold.
    Params: {"min_available_ratio": 0.5}
    """
    min_ratio = rule.params.get("min_available_ratio", 0.5)

    units_with_logistics = (
        db.query(models.Unit)
        .join(models.UnitLogistics, models.UnitLogistics.unit_id == models.Unit.id)
        .filter(models.UnitLogistics.personnel_total > 0)
        .all()
    )

    results = []
    for unit in units_with_logistics:
        logistics = unit.logistics
        if not logistics or logistics.personnel_total == 0:
            continue

        ratio = logistics.personnel_available / logistics.personnel_total

        if ratio >= min_ratio:
            continue

        if ratio <= 0.2:
            status = "critical"
        elif ratio < min_ratio * 0.6:
            status = "critical"
        else:
            status = "warning"

        assessment = models.Assessment(
            rule_id=rule.rule_id,
            subject_type="unit",
            subject_id=unit.id,
            severity=rule.severity,
            status=status,
            confidence=1.0,
            explanation=(
                f"Personnel availability {ratio:.0%} "
                f"({logistics.personnel_available}/{logistics.personnel_total}) "
                f"is below minimum {min_ratio:.0%}"
            ),
            data={
                "personnel_available": logistics.personnel_available,
                "personnel_total": logistics.personnel_total,
                "current_ratio": round(ratio, 4),
                "threshold_ratio": min_ratio,
                "unit_name": unit.symbol_name,
            },
        )
        results.append(assessment)

    return results


def _handle_route_too_long(db: Session, rule: models.ScenarioRule) -> List[models.Assessment]:
    """
    Check all active/draft routes for having too many points.
    Params: {"max_points": 8}
    """
    max_points = rule.params.get("max_points", 8)

    active_routes = (
        db.query(models.Route)
        .filter(models.Route.status.in_(["draft", "active"]))
        .all()
    )

    results = []
    for route in active_routes:
        point_count = (
            db.query(models.RoutePoint)
            .filter(models.RoutePoint.route_id == route.id)
            .count()
        )

        if point_count <= max_points:
            continue

        if point_count > max_points * 2:
            status = "critical"
        else:
            status = "warning"

        assessment = models.Assessment(
            rule_id=rule.rule_id,
            subject_type="route",
            subject_id=route.id,
            severity=rule.severity,
            status=status,
            confidence=1.0,
            explanation=(
                f"Route '{route.name}' has {point_count} points, "
                f"exceeding maximum of {max_points}"
            ),
            data={
                "route_name": route.name,
                "route_status": route.status,
                "point_count": point_count,
                "max_points": max_points,
                "unit_id": route.unit_id,
            },
        )
        results.append(assessment)

    return results


def _handle_low_combat_effectiveness(db: Session, rule: models.ScenarioRule) -> List[models.Assessment]:
    """
    Check units with combat effectiveness below threshold.
    Params: {"min_effectiveness": 50}
    """
    min_eff = rule.params.get("min_effectiveness", 50)

    units = (
        db.query(models.Unit)
        .join(models.UnitLogistics, models.UnitLogistics.unit_id == models.Unit.id)
        .filter(models.UnitLogistics.combat_effectiveness_percent < min_eff)
        .filter(models.UnitLogistics.combat_effectiveness_percent > 0)
        .all()
    )

    results = []
    for unit in units:
        eff = unit.logistics.combat_effectiveness_percent if unit.logistics else 0

        status = "critical" if eff < min_eff * 0.5 else "warning"

        assessment = models.Assessment(
            rule_id=rule.rule_id,
            subject_type="unit",
            subject_id=unit.id,
            severity=rule.severity,
            status=status,
            confidence=1.0,
            explanation=f"Combat effectiveness {eff:.1f}% is below minimum {min_eff}%",
            data={
                "combat_effectiveness": eff,
                "threshold": min_eff,
                "unit_name": unit.symbol_name,
            },
        )
        results.append(assessment)

    return results


def _handle_no_logistics_completed(db: Session, rule: models.ScenarioRule) -> List[models.Assessment]:
    """
    Flag units that still require logistics completion.
    """
    units = (
        db.query(models.Unit)
        .filter(models.Unit.requires_logistics_completion == True)
        .all()
    )

    results = []
    for unit in units:
        assessment = models.Assessment(
            rule_id=rule.rule_id,
            subject_type="unit",
            subject_id=unit.id,
            severity=rule.severity,
            status="warning",
            confidence=1.0,
            explanation=f"Unit '{unit.symbol_name}' has incomplete logistics data",
            data={
                "unit_name": unit.symbol_name,
                "requires_logistics_completion": True,
            },
        )
        results.append(assessment)

    return results


def _handle_bad_defensive_terrain(db: Session, rule: models.ScenarioRule) -> List[models.Assessment]:
    """
    Check units positioned on terrain with poor defense score.
    Params: {"min_defense_score": 0.3}
    """
    min_defense = rule.params.get("min_defense_score", 0.3)

    # Get latest terrain assessment for each unit
    from sqlalchemy import func
    subq = (
        db.query(
            models.TerrainAssessment.unit_id,
            func.max(models.TerrainAssessment.created_at).label("latest"),
        )
        .group_by(models.TerrainAssessment.unit_id)
        .subquery()
    )

    latest_assessments = (
        db.query(models.TerrainAssessment)
        .join(
            subq,
            (models.TerrainAssessment.unit_id == subq.c.unit_id)
            & (models.TerrainAssessment.created_at == subq.c.latest),
        )
        .filter(models.TerrainAssessment.defense_score < min_defense)
        .all()
    )

    results = []
    for ta in latest_assessments:
        unit = db.query(models.Unit).filter(models.Unit.id == ta.unit_id).first()
        if not unit:
            continue

        status = "critical" if ta.defense_score < min_defense * 0.5 else "warning"

        assessment = models.Assessment(
            rule_id=rule.rule_id,
            subject_type="unit",
            subject_id=unit.id,
            severity=rule.severity,
            status=status,
            confidence=0.8,
            explanation=(
                f"Unit '{unit.symbol_name}' on {ta.terrain_type} terrain "
                f"with defense score {ta.defense_score:.2f} (min: {min_defense:.2f})"
            ),
            data={
                "defense_score": ta.defense_score,
                "terrain_type": ta.terrain_type,
                "elevation_m": ta.elevation_m,
                "unit_name": unit.symbol_name,
            },
        )
        results.append(assessment)

    return results


# ═══════════════════════════════════════════════════════════════════════
#  Handler Registry
# ═══════════════════════════════════════════════════════════════════════

RULE_HANDLERS = {
    "low_fuel": _handle_low_fuel,
    "low_personnel": _handle_low_personnel,
    "route_too_long": _handle_route_too_long,
    "low_combat_effectiveness": _handle_low_combat_effectiveness,
    "no_logistics_completed": _handle_no_logistics_completed,
    "bad_defensive_terrain": _handle_bad_defensive_terrain,
}
