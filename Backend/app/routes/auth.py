"""
Authentication API Routes - FIXED VERSION WITH PROPER HTTP STATUS CODES
"""

import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Header
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import re
import bcrypt
import jwt
import httpx
from datetime import datetime, timedelta

from ..database import get_db
from ..models import User, UserAuth, SocialAccount
from ..config import (
    SECRET_KEY,
    ALGORITHM,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_IDS,
    APPLE_CLIENT_ID,
    ALLOW_UNVERIFIED_SOCIAL_LOGIN,
    ADMIN_EMAILS,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ==================== Helper Functions ====================

def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False

def extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None

def create_access_token(data: dict, expires_delta: timedelta = None):
    """Create JWT token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# ==================== Social Login Helpers ====================

APPLE_KEYS_CACHE: Dict[str, Any] = {"keys": None, "fetched_at": None}

async def fetch_apple_keys() -> Dict[str, Any]:
    """Fetch Apple public keys for token verification."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get("https://appleid.apple.com/auth/keys")
        response.raise_for_status()
        return response.json()

async def verify_google_id_token(id_token: str) -> Dict[str, Any]:
    """Verify Google ID token via tokeninfo endpoint."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token}
        )
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Google token"
            )
        data = response.json()
        allowed_audiences = []
        if GOOGLE_CLIENT_IDS:
          allowed_audiences = [aud.strip() for aud in GOOGLE_CLIENT_IDS.split(",") if aud.strip()]
        elif GOOGLE_CLIENT_ID:
          allowed_audiences = [GOOGLE_CLIENT_ID]

        if allowed_audiences and data.get("aud") not in allowed_audiences:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Google token audience mismatch"
            )
        return data

async def verify_apple_id_token(id_token: str) -> Dict[str, Any]:
    """Verify Apple ID token using Apple's public keys."""
    try:
        headers = jwt.get_unverified_header(id_token)
        kid = headers.get("kid")

        # Load cached keys
        if not APPLE_KEYS_CACHE["keys"]:
            APPLE_KEYS_CACHE["keys"] = await fetch_apple_keys()

        keys = APPLE_KEYS_CACHE["keys"].get("keys", [])
        key = next((k for k in keys if k.get("kid") == kid), None)
        if not key:
            # Refresh keys and retry once
            APPLE_KEYS_CACHE["keys"] = await fetch_apple_keys()
            keys = APPLE_KEYS_CACHE["keys"].get("keys", [])
            key = next((k for k in keys if k.get("kid") == kid), None)

        if not key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Apple public key not found"
            )

        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)

        options = {"verify_aud": bool(APPLE_CLIENT_ID)}
        payload = jwt.decode(
            id_token,
            public_key,
            algorithms=["RS256"],
            audience=APPLE_CLIENT_ID if APPLE_CLIENT_ID else None,
            issuer="https://appleid.apple.com",
            options=options
        )
        return payload
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Apple token verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Apple token"
        )

# ==================== Pydantic Models ====================

from pydantic import BaseModel

class EmailCheckRequest(BaseModel):
    email: str

class LoginRequest(BaseModel):
    email: str
    password: str

class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    weight: Optional[float] = None
    height: Optional[float] = None
    medical_conditions: Optional[str] = None
    emergency_contact: Optional[str] = None

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    password: str
    confirm_password: str

class RegisterRequest(BaseModel):
    name: str
    email: str
    phone: str = ""
    password: str
    confirm_password: str
    age: Optional[int] = None
    gender: str = "male"
    weight: Optional[float] = None
    height: Optional[float] = None
    medical_conditions: str = ""
    emergency_contact: str = ""

class SocialLoginRequest(BaseModel):
    provider: str  # google | apple
    token: str
    user_info: Dict[str, Any] = {}

# ==================== Email Verification ====================

@router.post("/check-email", response_model=Dict[str, Any])
async def check_email(
    email_data: EmailCheckRequest,
    db: Session = Depends(get_db)
):
    """Check if email exists in database"""
    try:
        email = email_data.email.lower().strip()
        
        if not email:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "message": "Email is required",
                    "exists": False
                }
            )
        
        # Validate email format
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, email):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "message": "Invalid email format",
                    "exists": False
                }
            )
        
        # Check database
        user_auth = db.query(UserAuth).filter(UserAuth.email == email).first()
        exists = user_auth is not None
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "exists": exists,
                "message": "Email exists" if exists else "Email not found"
            }
        )
        
    except Exception as e:
        logger.error(f"Error in check-email: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Email verification failed: {str(e)}"
            }
        )

# ==================== Database Status Check ====================

@router.get("/database-status", response_model=Dict[str, Any])
async def database_status(
    db: Session = Depends(get_db)
):
    """Check database connection status"""
    try:
        # Try to execute a simple query
        count = db.query(User).count()
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "connected": True,
                "user_count": count,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    except Exception as e:
        logger.error(f"Database connection error: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "success": False,
                "error": f"Database connection failed: {str(e)}",
                "connected": False
            }
        )

# ==================== User Registration ====================

@router.post("/register", response_model=Dict[str, Any])
async def register_user(
    register_data: RegisterRequest,
    db: Session = Depends(get_db)
):
    """Register new user in database"""
    try:
        email = register_data.email.lower().strip()
        password = register_data.password
        confirm_password = register_data.confirm_password
        name = register_data.name
        
        logger.info(f"Registration attempt for: {email}")
        
        # Validate required fields
        if not email or not password or not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Email, password, and name are required"
                }
            )
        
        if password != confirm_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Passwords do not match"
                }
            )
        
        # Validate email format
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Invalid email format"
                }
            )
        
        # Check if email already exists
        existing_user = db.query(UserAuth).filter(UserAuth.email == email).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "success": False,
                    "error": "Email already registered"
                }
            )
        
        # Start transaction
        try:
            # Create user
            user = User(
                name=name,
                phone=register_data.phone,
                age=register_data.age,
                gender=register_data.gender,
                weight=register_data.weight,
                height=register_data.height,
                medical_conditions=register_data.medical_conditions,
                emergency_contact=register_data.emergency_contact,
                created_at=datetime.utcnow(),
                is_active=True
            )
            db.add(user)
            db.flush()  # Get ID
            
            # Create user authentication
            user_auth = UserAuth(
                user_id=user.id,
                email=email,
                password_hash=hash_password(password),
                email_verified=False,
                phone_verified=False,
                created_at=datetime.utcnow()
            )
            db.add(user_auth)
            
            # Commit changes
            db.commit()
            
            # Create access token
            access_token = create_access_token(
                data={"sub": str(user.id), "email": email}
            )
            profile_completion = _get_profile_completion(user)
            
            return JSONResponse(
                status_code=status.HTTP_201_CREATED,
                content={
                    "success": True,
                    "message": "Account created successfully",
                    "user_id": user.id,
                    "access_token": access_token,
                    "token_type": "bearer",
                    "user": {
                        "id": user.id,
                        "name": user.name,
                        "email": email,
                        "phone": user.phone,
                        "age": user.age,
                        "gender": user.gender,
                        "weight": user.weight,
                        "height": user.height,
                        "medical_conditions": user.medical_conditions,
                        "emergency_contact": user.emergency_contact,
                        "created_at": user.created_at.isoformat() if user.created_at else None,
                        "profile_complete": profile_completion["profile_complete"],
                        "missing_fields": profile_completion["missing_fields"]
                    }
                }
            )
            
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "success": False,
                    "error": f"Database transaction failed: {str(e)}"
                }
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Registration failed: {str(e)}"
            }
        )

# ==================== Social Login ====================

def _get_profile_completion(user: User) -> Dict[str, Any]:
    """Determine if required profile fields are complete."""
    missing = []
    if not (user.name or "").strip():
        missing.append("name")
    if not (user.phone or "").strip():
        missing.append("phone")
    if not user.age:
        missing.append("age")
    if user.gender not in ["male", "female"]:
        missing.append("gender")
    return {
        "profile_complete": len(missing) == 0,
        "missing_fields": missing
    }

@router.post("/social-login", response_model=Dict[str, Any])
async def social_login(
    data: SocialLoginRequest,
    db: Session = Depends(get_db)
):
    """Social login with Google/Apple"""
    try:
        provider = (data.provider or "").lower().strip()
        if provider not in ["google", "apple"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported provider"
            )

        if not data.token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token is required"
            )

        # Verify token (or decode unverified in dev)
        token_data: Dict[str, Any] = {}
        if provider == "google":
            if GOOGLE_CLIENT_ID or not ALLOW_UNVERIFIED_SOCIAL_LOGIN:
                token_data = await verify_google_id_token(data.token)
            else:
                token_data = jwt.decode(data.token, options={"verify_signature": False})
        elif provider == "apple":
            if APPLE_CLIENT_ID or not ALLOW_UNVERIFIED_SOCIAL_LOGIN:
                token_data = await verify_apple_id_token(data.token)
            else:
                token_data = jwt.decode(data.token, options={"verify_signature": False})

        user_info = data.user_info or {}
        provider_user_id = token_data.get("sub") or user_info.get("id")
        email = (token_data.get("email") or user_info.get("email") or "").lower().strip()
        name = user_info.get("name") or token_data.get("name")
        if not name and email:
            name = email.split("@")[0]
        if not name:
            name = "User"

        if not provider_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provider user id is missing"
            )

        # Check existing social account
        social = db.query(SocialAccount).filter(
            SocialAccount.provider == provider,
            SocialAccount.provider_user_id == provider_user_id
        ).first()

        user_auth = None
        user = None

        if social:
            user = db.query(User).filter(User.id == social.user_id).first()
            user_auth = db.query(UserAuth).filter(UserAuth.user_id == social.user_id).first()

        # If no social account, try match by email
        if not user and email:
            user_auth = db.query(UserAuth).filter(UserAuth.email == email).first()
            if user_auth:
                user = db.query(User).filter(User.id == user_auth.user_id).first()

        # Create user if not exists
        if not user:
            if not email:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email is required to create a new account"
                )

            user = User(
                name=name,
                created_at=datetime.utcnow(),
                is_active=True
            )
            db.add(user)
            db.flush()

            user_auth = UserAuth(
                user_id=user.id,
                email=email,
                password_hash=None,
                email_verified=True,
                phone_verified=False,
                created_at=datetime.utcnow()
            )
            db.add(user_auth)

        # Create or update social account
        if not social:
            social = SocialAccount(
                user_id=user.id,
                provider=provider,
                provider_user_id=provider_user_id,
                email=email,
                display_name=name,
                photo_url=user_info.get("photo") or token_data.get("picture"),
                access_token=data.token,
                refresh_token=None
            )
            db.add(social)
        else:
            social.email = email or social.email
            social.display_name = name or social.display_name
            social.photo_url = user_info.get("photo") or social.photo_url
            social.access_token = data.token

        # Update last login
        if user_auth:
            user_auth.last_login = datetime.utcnow()

        db.commit()

        access_token = create_access_token(
            data={"sub": str(user.id), "email": email or user_auth.email}
        )
        profile_completion = _get_profile_completion(user)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "access_token": access_token,
                "token_type": "bearer",
                "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                "user": {
                    "id": user.id,
                    "name": user.name,
                    "email": user_auth.email if user_auth else email,
                    "phone": user.phone,
                    "age": user.age,
                    "gender": user.gender,
                    "emergency_contact": user.emergency_contact,
                    "medical_conditions": user.medical_conditions,
                    "email_verified": user_auth.email_verified if user_auth else True,
                    "phone_verified": user_auth.phone_verified if user_auth else False,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "is_active": user.is_active,
                    "profile_complete": profile_completion["profile_complete"],
                    "missing_fields": profile_completion["missing_fields"]
                }
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Social login failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Social login failed: {str(e)}"
        )

# ==================== User Login ====================

@router.post("/login", response_model=Dict[str, Any])
async def login_user(
    login_data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """User login with database validation"""
    try:
        email = login_data.email.lower().strip()
        password = login_data.password
        
        logger.info(f"Login attempt for: {email}")
        
        if not email or not password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Email and password are required"
                }
            )
        
        # Find user authentication
        user_auth = db.query(UserAuth).filter(
            UserAuth.email == email
        ).first()
        
        if not user_auth:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": "User not found"
                }
            )
        
        # Verify password
        if not verify_password(password, user_auth.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "success": False,
                    "error": "Incorrect password"
                }
            )
        
        # Get user data
        user = db.query(User).filter(User.id == user_auth.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": "User data not found"
                }
            )
        
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail={
                    "success": False,
                    "error": "Account is inactive"
                }
            )
        
        # Create token
        access_token = create_access_token(
            data={"sub": str(user.id), "email": email}
        )
        
        # Update last login
        user_auth.last_login = datetime.utcnow()
        db.commit()
        
        profile_completion = _get_profile_completion(user)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "access_token": access_token,
                "token_type": "bearer",
                "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                "user": {
                    "id": user.id,
                    "name": user.name,
                    "email": email,
                    "phone": user.phone,
                    "age": user.age,
                    "gender": user.gender,
                    "emergency_contact": user.emergency_contact,
                    "medical_conditions": user.medical_conditions,
                    "email_verified": user_auth.email_verified,
                    "phone_verified": user_auth.phone_verified,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "is_active": user.is_active,
                    "profile_complete": profile_completion["profile_complete"],
                    "missing_fields": profile_completion["missing_fields"]
                }
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Login failed: {str(e)}"
            }
        )

# ==================== User Activity Update ====================

@router.post("/update-activity", response_model=Dict[str, Any])
async def update_activity(
    activity_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Update user's last activity timestamp"""
    try:
        user_id = activity_data.get("user_id")
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "User ID is required"
                }
            )
        
        # Update last activity in database
        user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
        if user_auth:
            user_auth.last_login = datetime.utcnow()
            db.commit()
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Activity updated successfully",
                "timestamp": datetime.utcnow().isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating activity: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Failed to update activity: {str(e)}"
            }
        )

# ==================== Token Validation ====================

@router.post("/validate-token", response_model=Dict[str, Any])
async def validate_token(
    token_data: Optional[Dict[str, Any]] = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Validate JWT token"""
    try:
        token = token_data.get("token") if token_data else None
        if not token:
            token = extract_bearer_token(authorization)
        
        if not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Token is required"
                }
            )
        
        try:
            # Decode token
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = int(payload.get("sub"))
            email = payload.get("email")
            
            # Verify user exists
            user = db.query(User).filter(User.id == user_id).first()
            user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
            
            if not user or not user_auth:
                return JSONResponse(
                    status_code=status.HTTP_404_NOT_FOUND,
                    content={
                        "success": False,
                        "valid": False,
                        "error": "User not found"
                    }
                )
            
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": True,
                    "valid": True,
                    "user": {
                        "id": user.id,
                        "name": user.name,
                        "email": user_auth.email,
                        "age": user.age,
                        "gender": user.gender,
                        "emergency_contact": user.emergency_contact,
                        "created_at": user.created_at.isoformat() if user.created_at else None
                    },
                    "expires_at": datetime.fromtimestamp(payload["exp"]).isoformat()
                }
            )
            
        except jwt.ExpiredSignatureError:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "success": False,
                    "valid": False,
                    "error": "Token has expired"
                }
            )
        except jwt.InvalidTokenError:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "success": False,
                    "valid": False,
                    "error": "Invalid token"
                }
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token validation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Token validation failed: {str(e)}"
            }
        )

# ==================== Profile ====================

@router.get("/profile", response_model=Dict[str, Any])
async def get_profile(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Get user profile from access token."""
    try:
        token = extract_bearer_token(authorization)
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"success": False, "error": "Authorization token required"}
            )

        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))

        user = db.query(User).filter(User.id == user_id).first()
        user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()

        if not user or not user_auth:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "User not found"}
            )

        is_admin = user_auth.email.lower() in ADMIN_EMAILS if ADMIN_EMAILS else False
        profile_completion = _get_profile_completion(user)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "user": {
                    "id": user.id,
                    "name": user.name,
                    "email": user_auth.email,
                    "phone": user.phone,
                    "age": user.age,
                    "gender": user.gender,
                    "weight": user.weight,
                    "height": user.height,
                    "medical_conditions": user.medical_conditions,
                    "emergency_contact": user.emergency_contact,
                    "email_verified": user_auth.email_verified,
                    "phone_verified": user_auth.phone_verified,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "updated_at": user.updated_at.isoformat() if user.updated_at else None,
                    "is_active": user.is_active,
                    "is_admin": is_admin,
                    "profile_complete": profile_completion["profile_complete"],
                    "missing_fields": profile_completion["missing_fields"]
                }
            }
        )

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Token has expired"}
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid token"}
        )

@router.put("/profile", response_model=Dict[str, Any])
async def update_profile(
    profile_data: ProfileUpdateRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Update user profile from access token."""
    try:
        token = extract_bearer_token(authorization)
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"success": False, "error": "Authorization token required"}
            )

        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))

        user = db.query(User).filter(User.id == user_id).first()
        user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()

        if not user or not user_auth:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "User not found"}
            )

        update_data = profile_data.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)

        user.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(user)

        is_admin = user_auth.email.lower() in ADMIN_EMAILS if ADMIN_EMAILS else False
        profile_completion = _get_profile_completion(user)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Profile updated successfully",
                "user": {
                    "id": user.id,
                    "name": user.name,
                    "email": user_auth.email,
                    "phone": user.phone,
                    "age": user.age,
                    "gender": user.gender,
                    "weight": user.weight,
                    "height": user.height,
                    "medical_conditions": user.medical_conditions,
                    "emergency_contact": user.emergency_contact,
                    "email_verified": user_auth.email_verified,
                    "phone_verified": user_auth.phone_verified,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "updated_at": user.updated_at.isoformat() if user.updated_at else None,
                    "is_active": user.is_active,
                    "is_admin": is_admin,
                    "profile_complete": profile_completion["profile_complete"],
                    "missing_fields": profile_completion["missing_fields"]
                }
            }
        )

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Token has expired"}
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid token"}
        )

# ==================== Password Reset (Demo) ====================

@router.post("/forgot-password", response_model=Dict[str, Any])
async def forgot_password(
    data: ForgotPasswordRequest,
    db: Session = Depends(get_db)
):
    """Trigger password reset (demo/stub)."""
    try:
        email = data.email.lower().strip()

        # Check if user exists (do not leak info in real systems)
        user_auth = db.query(UserAuth).filter(UserAuth.email == email).first()

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "If the email exists, a reset link will be sent.",
                "email_exists": user_auth is not None,
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except Exception as e:
        logger.error(f"Forgot password error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to process request: {str(e)}"}
        )

@router.post("/reset-password", response_model=Dict[str, Any])
async def reset_password(
    data: ResetPasswordRequest,
    db: Session = Depends(get_db)
):
    """Reset password (demo/stub)."""
    try:
        if data.password != data.confirm_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "Passwords do not match"}
            )

        # Demo behavior: if token looks like an email, update password.
        token_email = data.token.lower().strip()
        if "@" in token_email:
            user_auth = db.query(UserAuth).filter(UserAuth.email == token_email).first()
            if user_auth:
                user_auth.password_hash = hash_password(data.password)
                db.commit()

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Password reset successful (demo)",
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reset password error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": f"Failed to reset password: {str(e)}"}
        )

# ==================== User Logout ====================

@router.post("/logout", response_model=Dict[str, Any])
async def logout_user(
    logout_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """User logout (token invalidation)"""
    try:
        # In a real implementation, you would add the token to a blacklist
        # For now, just return success
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "success": True,
                "message": "Logged out successfully"
            }
        )
        
    except Exception as e:
        logger.error(f"Logout error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Logout failed: {str(e)}"
            }
        )
