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
from ..config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS

logger = logging.getLogger(__name__)

class AuthService:
    def __init__(self, db: Session):
        self.db = db
    
    # ==================== التحقق من البريد الإلكتروني ====================
    
    def check_email_exists(self, email: str) -> bool:
        """التحقق من وجود البريد الإلكتروني في قاعدة البيانات"""
        try:
            email_clean = email.lower().strip()
            logger.info(f"🔍 Checking email existence: {email_clean}")
            
            # التحقق من قاعدة البيانات مباشرة - بدون await
            user_auth = self.db.query(UserAuth).filter(
                UserAuth.email == email_clean
            ).first()
            
            exists = user_auth is not None
            logger.info(f"📊 Email {email_clean} exists: {exists}")
            
            return exists
            
        except Exception as e:
            logger.error(f"❌ Error checking email existence: {e}")
            return False
    
    # ==================== تسجيل مستخدم جديد ====================
    
    async def register_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """تسجيل مستخدم جديد مع التحقق الشامل"""
        try:
            email = user_data.get('email', '').lower().strip()
            
            if not email:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="البريد الإلكتروني مطلوب"
                )
            
            # التحقق من وجود البريد أولاً
            email_exists = await self.check_email_exists(email)
            if email_exists:
                logger.warning(f"❌ Email already exists: {email}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="البريد الإلكتروني مسجل بالفعل"
                )
            
            # بدء المعاملة
            logger.info(f"📝 Starting registration for: {email}")
            
            # إنشاء المستخدم
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
            self.db.flush()  # للحصول على ID
            
            logger.info(f"✅ User created with ID: {user.id}")
            
            # إنشاء مصادقة المستخدم
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
            
            # حفظ التغييرات
            self.db.commit()
            self.db.refresh(user)
            
            logger.info(f"✅ User registered successfully: {email}")
            
            # إرجاع النتيجة
            return {
                "success": True,
                "message": "تم إنشاء الحساب بنجاح",
                "user_id": user.id,
                "email": email,
                "name": user.name
            }
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"❌ Registration failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"فشل إنشاء الحساب: {str(e)}"
            )
    
    # ==================== تسجيل الدخول ====================
    
    async def login_user(self, email: str, password: str, device_info: str = None) -> Dict[str, Any]:
        """تسجيل دخول المستخدم من قاعدة البيانات"""
        try:
            email_clean = email.lower().strip()
            
            logger.info(f"🔐 Login attempt for: {email_clean}")
            
            # التحقق من وجود البريد
            email_exists = await self.check_email_exists(email_clean)
            if not email_exists:
                logger.warning(f"❌ Email not found: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="المستخدم غير موجود"
                )
            
            # البحث عن مصادقة المستخدم
            user_auth = self.db.query(UserAuth).filter(
                UserAuth.email == email_clean
            ).first()
            
            if not user_auth:
                logger.error(f"❌ UserAuth not found for: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="بيانات المصادقة غير موجودة"
                )
            
            # التحقق من حالة الحساب
            if user_auth.locked_until and user_auth.locked_until > datetime.utcnow():
                logger.warning(f"🔒 Account locked: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail="الحساب مؤقتاً. يرجى المحاولة لاحقاً"
                )
            
            # التحقق من كلمة المرور
            if not self.verify_password(password, user_auth.password_hash):
                # زيادة محاولات الدخول الفاشلة
                user_auth.login_attempts += 1
                
                if user_auth.login_attempts >= 5:
                    user_auth.locked_until = datetime.utcnow() + timedelta(minutes=15)
                    logger.warning(f"🔒 Account locked due to {user_auth.login_attempts} failed attempts")
                
                self.db.commit()
                
                logger.warning(f"❌ Wrong password for: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="كلمة المرور غير صحيحة"
                )
            
            # جلب بيانات المستخدم
            user = self.db.query(User).filter(User.id == user_auth.user_id).first()
            if not user:
                logger.error(f"❌ User not found in users table: {user_auth.user_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="بيانات المستخدم غير موجودة"
                )
            
            if not user.is_active:
                logger.warning(f"❌ User inactive: {email_clean}")
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail="الحساب غير نشط"
                )
            
            # إعادة تعيين محاولات الدخول
            user_auth.login_attempts = 0
            user_auth.locked_until = None
            user_auth.last_login = datetime.utcnow()
            
            # إنشاء التوكنات
            access_token, refresh_token = self.create_tokens(
                user_auth.user_id, user_auth.email
            )
            
            # إنشاء جلسة جديدة
            session = UserSession(
                id=secrets.token_urlsafe(32),
                user_id=user_auth.user_id,
                token=access_token,
                refresh_token=refresh_token,
                device_info=device_info or "Unknown device",
                expires_at=datetime.utcnow() + timedelta(days=30),  # 30 يوم
                created_at=datetime.utcnow()
            )
            self.db.add(session)
            self.db.commit()
            
            logger.info(f"✅ Login successful: {email_clean}")
            
            return {
                "success": True,
                "access_token": access_token,
                "refresh_token": refresh_token,
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
                    "is_active": user.is_active
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Login failed: {e}")
            raise
    
    # ==================== أدوات مساعدة ====================
    
    def hash_password(self, password: str) -> str:
        """تشفير كلمة المرور"""
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')
    
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """التحقق من كلمة المرور"""
        try:
            return bcrypt.checkpw(
                plain_password.encode('utf-8'),
                hashed_password.encode('utf-8')
            )
        except Exception:
            return False
    
    def create_tokens(self, user_id: int, email: str) -> Tuple[str, str]:
        """إنشاء JWT tokens"""
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        refresh_token_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        
        access_payload = {
            "sub": str(user_id),
            "email": email,
            "type": "access",
            "exp": datetime.utcnow() + access_token_expires
        }
        
        refresh_payload = {
            "sub": str(user_id),
            "email": email,
            "type": "refresh",
            "exp": datetime.utcnow() + refresh_token_expires
        }
        
        access_token = jwt.encode(access_payload, SECRET_KEY, algorithm=ALGORITHM)
        refresh_token = jwt.encode(refresh_payload, SECRET_KEY, algorithm=ALGORITHM)
        
        return access_token, refresh_token
    
    async def load_session(self, token: str) -> Optional[Dict[str, Any]]:
        """تحميل الجلسة من التوكن"""
        try:
            # فك التوكن والتحقق منه
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = int(payload.get("sub"))
            token_type = payload.get("type")
            
            if token_type != "access":
                return None
            
            # البحث عن الجلسة في قاعدة البيانات
            session = self.db.query(UserSession).filter(
                UserSession.token == token,
                UserSession.expires_at > datetime.utcnow()
            ).first()
            
            if not session:
                return None
            
            # جلب بيانات المستخدم
            user_auth = self.db.query(UserAuth).filter(
                UserAuth.user_id == user_id
            ).first()
            
            user = self.db.query(User).filter(User.id == user_id).first()
            
            if not user or not user_auth:
                return None
            
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
                    "is_active": user.is_active
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
    
    async def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """التحقق من صحة التوكن"""
        return await self.load_session(token)
    
    async def check_database_connection(self) -> Dict[str, Any]:
        """التحقق من اتصال قاعدة البيانات"""
        try:
            # محاولة تنفيذ استعلام بسيط
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