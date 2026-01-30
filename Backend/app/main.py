"""
FastAPI application for Fall Detection System
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Fall Detection API",
    description="API for AI-powered fall detection system",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create database tables
from .database import init_db
init_db()

# Import routes
try:
    from .routes import auth, main as api_routes
    
    app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(api_routes.router, prefix="/api/v1", tags=["api"])
    
    logger.info("✅ Routes loaded successfully")
    
except ImportError as e:
    logger.error(f"❌ Failed to load routes: {e}")

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