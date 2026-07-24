"""
Seed script: Creates example simulation data in the Warsaw region.
Run from the server/ directory:
  python seed_simulation.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal, engine, Base
from app.models import (
    Unit, UnitLogistics, Route, RoutePoint, UnitTrack, UnitState,
    ScenarioRule, generate_uuid, utc_now,
)

# Ensure tables exist
Base.metadata.create_all(bind=engine)

db = SessionLocal()

print("Clearing old simulation data...")
db.query(UnitState).delete()
db.query(UnitTrack).delete()
db.query(RoutePoint).delete()
db.query(Route).delete()
db.query(ScenarioRule).delete()
from app.models import Assessment
db.query(Assessment).delete()
db.query(UnitLogistics).delete()
db.query(Unit).delete()
db.commit()

# ═══════════════════════════════════════════════════════════════════════
#  Warsaw-area coordinates (EPSG:3857)
#
#  The existing map uses EPSG:3857 for manually placed markers.
#  Warsaw center ≈ (2_339_000, 6_862_000)
# ═══════════════════════════════════════════════════════════════════════

UNITS_DATA = [
    {
        "name": "1. Batalion Zmechanizowany",
        "symbol_id": "Land_unit__Armored_Mechanized_Tracked__Battalion_Squadron",
        "side": "friendly",
        "x": 2_330_000,   # Legionowo area
        "y": 6_875_000,
        "logistics": {
            "personnel_total": 450,
            "personnel_available": 420,
            "personnel_wounded": 20,
            "personnel_dead": 10,
            "ammo_small_arms": 8000,
            "ammo_at": 120,
            "ammo_mortar": 400,
            "tanks_total": 20,
            "tanks_operational": 18,
            "ifv_total": 20,
            "ifv_operational": 18,
            "mortars_total": 6,
            "mortars_operational": 6,
            "fuel_liters": 2500.0,
            "drones_total": 4,
            "drones_available": 3,
        },
        "route_name": "Legionowo -> Warszawa Centrum",
        "route_points": [
            (2_332_000, 6_872_000),
            (2_334_000, 6_869_000),
            (2_336_000, 6_866_000),
            (2_338_000, 6_863_000),
            (2_339_000, 6_862_000),
        ],
    },
    {
        "name": "2. Kompania Rozpoznawcza",
        "symbol_id": "Land_unit__Combined_Arms__Company_Battery_Troop",
        "side": "friendly",
        "x": 2_355_000,   # Wolomin area
        "y": 6_870_000,
        "logistics": {
            "personnel_total": 120,
            "personnel_available": 110,
            "personnel_wounded": 5,
            "personnel_dead": 5,
            "ammo_small_arms": 3000,
            "ammo_at": 40,
            "ammo_mortar": 0,
            "ifv_total": 12,
            "ifv_operational": 11,
            "fuel_liters": 15.0,     # LOW FUEL - should trigger alert
            "drones_total": 6,
            "drones_available": 5,
        },
        "route_name": "Wolomin -> Radzymin -> Modlin",
        "route_points": [
            (2_357_000, 6_873_000),
            (2_359_000, 6_876_000),
            (2_355_000, 6_879_000),
            (2_345_000, 6_882_000),
            (2_330_000, 6_884_000),
            (2_315_000, 6_883_000),
            (2_302_000, 6_880_000),
        ],
    },
    {
        "name": "3. Pancerny Oddz. Szturmowy",
        "symbol_id": "EN_Land_unit__Armored__Brigade",
        "side": "hostile",
        "x": 2_360_000,   # East of Warsaw
        "y": 6_858_000,
        "logistics": {
            "personnel_total": 200,
            "personnel_available": 60,   # Very low ratio - should trigger alert
            "personnel_wounded": 80,
            "personnel_dead": 60,
            "ammo_small_arms": 4000,
            "ammo_at": 200,
            "ammo_mortar": 100,
            "tanks_total": 20,
            "tanks_operational": 8,
            "fuel_liters": 800.0,
            "drones_total": 2,
            "drones_available": 1,
        },
        "route_name": "Atak na Prage",
        "route_points": [
            (2_356_000, 6_859_000),
            (2_352_000, 6_860_000),
            (2_348_000, 6_861_000),
            (2_344_000, 6_862_000),
            (2_341_000, 6_862_500),
        ],
    },
    {
        "name": "4. Artyleria Polowa",
        "symbol_id": "EN_Land_unit__Field_Artillery__Regiment_Group",
        "side": "hostile",
        "x": 2_370_000,   # Far east
        "y": 6_850_000,
        "logistics": {
            "personnel_total": 100,
            "personnel_available": 90,
            "personnel_wounded": 5,
            "personnel_dead": 5,
            "ammo_small_arms": 1500,
            "ammo_at": 20,
            "ammo_mortar": 500,
            "armored_artillery_total": 15,
            "armored_artillery_operational": 14,
            "mortars_total": 6,
            "mortars_operational": 6,
            "fuel_liters": 1200.0,
            "drones_total": 3,
            "drones_available": 3,
        },
        "route_name": "Wsparcie ogniowe - pozycja",
        "route_points": [
            (2_366_000, 6_852_000),
            (2_362_000, 6_854_000),
            (2_358_000, 6_856_000),
        ],
    },
]

# ═══════════════════════════════════════════════════════════════════════
#  Create units, logistics, routes, route points
# ═══════════════════════════════════════════════════════════════════════

created_units = []

for u_data in UNITS_DATA:
    # Unit
    unit = Unit(
        symbol_id=u_data["symbol_id"],
        symbol_name=u_data["name"],
        side=u_data["side"],
        x=u_data["x"],
        y=u_data["y"],
        source="manual",
    )
    db.add(unit)
    db.flush()

    # Logistics
    logi = UnitLogistics(unit_id=unit.id, **u_data["logistics"])
    db.add(logi)

    # Route (active)
    route = Route(
        unit_id=unit.id,
        name=u_data["route_name"],
        status="active",
    )
    db.add(route)
    db.flush()

    # Route points
    for idx, (px, py) in enumerate(u_data["route_points"]):
        rp = RoutePoint(
            route_id=route.id,
            order_index=idx,
            x=px,
            y=py,
        )
        db.add(rp)

    # Track (active)
    track = UnitTrack(
        unit_id=unit.id,
        status="active",
        confidence=1.0,
    )
    db.add(track)
    db.flush()

    # Initial state
    state = UnitState(
        track_id=track.id,
        x=u_data["x"],
        y=u_data["y"],
        heading=0.0,
        speed=0.0,
        source="manual",
    )
    db.add(state)

    created_units.append(unit)
    print(f"  ✅ {u_data['name']} → route: {len(u_data['route_points'])} points")

# ═══════════════════════════════════════════════════════════════════════
#  Scenario Rules
# ═══════════════════════════════════════════════════════════════════════

rules_data = [
    {
        "rule_id": "low_fuel",
        "name": "Niski poziom paliwa",
        "rule_type": "low_fuel",
        "severity": "warning",
        "params": {"min_fuel_liters": 20},
        "enabled": True,
    },
    {
        "rule_id": "low_personnel",
        "name": "Niski stan osobowy",
        "rule_type": "low_personnel",
        "severity": "critical",
        "params": {"min_available_ratio": 0.5},
        "enabled": True,
    },
    {
        "rule_id": "route_too_long",
        "name": "Zbyt długa trasa",
        "rule_type": "route_too_long",
        "severity": "warning",
        "params": {"max_points": 6},
        "enabled": True,
    },
]

for r_data in rules_data:
    existing = db.query(ScenarioRule).filter(ScenarioRule.rule_id == r_data["rule_id"]).first()
    if not existing:
        rule = ScenarioRule(**r_data)
        db.add(rule)
        print(f"  📋 Rule: {r_data['name']}")
    else:
        print(f"  📋 Rule: {r_data['name']} (already exists)")

db.commit()

# ═══════════════════════════════════════════════════════════════════════
#  Run rules to generate initial assessments
# ═══════════════════════════════════════════════════════════════════════

from app.rules_service import run_all_rules

assessments = run_all_rules(db)
print(f"\n⚠  Generated {len(assessments)} initial assessments:")
for a in assessments:
    print(f"    {a.severity.upper()} | {a.rule_id} | {a.explanation}")

print(f"""
════════════════════════════════════════════════
  ✅ Seed complete!

  Units:       {len(created_units)}
  Rules:       {len(rules_data)}
  Assessments: {len(assessments)}

  Start backend:  uvicorn app.main:app --port 3002
  Start frontend: npm run dev
  Then click "Symulacja backend → ON" and "Step All"
════════════════════════════════════════════════
""")

db.close()
