"""Profil terenu jednostki z lokalnych danych rastrowych (WorldCover + Copernicus DEM)."""
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..services.terrain_data_service import (
    data_status,
    defense_radius_m,
    reload_data,
    terrain_profile,
)

router = APIRouter(prefix="/terrain", tags=["terrain"])


class TerrainProfileRequest(BaseModel):
    lon: float = Field(..., ge=-180, le=180)
    lat: float = Field(..., ge=-90, le=90)
    # Promień terenu obronnego; domyślnie potential.terrainProfile.defenseRadiusM.
    radius_m: Optional[float] = Field(None, gt=0, le=20_000)
    # Obrys AO [[lon, lat], ...] — rozkład terenu dla natarcia i manewru.
    ao: Optional[List[List[float]]] = None


@router.get("/status")
def terrain_data_status():
    """Czy dane terenu i rasterio są dostępne."""
    return data_status()


@router.post("/reload")
def terrain_data_reload():
    """Ponowny skan katalogu danych (po pobraniu nowych plików)."""
    return reload_data()


@router.post("/profile")
def unit_terrain_profile(req: TerrainProfileRequest):
    """Teren w promieniu wokół jednostki (obrona) i w jej AO (natarcie, manewr)."""
    return terrain_profile(req.lon, req.lat, req.radius_m or defense_radius_m(), req.ao)
