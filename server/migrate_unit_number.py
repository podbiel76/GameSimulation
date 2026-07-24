import sqlite3
import os

db_path = "geotactical.db"
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE units ADD COLUMN unit_number INTEGER;")
        conn.commit()
        print("Column unit_number added successfully.")
    except sqlite3.OperationalError as e:
        print(f"Error: {e}")
    finally:
        conn.close()
else:
    print(f"Database not found at {db_path}")
