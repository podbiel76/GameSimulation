from sqlalchemy import create_engine, text
import os
import sys

# Add server directory to path to import app.database
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

try:
    from app.database import DATABASE_URL
    print(f"Connecting to: {DATABASE_URL}")
    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE units ADD COLUMN unit_number INTEGER;"))
            conn.commit()
            print("Successfully added 'unit_number' column to 'units' table.")
        except Exception as e:
            if "already exists" in str(e).lower() or "duplicate column" in str(e).lower():
                print("Column 'unit_number' already exists.")
            else:
                print(f"Error adding column: {e}")
                
except ImportError:
    print("Could not import app.database. Make sure you are running from the server directory.")
except Exception as e:
    print(f"An unexpected error occurred: {e}")
