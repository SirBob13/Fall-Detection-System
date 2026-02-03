"""
Device Authentication Middleware
"""

import hashlib
import hmac
import time
import secrets
from typing import Optional
from fastapi import HTTPException, status, Request
from sqlalchemy.orm import Session
import jwt

from .config import SECRET_KEY, ALGORITHM
from .database import get_db

class DeviceAuth:
    def __init__(self):
        self.device_tokens = {}
    
    def generate_device_token(self, device_id: str, user_id: int) -> str:
        """Generate a secure device token"""
        payload = {
            "device_id": device_id,
            "user_id": user_id,
            "exp": int(time.time()) + 2592000,  # 30 days
            "iat": int(time.time()),
            "jti": secrets.token_hex(16)
        }
        
        token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
        self.device_tokens[device_id] = token
        return token
    
    def verify_device_token(self, token: str, device_id: str) -> bool:
        """Verify device token"""
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            
            # Check if token matches device
            if payload.get("device_id") != device_id:
                return False
            
            # Check expiration
            if payload.get("exp", 0) < int(time.time()):
                return False
            
            return True
            
        except jwt.ExpiredSignatureError:
            return False
        except jwt.InvalidTokenError:
            return False
    
    def require_device_auth(self, request: Request, db: Session):
        """Middleware for device authentication"""
        device_id = request.headers.get("X-Device-ID")
        device_token = request.headers.get("X-Device-Token")
        
        if not device_id or not device_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Device authentication required"
            )
        
        if not self.verify_device_token(device_token, device_id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid device token"
            )
        
        # Get device from database
        from .models import Device
        device = db.query(Device).filter(Device.device_id == device_id).first()
        
        if not device or not device.is_connected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Device not registered or offline"
            )
        
        return device

# Create global instance
device_auth = DeviceAuth()