"""
One-shot migration: fix stale default values introduced by the old schema.

Changes applied to unit_logistics rows:
  - combat_effectiveness_percent = 0.0  →  100.0  (was zeroed by bad default)
  - maintenance_status = 'nominal'      →  'operational'  (unrecognised status)

Run once after deploying the schema/model fix:
    python server/migrate_combat_effectiveness.py
"""

import os
import sys

# Allow running from repo root or from server/
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from app.database import SessionLocal, engine
from app.models import Base, UnitLogistics
from sqlalchemy import text

def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Fix zeroed combat_effectiveness_percent
        result_ce = db.execute(
            text(
                "UPDATE unit_logistics "
                "SET combat_effectiveness_percent = 100.0 "
                "WHERE combat_effectiveness_percent = 0.0"
            )
        )
        # Fix unrecognised maintenance_status 'nominal'
        result_maint = db.execute(
            text(
                "UPDATE unit_logistics "
                "SET maintenance_status = 'operational' "
                "WHERE maintenance_status = 'nominal'"
            )
        )
        db.commit()
        print(f"[OK] combat_effectiveness_percent fixed: {result_ce.rowcount} rows")
        print(f"[OK] maintenance_status 'nominal' fixed: {result_maint.rowcount} rows")
    except Exception as exc:
        db.rollback()
        print(f"[ERROR] Migration failed: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    run()
