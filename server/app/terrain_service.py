"""
Deterministic mock terrain assessment based on coordinates.
Structured so a real DEM (Digital Elevation Model) can be plugged in later.
"""
import math
from sqlalchemy.orm import Session
from . import models


# ═══════════════════════════════════════════════════════════════════════
#  Terrain Provider Interface
# ═══════════════════════════════════════════════════════════════════════

class TerrainProvider:
    """Base class for terrain data providers."""

    def assess(self, lon: float, lat: float) -> dict:
        raise NotImplementedError


class MockTerrainProvider(TerrainProvider):
    """
    Deterministic mock terrain based on coordinate hashing.
    Produces consistent results for the same coordinates.
    """

    TERRAIN_TYPES = ["open", "forest", "urban", "mountain", "water"]

    def assess(self, lon: float, lat: float) -> dict:
        # Deterministic hash from coordinates
        seed = abs(hash((round(lon, 4), round(lat, 4))))

        # Elevation: 50-800m, varies with latitude bands
        elevation = 50 + (math.sin(lat * 0.1) * 200 + 200) + (seed % 350)
        elevation = round(min(max(elevation, 0), 2500), 1)

        # Slope: 0-45 degrees
        slope = (seed % 450) / 10.0
        slope = round(min(slope, 45.0), 1)

        # Terrain type: deterministic from coordinate hash
        terrain_idx = seed % len(self.TERRAIN_TYPES)
        terrain_type = self.TERRAIN_TYPES[terrain_idx]

        # Cover score: depends on terrain type
        cover_map = {
            "open": 0.1,
            "forest": 0.8,
            "urban": 0.7,
            "mountain": 0.5,
            "water": 0.0,
        }
        cover_base = cover_map.get(terrain_type, 0.3)
        cover_score = round(min(max(cover_base + (seed % 20) / 100 - 0.1, 0), 1), 2)

        # Defense score: terrain + slope advantage
        defense_base = cover_score * 0.6 + min(slope / 45.0, 1) * 0.4
        defense_score = round(min(max(defense_base, 0), 1), 2)

        return {
            "elevation_m": elevation,
            "slope_deg": slope,
            "terrain_type": terrain_type,
            "cover_score": cover_score,
            "defense_score": defense_score,
        }


# Global provider instance — swap for real DEM provider later
_provider = MockTerrainProvider()


def get_terrain_provider() -> TerrainProvider:
    return _provider


def set_terrain_provider(provider: TerrainProvider):
    global _provider
    _provider = provider


# ═══════════════════════════════════════════════════════════════════════
#  Service Functions
# ═══════════════════════════════════════════════════════════════════════

def assess_terrain_at(lon: float, lat: float) -> dict:
    """Assess terrain at the given coordinates."""
    return _provider.assess(lon, lat)


def assess_unit_terrain(db: Session, unit_id: str) -> models.TerrainAssessment | None:
    """
    Assess terrain at a unit's current position.
    Creates a TerrainAssessment record and updates the unit's elevation.
    """
    unit = db.query(models.Unit).filter(models.Unit.id == unit_id).first()
    if not unit:
        return None

    # Use position_lon/lat if available, otherwise x/y
    lon = unit.position_lon or unit.x
    lat = unit.position_lat or unit.y

    assessment_data = assess_terrain_at(lon, lat)

    # Create assessment record
    db_assessment = models.TerrainAssessment(
        unit_id=unit_id,
        **assessment_data,
    )
    db.add(db_assessment)

    # Update unit elevation
    unit.current_elevation_m = assessment_data["elevation_m"]

    db.commit()
    db.refresh(db_assessment)
    return db_assessment


def assess_position_terrain(lon: float, lat: float) -> dict:
    """Quick terrain assessment without creating a database record."""
    return assess_terrain_at(lon, lat)


def get_terrain_type_at_position(db: Session, lon: float, lat: float) -> str:
    """
    Check which TerrainPolygon the point (lon, lat) intersects with.
    Uses PostGIS/GeoAlchemy2 ST_Intersects.
    Returns the terrain_type or 'open' if no polygon matches or if PostGIS is not available.
    """
    if not models.HAS_GEOALCHEMY2:
        return "open"

    from geoalchemy2.elements import WKTElement
    from geoalchemy2.functions import ST_Intersects
    from sqlalchemy.exc import SQLAlchemyError

    try:
        point = WKTElement(f"POINT({lon} {lat})", srid=4326)
        terrain = (
            db.query(models.TerrainPolygon)
            .filter(ST_Intersects(models.TerrainPolygon.geometry, point))
            .first()
        )
        if terrain:
            return terrain.terrain_type
    except SQLAlchemyError as e:
        import logging
        logging.warning(f"Failed to query terrain polygon: {e}")

    return "open"
