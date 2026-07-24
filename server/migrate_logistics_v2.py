"""
Migration v2: logistics sub-types (tanks, IFV, armored artillery, mortars)
and rename personnel_missing → personnel_dead.

Run once against the target database:
    python migrate_logistics_v2.py [--db sqlite:///./app.db]
"""

import argparse
import sys
from sqlalchemy import create_engine, text


NEW_COLUMNS = [
    ("ammo_mortar",                    "INTEGER DEFAULT 0"),
    ("tanks_total",                    "INTEGER DEFAULT 0"),
    ("tanks_operational",              "INTEGER DEFAULT 0"),
    ("ifv_total",                      "INTEGER DEFAULT 0"),
    ("ifv_operational",                "INTEGER DEFAULT 0"),
    ("armored_artillery_total",        "INTEGER DEFAULT 0"),
    ("armored_artillery_operational",  "INTEGER DEFAULT 0"),
    ("mortars_total",                  "INTEGER DEFAULT 0"),
    ("mortars_operational",            "INTEGER DEFAULT 0"),
    ("personnel_dead",                 "INTEGER DEFAULT 0"),
]


def column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def migrate(db_url: str) -> None:
    engine = create_engine(db_url)

    with engine.begin() as conn:
        # 1. Add new columns (idempotent)
        for col_name, col_def in NEW_COLUMNS:
            if not column_exists(conn, "unit_logistics", col_name):
                conn.execute(text(
                    f"ALTER TABLE unit_logistics ADD COLUMN {col_name} {col_def}"
                ))
                print(f"  + added column: {col_name}")
            else:
                print(f"  ~ already exists: {col_name}")

        # 2. Copy personnel_missing → personnel_dead if old column still present
        if column_exists(conn, "unit_logistics", "personnel_missing"):
            conn.execute(text(
                "UPDATE unit_logistics SET personnel_dead = personnel_missing "
                "WHERE personnel_missing IS NOT NULL AND personnel_missing > 0"
            ))
            print("  ✓ copied personnel_missing → personnel_dead")
            # SQLite doesn't support DROP COLUMN before 3.35.
            # For PostgreSQL we can drop; for SQLite just leave it (it won't be used).
            try:
                conn.execute(text(
                    "ALTER TABLE unit_logistics DROP COLUMN personnel_missing"
                ))
                print("  ✓ dropped column: personnel_missing")
            except Exception:
                print("  ~ could not drop personnel_missing (SQLite < 3.35) — column left in place")

    print("\nMigration v2 complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run logistics v2 migration")
    parser.add_argument("--db", default="sqlite:///./app.db",
                        help="SQLAlchemy database URL (default: sqlite:///./app.db)")
    args = parser.parse_args()
    migrate(args.db)
