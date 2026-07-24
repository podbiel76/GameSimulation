import os
from sqlalchemy import text
from app.database import engine

def migrate():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE units ADD COLUMN custom_name VARCHAR;"))
            conn.commit()
            print("Kolumna custom_name została pomyślnie dodana do bazy danych.")
        except Exception as e:
            if "already exists" in str(e).lower() or "duplicate column name" in str(e).lower():
                print("Kolumna custom_name już istnieje w bazie danych.")
            else:
                print(f"Wystąpił błąd podczas migracji: {e}")

if __name__ == "__main__":
    print("Rozpoczynam migrację bazy danych dla custom_name...")
    migrate()
    print("Migracja zakończona.")
