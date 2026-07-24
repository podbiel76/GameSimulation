"""
GeoTactical Database Initialization Script
==========================================
Connects to PostgreSQL, enables PostGIS extension, and creates all tables.

Usage:
    cd server
    python init_db.py

Requires DATABASE_URL environment variable or .env file.
Default: postgresql+psycopg2://geotactical:geotactical@localhost:5432/geotactical
"""
import os
import sys

# Add parent dir so we can import the app package
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load .env
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"✅ Loaded .env from {os.path.abspath(env_path)}")
except ImportError:
    pass

# Set default DATABASE_URL if not set
if "DATABASE_URL" not in os.environ:
    os.environ["DATABASE_URL"] = (
        "postgresql+psycopg2://geotactical:geotactical@localhost:5432/geotactical"
    )

from sqlalchemy import text
from app.database import engine, Base

# Import all models so they register with Base.metadata
from app import models  # noqa: F401


def init_db():
    """Initialize the database: enable PostGIS, create all tables, verify."""
    db_url = os.environ.get("DATABASE_URL", "")
    print(f"🔗 Connecting to: {db_url[:60]}...")

    is_postgres = "postgresql" in db_url

    with engine.connect() as conn:
        # ── Enable PostGIS extension (PostgreSQL only) ──
        if is_postgres:
            print("📦 Enabling PostGIS extension...")
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
            conn.commit()

            # Verify PostGIS
            result = conn.execute(text("SELECT PostGIS_Version();"))
            postgis_version = result.scalar()
            print(f"✅ PostGIS version: {postgis_version}")
        else:
            print("ℹ️  SQLite mode — skipping PostGIS extension")

        # ── Verify basic connectivity ──
        result = conn.execute(text("SELECT 1"))
        assert result.scalar() == 1
        print("✅ Database connection verified")

    # ── Create all tables ──
    print("🏗️  Creating tables...")
    Base.metadata.create_all(bind=engine)

    # ── List created tables ──
    table_names = sorted(Base.metadata.tables.keys())
    print(f"✅ Created {len(table_names)} tables:")
    for name in table_names:
        print(f"   • {name}")

    print()
    print("═" * 50)
    print("✅ Database initialization complete!")
    print("═" * 50)

    if is_postgres:
        print()
        print("To verify manually:")
        print("  docker exec -it geotactical_db psql -U geotactical -d geotactical")
        print("  \\dt")
        print("  SELECT PostGIS_Version();")


if __name__ == "__main__":
    init_db()
