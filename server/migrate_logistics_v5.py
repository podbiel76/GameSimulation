"""
Migration v5: drop maintenance_status and comms_status columns.

Removed fields: maintenance_status, comms_status
(vehicle technical status and C2/comms status removed from the simulation
 and all potential calculations)

Działa zarówno na SQLite (3.35+) jak i PostgreSQL — używa Inspectora
zamiast PRAGMA, a domyślnie korzysta z tego samego DATABASE_URL co aplikacja
(zmienna środowiskowa / .env). URL można nadpisać flagą --db.

Run once (z katalogu server/):
    python migrate_logistics_v5.py [--db <SQLAlchemy URL>]
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine, inspect, text

from app.database import DATABASE_URL as APP_DATABASE_URL

COLS_TO_DROP = [
    "maintenance_status",
    "comms_status",
]

TABLE = "unit_logistics"


def column_exists(engine, table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {col["name"] for col in inspector.get_columns(table)}


def migrate(db_url: str) -> None:
    engine = create_engine(db_url)
    print(f"Database: {engine.url.render_as_string(hide_password=True)}")

    with engine.begin() as conn:
        for col in COLS_TO_DROP:
            if not column_exists(engine, TABLE, col):
                print(f"  ~ already gone: {col}")
                continue
            try:
                conn.execute(text(f'ALTER TABLE {TABLE} DROP COLUMN {col}'))
                print(f"  + dropped: {col}")
            except Exception as e:
                print(f"  ! could not drop {col}: {e}")

    print("\nMigration v5 complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run logistics v5 migration")
    parser.add_argument(
        "--db",
        default=APP_DATABASE_URL,
        help="SQLAlchemy database URL (default: aplikacyjny DATABASE_URL)",
    )
    args = parser.parse_args()
    migrate(args.db)
