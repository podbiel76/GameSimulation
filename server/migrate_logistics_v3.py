"""
Migration v3: drop obsolete logistics columns.

Removed fields: ammo_artillery, grenades, vehicles_total, vehicles_operational
(vehicles replaced by armored sub-types; artillery/grenades no longer tracked)

Run once:
    python migrate_logistics_v3.py [--db sqlite:///./app.db]
"""

import argparse
from sqlalchemy import create_engine, text

COLS_TO_DROP = [
    "ammo_artillery",
    "grenades",
    "vehicles_total",
    "vehicles_operational",
]


def column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def migrate(db_url: str) -> None:
    engine = create_engine(db_url)

    with engine.begin() as conn:
        for col in COLS_TO_DROP:
            if not column_exists(conn, "unit_logistics", col):
                print(f"  ~ already gone: {col}")
                continue
            try:
                conn.execute(text(f"ALTER TABLE unit_logistics DROP COLUMN {col}"))
                print(f"  ✓ dropped: {col}")
            except Exception as e:
                print(f"  ! could not drop {col} (SQLite < 3.35?): {e}")

    print("\nMigration v3 complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run logistics v3 migration")
    parser.add_argument("--db", default="sqlite:///./app.db",
                        help="SQLAlchemy database URL (default: sqlite:///./app.db)")
    args = parser.parse_args()
    migrate(args.db)
