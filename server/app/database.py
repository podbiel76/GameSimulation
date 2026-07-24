import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

# ── Load .env if python-dotenv is available ─────────────────────────
try:
    from dotenv import load_dotenv
    # Walk up to find .env at project root
    _env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    if os.path.exists(_env_path):
        load_dotenv(_env_path)
except ImportError:
    pass

# ── Database Configuration ──────────────────────────────────────────
# Supports both SQLite (default) and PostgreSQL+PostGIS
# Set DATABASE_URL env var to switch:
#   postgresql+psycopg2://geotactical:geotactical@localhost:5432/geotactical

_default_db_path = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "geotactical.db")
)
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{_default_db_path}",
)

IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
    # Enable WAL mode for better concurrent reads
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
