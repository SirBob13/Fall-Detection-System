#!/usr/bin/env python3
"""
Alternative start script for Fall Detection System
"""

import uvicorn
import sys
import os

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("=" * 60)
    print("🚀 Starting Fall Detection API Server")
    print("=" * 60)
    print("📡 Host: 0.0.0.0")
    print("🔌 Port: 8000")
    print("📚 Docs: http://localhost:8000/docs")
    print("🏥 Health: http://localhost:8000/health")
    print("=" * 60)
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )