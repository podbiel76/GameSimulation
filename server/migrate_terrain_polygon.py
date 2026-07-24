import os
import sys

# Dodanie katalogu projektu do ścieżki (aby app.database działało prawidłowo)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server.app.database import engine, Base
from server.app.models import TerrainPolygon

def migrate():
    try:
        # Tworzy tabelę TerrainPolygon używając metadanych SQLAlchemy
        TerrainPolygon.__table__.create(bind=engine, checkfirst=True)
        print("Tabela terrain_polygons została pomyślnie utworzona (jeśli nie istniała).")
    except Exception as e:
        print(f"Wystąpił błąd podczas tworzenia tabeli: {e}")

if __name__ == "__main__":
    print("Rozpoczynam migrację tworzenia tabeli terrain_polygons...")
    migrate()
    print("Migracja zakończona.")
