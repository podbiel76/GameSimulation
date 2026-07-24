"""Add base_speed_kmh column to units table."""
import sqlite3
import os

try:
    import psycopg2
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False


def migrate_sqlite():
    db_path = os.path.join(os.path.dirname(__file__), 'geotactical.db')
    if not os.path.exists(db_path):
        print(f"Baza danych SQLite {db_path} nie istnieje. Pomijam migrację SQLite.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("ALTER TABLE units ADD COLUMN base_speed_kmh REAL;")
        print("Kolumna base_speed_kmh została pomyślnie dodana (SQLite).")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e).lower():
            print("Kolumna base_speed_kmh już istnieje (SQLite).")
        else:
            print(f"Błąd SQLite: {e}")
    finally:
        conn.commit()
        conn.close()


def migrate_postgres():
    if not HAS_PSYCOPG2:
        print("psycopg2 niedostępny. Pomijam migrację PostgreSQL.")
        return
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("Brak DATABASE_URL. Pomijam migrację PostgreSQL.")
        return

    try:
        conn = psycopg2.connect(db_url)
        cursor = conn.cursor()
        cursor.execute("ALTER TABLE units ADD COLUMN base_speed_kmh FLOAT;")
        conn.commit()
        print("Kolumna base_speed_kmh została pomyślnie dodana (PostgreSQL).")
        cursor.close()
        conn.close()
    except Exception as e:
        if "already exists" in str(e).lower():
            print("Kolumna base_speed_kmh już istnieje (PostgreSQL).")
        else:
            print(f"Błąd PostgreSQL: {e}")


if __name__ == "__main__":
    print("Rozpoczynam migrację bazy danych dla base_speed_kmh...")
    migrate_sqlite()
    migrate_postgres()
    print("Migracja zakończona.")
