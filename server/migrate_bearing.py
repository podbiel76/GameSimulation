"""
Script to add bearing_deg and coordinates columns to unit_areas table.
"""
import os
import sys
from sqlalchemy import text

# Add parent dir so we can import the app package
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load .env
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        load_dotenv(env_path)
except ImportError:
    pass

from app.database import engine

def migrate():
    print("Connecting to database...")
    with engine.connect() as conn:
        print("Adding bearing_deg column...")
        try:
            conn.execute(text("ALTER TABLE unit_areas ADD COLUMN IF NOT EXISTS bearing_deg double precision DEFAULT 0.0;"))
            conn.commit()
            print("OK: bearing_deg added.")
        except Exception as e:
            print(f"Error adding bearing_deg: {e}")

        print("Adding coordinates column...")
        try:
            conn.execute(text("ALTER TABLE unit_areas ADD COLUMN IF NOT EXISTS coordinates json;"))
            conn.commit()
            print("OK: coordinates added.")
        except Exception as e:
            print(f"Error adding coordinates: {e}")

    print("\nMigration complete!")

if __name__ == "__main__":
    migrate()
