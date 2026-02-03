 """
Additional Middleware for Fall Detection System
"""

import time
import logging
from typing import Callable
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware
import json
from datetime import datetime
import asyncio

logger = logging.getLogger(__name__)

# ======================================
# 1. REQUEST LOGGING MIDDLEWARE
# ======================================
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Log all incoming requests and outgoing responses.
    """
    
    async def dispatch(self, request: Request, call_next: Callable):
        # Start timer
        start_time = time.time()
        
        # Extract request info
        request_id = str(start_time).replace('.', '')
        client_host = request.client.host if request.client else "unknown"
        method = request.method
        url = str(request.url)
        
        # Log incoming request
        logger.info(f"🌐 [{request_id}] {method} {url} from {client_host}")
        
        # Process request
        try:
            response = await call_next(request)
            
            # Calculate processing time
            process_time = time.time() - start_time
            
            # Log response
            status_code = response.status_code
            logger.info(
                f"✅ [{request_id}] {method} {url} -> {status_code} "
                f"({process_time:.3f}s)"
            )
            
            # Add custom headers
            response.headers["X-Process-Time"] = str(process_time)
            response.headers["X-Request-ID"] = request_id
            
            return response
            
        except Exception as e:
            # Log error
            process_time = time.time() - start_time
            logger.error(
                f"❌ [{request_id}] {method} {url} -> ERROR: {str(e)} "
                f"({process_time:.3f}s)"
            )
            raise

# ======================================
# 2. RATE LIMITING MIDDLEWARE
# ======================================
class RateLimitingMiddleware(BaseHTTPMiddleware):
    """
    Simple rate limiting middleware.
    """
    
    def __init__(self, app, max_requests_per_minute: int = 60):
        super().__init__(app)
        self.max_requests_per_minute = max_requests_per_minute
        self.requests = {}  # IP -> [timestamps]
        
    async def dispatch(self, request: Request, call_next: Callable):
        # Skip rate limiting for health checks
        if request.url.path in ["/health", "/docs", "/redoc", "/openapi.json"]:
            return await call_next(request)
        
        client_ip = request.client.host if request.client else "unknown"
        current_time = time.time()
        
        # Clean old requests (older than 1 minute)
        if client_ip in self.requests:
            self.requests[client_ip] = [
                t for t in self.requests[client_ip]
                if current_time - t < 60
            ]
        
        # Check rate limit
        if client_ip in self.requests:
            request_count = len(self.requests[client_ip])
            if request_count >= self.max_requests_per_minute:
                logger.warning(f"⚠️ Rate limit exceeded for IP: {client_ip}")
                return Response(
                    content=json.dumps({
                        "error": "Rate limit exceeded",
                        "message": "Too many requests. Please try again later."
                    }),
                    status_code=429,
                    media_type="application/json"
                )
        
        # Add current request
        if client_ip not in self.requests:
            self.requests[client_ip] = []
        self.requests[client_ip].append(current_time)
        
        # Process request
        return await call_next(request)

# ======================================
# 3. REQUEST VALIDATION MIDDLEWARE
# ======================================
class RequestValidationMiddleware(BaseHTTPMiddleware):
    """
    Validate incoming requests for common issues.
    """
    
    async def dispatch(self, request: Request, call_next: Callable):
        # Check content type for POST/PUT requests
        if request.method in ["POST", "PUT", "PATCH"]:
            content_type = request.headers.get("content-type", "")
            if not content_type.startswith("application/json"):
                logger.warning(f"⚠️ Invalid content-type: {content_type}")
                return Response(
                    content=json.dumps({
                        "error": "Invalid content type",
                        "message": "Only application/json is supported"
                    }),
                    status_code=415,
                    media_type="application/json"
                )
        
        # Check for missing required headers
        if request.url.path.startswith("/api/"):
            # Add custom validation for API routes
            if "X-Device-ID" not in request.headers and "device_id" not in request.query_params:
                logger.warning(f"⚠️ Missing device identification")
                # Don't block, just warn (adjust based on your needs)
        
        # Process request
        return await call_next(request)

# ======================================
# 4. PERFORMANCE MONITORING MIDDLEWARE
# ======================================
class PerformanceMonitoringMiddleware(BaseHTTPMiddleware):
    """
    Monitor performance and log slow requests.
    """
    
    def __init__(self, app, slow_request_threshold: float = 1.0):
        super().__init__(app)
        self.slow_request_threshold = slow_request_threshold
        
    async def dispatch(self, request: Request, call_next: Callable):
        start_time = time.time()
        
        # Process request
        response = await call_next(request)
        
        # Calculate processing time
        process_time = time.time() - start_time
        
        # Log slow requests
        if process_time > self.slow_request_threshold:
            logger.warning(
                f"🐌 Slow request detected: {request.method} {request.url.path} "
                f"took {process_time:.3f}s (threshold: {self.slow_request_threshold}s)"
            )
        
        # Add performance headers
        response.headers["X-Response-Time"] = f"{process_time:.3f}s"
        
        return response

# ======================================
# 5. SECURITY HEADERS MIDDLEWARE
# ======================================
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Add security headers to all responses.
    """
    
    async def dispatch(self, request: Request, call_next: Callable):
        response = await call_next(request)
        
        # Add security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        
        # For production, add HSTS header
        # response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        
        return response

# ======================================
# 6. ERROR HANDLING MIDDLEWARE
# ======================================
class ErrorHandlingMiddleware(BaseHTTPMiddleware):
    """
    Global error handling middleware.
    """
    
    async def dispatch(self, request: Request, call_next: Callable):
        try:
            return await call_next(request)
            
        except Exception as e:
            logger.error(f"🔥 Unhandled exception: {str(e)}", exc_info=True)
            
            # Return consistent error response
            return Response(
                content=json.dumps({
                    "success": False,
                    "error": "Internal server error",
                    "message": "An unexpected error occurred",
                    "timestamp": datetime.now().isoformat(),
                    "path": str(request.url.path)
                }),
                status_code=500,
                media_type="application/json"
            )

# ======================================
# 7. DEVICE AUTHENTICATION MIDDLEWARE
# ======================================
class DeviceAuthenticationMiddleware(BaseHTTPMiddleware):
    """
    Middleware for device authentication.
    Requires device token for API endpoints.
    """
    
    def __init__(self, app, exclude_paths=None):
        super().__init__(app)
        self.exclude_paths = exclude_paths or [
            "/health",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/api/v1/auth/login",
            "/api/v1/auth/register",
            "/api/v1/auth/check-email"
        ]
    
    async def dispatch(self, request: Request, call_next: Callable):
        # Skip authentication for excluded paths
        if any(request.url.path.startswith(path) for path in self.exclude_paths):
            return await call_next(request)
        
        # Check if this is an API endpoint
        if request.url.path.startswith("/api/v1"):
            # Extract device info
            device_id = request.headers.get("X-Device-ID")
            device_token = request.headers.get("X-Device-Token")
            
            # For motion endpoints, require device authentication
            if request.url.path.startswith("/api/v1/motion"):
                if not device_id or not device_token:
                    logger.warning(f"⚠️ Missing device auth for motion endpoint")
                    return Response(
                        content=json.dumps({
                            "success": False,
                            "error": "Device authentication required",
                            "message": "X-Device-ID and X-Device-Token headers are required"
                        }),
                        status_code=401,
                        media_type="application/json"
                    )
                
                # TODO: Validate device token against database
                # This would be implemented with your device_auth service
                # For now, we'll just log and continue
                logger.info(f"📱 Device request from: {device_id}")
            
        # Process request
        return await call_next(request)

# ======================================
# 8. COMPRESSION MIDDLEWARE (Already in FastAPI)
# Use: app.add_middleware(GZipMiddleware, minimum_size=1000)
# ======================================

# ======================================
# HELPER FUNCTIONS FOR SETTING UP MIDDLEWARE
# ======================================
def setup_security_middleware(app: FastAPI):
    """
    Set up security-related middleware.
    """
    # Add CORS middleware (already in main.py, but can be configured here)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # In production, specify exact origins
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Response-Time", "X-Process-Time"]
    )
    
    # Add security headers
    app.add_middleware(SecurityHeadersMiddleware)
    
    # Add trusted host middleware (for production)
    # app.add_middleware(
    #     TrustedHostMiddleware,
    #     allowed_hosts=["falldetection.com", "api.falldetection.com"]
    # )
    
    # Add HTTPS redirect (for production with SSL)
    # app.add_middleware(HTTPSRedirectMiddleware)

def setup_performance_middleware(app: FastAPI):
    """
    Set up performance monitoring middleware.
    """
    # Add request logging
    app.add_middleware(RequestLoggingMiddleware)
    
    # Add performance monitoring
    app.add_middleware(PerformanceMonitoringMiddleware, slow_request_threshold=0.5)
    
    # Add compression for large responses
    app.add_middleware(GZipMiddleware, minimum_size=1000)

def setup_validation_middleware(app: FastAPI):
    """
    Set up request validation middleware.
    """
    # Add request validation
    app.add_middleware(RequestValidationMiddleware)
    
    # Add error handling
    app.add_middleware(ErrorHandlingMiddleware)

def setup_device_auth_middleware(app: FastAPI):
    """
    Set up device authentication middleware.
    """
    app.add_middleware(DeviceAuthenticationMiddleware)

def setup_rate_limiting_middleware(app: FastAPI, max_requests_per_minute: int = 60):
    """
    Set up rate limiting middleware.
    """
    app.add_middleware(RateLimitingMiddleware, max_requests_per_minute=max_requests_per_minute)

def setup_all_middleware(app: FastAPI, environment: str = "development"):
    """
    Set up all middleware based on environment.
    
    Args:
        app: FastAPI application
        environment: "development" or "production"
    """
    logger.info(f"🔧 Setting up middleware for {environment} environment")
    
    # Always setup these middlewares
    setup_security_middleware(app)
    setup_validation_middleware(app)
    setup_device_auth_middleware(app)
    
    if environment == "production":
        # Production settings
        setup_rate_limiting_middleware(app, max_requests_per_minute=100)
        setup_performance_middleware(app)
        
        # Add session middleware for production
        app.add_middleware(
            SessionMiddleware,
            secret_key="your-secret-key-change-in-production",
            session_cookie="falldetection_session",
            max_age=86400,  # 1 day
            same_site="lax",
            https_only=True  # In production
        )
        
    else:
        # Development settings (more permissive)
        setup_rate_limiting_middleware(app, max_requests_per_minute=1000)
        
        # Development session middleware
        app.add_middleware(
            SessionMiddleware,
            secret_key="dev-secret-key",
            session_cookie="falldetection_session_dev",
            max_age=86400
        )
    
    logger.info("✅ Middleware setup complete")

# ======================================
# TESTING AND DEBUGGING
# ======================================
class DebugMiddleware(BaseHTTPMiddleware):
    """
    Debug middleware for development.
    Logs detailed request/response information.
    """
    
    async def dispatch(self, request: Request, call_next: Callable):
        # Log detailed request info
        logger.debug(f"🔍 REQUEST DETAILS:")
        logger.debug(f"  Method: {request.method}")
        logger.debug(f"  URL: {request.url}")
        logger.debug(f"  Headers: {dict(request.headers)}")
        logger.debug(f"  Client: {request.client}")
        
        # Log body for POST/PUT requests (if small)
        if request.method in ["POST", "PUT", "PATCH"]:
            try:
                body = await request.body()
                if len(body) < 1000:  # Don't log large bodies
                    logger.debug(f"  Body: {body.decode()}")
            except:
                pass
        
        # Process request
        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time
        
        # Log response info
        logger.debug(f"🔍 RESPONSE DETAILS:")
        logger.debug(f"  Status: {response.status_code}")
        logger.debug(f"  Headers: {dict(response.headers)}")
        logger.debug(f"  Time: {process_time:.3f}s")
        
        return response

# Example of how to use in main.py:
"""
# In your main.py file:
from app.middleware import setup_all_middleware

app = FastAPI()

# Setup middleware
setup_all_middleware(app, environment="development")  # or "production"

# Or setup individual middleware:
# from app.middleware import (
#     RequestLoggingMiddleware,
#     RateLimitingMiddleware,
#     DeviceAuthenticationMiddleware
# )
# 
# app.add_middleware(RequestLoggingMiddleware)
# app.add_middleware(RateLimitingMiddleware, max_requests_per_minute=60)
# app.add_middleware(DeviceAuthenticationMiddleware)
"""

# ======================================
# CUSTOM MIDDLEWARE FOR FALL DETECTION SPECIFIC LOGIC
# ======================================
class FallDetectionMetricsMiddleware(BaseHTTPMiddleware):
    """
    Middleware to track fall detection specific metrics.
    """
    
    def __init__(self, app):
        super().__init__(app)
        self.fall_detections = 0
        self.alerts_generated = 0
        self.requests_processed = 0
    
    async def dispatch(self, request: Request, call_next: Callable):
        # Track all requests
        self.requests_processed += 1
        
        # Process request
        response = await call_next(request)
        
        # Check if this was a motion endpoint with fall detection
        if request.url.path == "/api/v1/motion" and request.method == "POST":
            try:
                # Note: In real implementation, you'd parse the response
                # or check database for fall detections
                pass
            except:
                pass
        
        # Add metrics to response headers (for monitoring)
        response.headers["X-Fall-Detections"] = str(self.fall_detections)
        response.headers["X-Alerts-Generated"] = str(self.alerts_generated)
        response.headers["X-Requests-Processed"] = str(self.requests_processed)
        
        return response
    
    def increment_fall_detections(self):
        """Increment fall detection counter."""
        self.fall_detections += 1
    
    def increment_alerts(self):
        """Increment alert counter."""
        self.alerts_generated += 1

# Export all middleware classes
__all__ = [
    "RequestLoggingMiddleware",
    "RateLimitingMiddleware",
    "RequestValidationMiddleware",
    "PerformanceMonitoringMiddleware",
    "SecurityHeadersMiddleware",
    "ErrorHandlingMiddleware",
    "DeviceAuthenticationMiddleware",
    "DebugMiddleware",
    "FallDetectionMetricsMiddleware",
    "setup_all_middleware",
    "setup_security_middleware",
    "setup_performance_middleware",
    "setup_validation_middleware",
    "setup_device_auth_middleware",
    "setup_rate_limiting_middleware",
]