"""
FastAPI application for Fall Detection System
"""

import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from .config import EXPOSE_DOCS, CORS_ORIGINS

# Create FastAPI app
app = FastAPI(
    title="Fall Detection API",
    description="API for AI-powered fall detection system",
    version="2.0.0",
    docs_url="/docs" if EXPOSE_DOCS else None,
    redoc_url="/redoc" if EXPOSE_DOCS else None,
    openapi_url="/openapi.json" if EXPOSE_DOCS else None
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create database tables
from .database import init_db
init_db()

# Import routes
try:
    from .routes import auth, main as api_routes, admin
    from .realtime import router as realtime_router
    from .services.mqtt_service import start_mqtt_service
    
    app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(api_routes.router, prefix="/api/v1", tags=["api"])
    app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
    app.include_router(realtime_router, tags=["realtime"])
    
    logger.info("✅ Routes loaded successfully")
    
except ImportError as e:
    logger.error(f"❌ Failed to load routes: {e}")

# Start MQTT listener (optional)
@app.on_event("startup")
async def _startup_mqtt() -> None:
    try:
        start_mqtt_service()
    except Exception as exc:
        logger.error("MQTT startup failed: %s", exc)

# Health check endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "fall_detection_api",
        "version": "2.0.0"
    }

# Root endpoint
@app.get("/")
async def root():
    return {
        "message": "Welcome to Fall Detection API",
        "version": "2.0.0",
        "docs": "/docs",
        "health": "/health"
    }

@app.get("/api")
async def api_root():
    return {
        "name": "Fall Detection API",
        "version": "2.0.0",
        "endpoints": {
            "v1": "/api/v1",
            "docs": "/docs",
            "health": "/health"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

# Serve admin dashboard (static)
ADMIN_UI_DIR = Path(__file__).resolve().parent / "admin_ui"
if ADMIN_UI_DIR.exists():
    app.mount("/admin", StaticFiles(directory=ADMIN_UI_DIR, html=True), name="admin")
