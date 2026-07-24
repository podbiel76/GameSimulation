from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import engine, Base
from .routes import units, detect, scenario, hierarchy, geojson, map_routes, logistics, terrain

# Create database tables
Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize YOLO on startup
    detect.init_yolo()
    yield
    # Cleanup if needed

app = FastAPI(title="GeoTactical Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scenario.router, prefix="/api")
app.include_router(units.router, prefix="/api")
app.include_router(detect.router, prefix="/api")
app.include_router(hierarchy.router, prefix="")
app.include_router(geojson.router, prefix="/api")
app.include_router(map_routes.router, prefix="")
app.include_router(logistics.router, prefix="")
app.include_router(terrain.router, prefix="")

@app.get("/")
def root():
    return {"message": "GeoTactical API running."}
