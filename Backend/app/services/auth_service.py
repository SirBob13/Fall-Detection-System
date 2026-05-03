import os
import jwt
import bcrypt
from datetime import datetime, timedelta
from typing import Optional, Tuple, Dict, Any, List
from sqlalchemy.orm import Session
import secrets
import logging
from fastapi import HTTPException, status

from ..models import User, UserAuth, UserSession, SocialAccount
from ..config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS, ADMIN_EMAILS

logger = logging.getLogger(__name__)

class AuthService:
    def __init__(self, db: Session):
        self.db = db
    
    # ==================== Email Verification ====================
    
    def check_email_exists(self, email: str) -> bool:
        """Check if email exists in the database"""
        try:
            email_clean = email.lower().strip()
            logger.info(f"🔍 Checking email existence: {email_clean}")
            
            # Check database directly
            user_auth = self.db.query(UserAuth).filter(
                UserAuth.email == email_clean
            ).first()
            
            exists = user_auth is not None
            logger.info(f"📊 Email {email_clean} exists: {exists}")
            
            return exists
            
        except Exception as e:
            logger.error(f"❌ Error checking email existence: {e}")
            return False
    
    # ==================== User Registration ====================
    
    def register_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new user with comprehensive validation"""
        try:
            email = user_data.get('email', '').lower().strip()
            
            if not email:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email is required"
                )
            
            # Check if email exists first
            email_exists = self.check_email_exists(email)
            if email_exists:
                logger.warning(f"❌ Email already exists: {email}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email is already registered"
                )
            
            # Start transaction
            logger.info(f"📝 Starting registration for: {email}")
            
            # Create user
            user = User(
                name=user_data.get('name', ''),
                age=user_data.get('age'),
                gender=user_data.get('gender'),
                weight=user_data.get('weight'),
                height=user_data.get('height'),
                medical_conditions=user_data.get('medical_conditions'),
                emergency_contact=user_data.get('emergency_contact'),
                created_at=datetime.utcnow(),
                is_active=True
            )
            self.db.add(user)
            self.db.flush()  # Get ID
            
            logger.info(f"✅ User created with ID: {user.id}")
            
            # Create user authentication
            user_auth = UserAuth(
                user_id=user.id,
                email=email,
                password_hash=self.hash_password(user_data.get('password', '')),
                email_verified=False,
                phone_verified=False,
                verification_token=secrets.token_urlsafe(32),
                created_at=datetime.utcnow()
            )
            self.db.add(user_auth)
            
            # Save changes
            self.db.commit()
            self.db.refresh(user)
            
            logger.info(f"✅ User registered successfully: {email}")
            
            # Return result
            is_admin = user_auth.email.lower() in ADMIN_EMAILS if ADMIN_EMAILS else False
            return {
                "success": True,
                "message": "Account created successfully",
                "user_id": user.id,
                "email": email,
                "name": user.name
            }
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"❌ Registration failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Account creation failed: {str(e)}"
            )
    
    # ==================== User Login ====================
    
    def login_user(self, email: str, password: str, device_info: str = None) -> Dict[str, Any]:
        """Login user from database"""
        try:
            email_clean = email.lower().strip()
            
            logger.info(f"🔐 Login attempt for: {email_clean}")
            
            # Check if email exists
            email_exists = self.check_email_exists(email_clean)
            if not email_exists:
                logger.warning(f"❌ Email not found: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User not found"
                )
            
            # Find user authentication
            user_auth = self.db.query(UserAuth).filter(
                UserAuth.email == email_clean
            ).first()
            
            if not user_auth:
                logger.error(f"❌ UserAuth not found for: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Authentication data not found"
                )
            
            # Check account status
            if user_auth.locked_until and user_auth.locked_until > datetime.utcnow():
                logger.warning(f"🔒 Account locked: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail="Account temporarily locked. Please try again later"
                )
            
            # Verify password
            if not self.verify_password(password, user_auth.password_hash):
                # Increment failed login attempts
                user_auth.login_attempts += 1
                
                if user_auth.login_attempts >= 5:
                    user_auth.locked_until = datetime.utcnow() + timedelta(minutes=15)
                    logger.warning(f"🔒 Account locked due to {user_auth.login_attempts} failed attempts")
                
                self.db.commit()
                
                logger.warning(f"❌ Wrong password for: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Incorrect password"
                )
            
            # Get user data
            user = self.db.query(User).filter(User.id == user_auth.user_id).first()
            if not user:
                logger.error(f"❌ User not found in users table: {user_auth.user_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User data not found"
                )
            
            if not user.is_active:
                logger.warning(f"❌ User inactive: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail="Account is not active"
                )
            
            # Reset login attempts
            user_auth.login_attempts = 0
            user_auth.locked_until = None
            user_auth.last_login = datetime.utcnow()
            
            # Create tokens
            access_token, refresh_token, refresh_expires = self.create_tokens(
                user_auth.user_id, user_auth.email
            )
            
            # Create new session
            session = UserSession(
                id=secrets.token_urlsafe(32),
                user_id=user_auth.user_id,
                token=access_token,
                refresh_token=refresh_token,
                device_info=device_info or "Unknown device",
                expires_at=refresh_expires,
                created_at=datetime.utcnow()
            )
            self.db.add(session)
            self.db.commit()
            
            logger.info(f"✅ Login successful: {email_clean}")
            is_admin = user_auth.email.lower() in ADMIN_EMAILS if ADMIN_EMAILS else False
            
            return {
                "success": True,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": "bearer",
                "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                "user": {
                    "id": user.id,
                    "name": user.name,
                    "email": user_auth.email,
                    "age": user.age,
                    "gender": user.gender,
                    "emergency_contact": user.emergency_contact,
                    "medical_conditions": user.medical_conditions,
                    "email_verified": user_auth.email_verified,
                    "phone_verified": user_auth.phone_verified,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "is_active": user.is_active,
                    "is_admin": is_admin
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Login failed: {e}")
            raise
    
    # ==================== Helper Tools ====================
    
    def hash_password(self, password: str) -> str:
        """Hash password"""
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')
    
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify password"""
        try:
            return bcrypt.checkpw(
                plain_password.encode('utf-8'),
                hashed_password.encode('utf-8')
            )
        except Exception:
            return False
    
    def create_tokens(self, user_id: int, email: str) -> Tuple[str, str, datetime]:
        """Create JWT access and refresh tokens"""
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        refresh_token_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        
        # Access token
        access_payload = {
            "sub": str(user_id),
            "email": email,
            "type": "access",
            "exp": datetime.utcnow() + access_token_expires
        }
        
        # Refresh token
        refresh_payload = {
            "sub": str(user_id),
            "email": email,
            "type": "refresh",
            "exp": datetime.utcnow() + refresh_token_expires,
            "jti": secrets.token_hex(16)  # Unique ID for token
        }
        
        access_token = jwt.encode(access_payload, SECRET_KEY, algorithm=ALGORITHM)
        refresh_token = jwt.encode(refresh_payload, SECRET_KEY, algorithm=ALGORITHM)
        
        return access_token, refresh_token, datetime.utcnow() + refresh_token_expires
    
    def refresh_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh access token using refresh token"""
        try:
            # Decode refresh token
            payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
            
            if payload.get("type") != "refresh":
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid token type"
                )
            
            user_id = int(payload.get("sub"))
            email = payload.get("email")
            
            # Check if user exists and is active
            user_auth = self.db.query(UserAuth).filter(
                UserAuth.user_id == user_id,
                UserAuth.email == email
            ).first()
            
            if not user_auth:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found"
                )
            
            # Check if user is active
            user = self.db.query(User).filter(User.id == user_id).first()
            if not user or not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User account is not active"
                )
            
            # Create new tokens
            access_token, new_refresh_token, expires_at = self.create_tokens(user_id, email)
            
            # Update session with new tokens
            session = self.db.query(UserSession).filter(
                UserSession.refresh_token == refresh_token,
                UserSession.expires_at > datetime.utcnow()
            ).first()
            
            if session:
                session.token = access_token
                session.refresh_token = new_refresh_token
                session.expires_at = expires_at
                self.db.commit()
            
            return {
                "success": True,
                "access_token": access_token,
                "refresh_token": new_refresh_token,
                "token_type": "bearer",
                "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60
            }
            
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token expired"
            )
        except jwt.InvalidTokenError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token"
            )
        except Exception as e:
            logger.error(f"❌ Token refresh failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Token refresh failed: {str(e)}"
            )
    
    def load_session(self, token: str) -> Optional[Dict[str, Any]]:
        """Load session from token"""
        try:
            # Decode and verify token
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = int(payload.get("sub"))
            token_type = payload.get("type")
            
            if token_type != "access":
                return None
            
            # Find session in database
            session = self.db.query(UserSession).filter(
                UserSession.token == token,
                UserSession.expires_at > datetime.utcnow()
            ).first()
            
            if not session:
                return None
            
            # Get user data
            user_auth = self.db.query(UserAuth).filter(
                UserAuth.user_id == user_id
            ).first()
            
            user = self.db.query(User).filter(User.id == user_id).first()
            
            if not user or not user_auth:
                return None
            
            is_admin = user_auth.email.lower() in ADMIN_EMAILS if ADMIN_EMAILS else False
            return {
                "user": {
                    "id": user.id,
                    "name": user.name,
                    "email": user_auth.email,
                    "age": user.age,
                    "gender": user.gender,
                    "emergency_contact": user.emergency_contact,
                    "medical_conditions": user.medical_conditions,
                    "email_verified": user_auth.email_verified,
                    "phone_verified": user_auth.phone_verified,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "is_active": user.is_active,
                    "is_admin": is_admin
                },
                "token": session.token,
                "refresh_token": session.refresh_token,
                "expires_at": session.expires_at.isoformat() if session.expires_at else None
            }
            
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None
        except Exception as e:
            logger.error(f"❌ Error loading session: {e}")
            return None
    
    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Verify token validity"""
        return self.load_session(token)
    
    def logout(self, access_token: str, refresh_token: str) -> Dict[str, Any]:
        """Logout user by invalidating tokens"""
        try:
            # Remove session from database
            session_deleted = self.db.query(UserSession).filter(
                UserSession.token == access_token,
                UserSession.refresh_token == refresh_token
            ).delete(synchronize_session=False)
            
            self.db.commit()
            
            if session_deleted > 0:
                logger.info("✅ User logged out successfully")
                return {
                    "success": True,
                    "message": "Logged out successfully"
                }
            else:
                logger.warning("⚠️ No active session found for logout")
                return {
                    "success": False,
                    "message": "No active session found"
                }
                
        except Exception as e:
            self.db.rollback()
            logger.error(f"❌ Logout failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Logout failed: {str(e)}"
            )
    
    def validate_password_strength(self, password: str) -> Dict[str, Any]:
        """Validate password strength"""
        errors = []
        
        if len(password) < 8:
            errors.append("Password must be at least 8 characters long")
        
        if not any(c.isupper() for c in password):
            errors.append("Password must contain at least one uppercase letter")
        
        if not any(c.islower() for c in password):
            errors.append("Password must contain at least one lowercase letter")
        
        if not any(c.isdigit() for c in password):
            errors.append("Password must contain at least one digit")
        
        if not any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?" for c in password):
            errors.append("Password must contain at least one special character")
        
        if errors:
            return {
                "valid": False,
                "errors": errors
            }
        else:
            return {
                "valid": True,
                "strength": "strong"
            }
    
    def change_password(self, user_id: int, current_password: str, new_password: str) -> Dict[str, Any]:
        """Change user password"""
        try:
            # Get user auth
            user_auth = self.db.query(UserAuth).filter(
                UserAuth.user_id == user_id
            ).first()
            
            if not user_auth:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="User authentication not found"
                )
            
            # Verify current password
            if not self.verify_password(current_password, user_auth.password_hash):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Current password is incorrect"
                )
            
            # Validate new password strength
            validation = self.validate_password_strength(new_password)
            if not validation["valid"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"New password is weak: {', '.join(validation.get('errors', []))}"
                )
            
            # Hash and update password
            user_auth.password_hash = self.hash_password(new_password)
            user_auth.reset_token = None
            user_auth.reset_token_expiry = None
            
            self.db.commit()
            
            # Invalidate all existing sessions
            self.db.query(UserSession).filter(
                UserSession.user_id == user_id
            ).delete(synchronize_session=False)
            self.db.commit()
            
            logger.info(f"✅ Password changed for user {user_id}")
            
            return {
                "success": True,
                "message": "Password changed successfully. Please login again."
            }
            
        except HTTPException:
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"❌ Password change failed for user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Password change failed: {str(e)}"
            )
    
    def check_database_connection(self) -> Dict[str, Any]:
        """Check database connection"""
        try:
            # Try simple query
            count = self.db.query(User).count()
            return {
                "connected": True,
                "user_count": count,
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"❌ Database connection error: {e}")
            return {
                "connected": False,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
