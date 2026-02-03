"""
Authentication API Routes - FIXED VERSION WITH PROPER HTTP STATUS CODES
"""

import logging
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import re
import bcrypt
import jwt
from datetime import datetime, timedelta

from ..database import get_db
from ..models import User, UserAuth
from ..config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES

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

# ==================== Pydantic Models ====================

from pydantic import BaseModel

class EmailCheckRequest(BaseModel):
    email: str

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    name: str
    email: str
    phone: str = ""
    password: str
    confirm_password: str
    age: int = None
    gender: str = "male"
    weight: float = None
    height: float = None
    medical_conditions: str = ""
    emergency_contact: str = ""

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
                        "age": user.age,
                        "gender": user.gender,
                        "emergency_contact": user.emergency_contact,
                        "created_at": user.created_at.isoformat() if user.created_at else None
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
                    "age": user.age,
                    "gender": user.gender,
                    "emergency_contact": user.emergency_contact,
                    "medical_conditions": user.medical_conditions,
                    "email_verified": user_auth.email_verified,
                    "phone_verified": user_auth.phone_verified,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "is_active": user.is_active
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
    token_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Validate JWT token"""
    try:
        token = token_data.get("token")
        
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