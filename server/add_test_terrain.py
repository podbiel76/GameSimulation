import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server.app.database import SessionLocal
from server.app.models import TerrainPolygon, HAS_GEOALCHEMY2
from geoalchemy2.elements import WKTElement

def seed_test_terrain():
    if not HAS_GEOALCHEMY2:
        print("Błąd: Moduł GeoAlchemy2 lub baza PostGIS nie są włączone.")
        return

    db = SessionLocal()
    try:
        # Tworzymy duży kwadrat (las) w celach testowych
        # Na przykład szeroki obszar gdzieś w Polsce (20.0, 52.0 to mniej więcej środek kraju / okolice W-wy)
        lon_min, lat_min = 20.0, 52.0
        lon_max, lat_max = 21.0, 53.0
        
        polygon_wkt = f"POLYGON(({lon_min} {lat_min}, {lon_max} {lat_min}, {lon_max} {lat_max}, {lon_min} {lat_max}, {lon_min} {lat_min}))"
        geom = WKTElement(polygon_wkt, srid=4326)

        # Sprawdzamy czy testowy poligon już istnieje by go nie duplikować
        existing = db.query(TerrainPolygon).filter(TerrainPolygon.name == "Testowy Las Wielki").first()
        if existing:
            print("Testowy las jest już dodany do bazy!")
            return

        test_polygon = TerrainPolygon(
            terrain_type="forest",
            name="Testowy Las Wielki",
            osm_id="test_123",
            geometry=geom
        )

        db.add(test_polygon)
        db.commit()
        print(f"Dodano 'Testowy Las Wielki' do bazy danych!")
        print(f"Postaw jednostkę w prostokącie między lon={lon_min}-{lon_max} a lat={lat_min}-{lat_max} aby przetestować!")

    except Exception as e:
        print(f"Błąd podczas dodawania terenu: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_test_terrain()
