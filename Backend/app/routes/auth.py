"""
Authentication API Routes - FIXED VERSION
"""

import logging
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Request
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

# ==================== وظائف مساعدة ====================

def hash_password(password: str) -> str:
    """تشفير كلمة المرور"""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """التحقق من كلمة المرور"""
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: timedelta = None):
    """إنشاء توكن JWT"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# ==================== نماذج البيانات (Pydantic) ====================

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

# ==================== التحقق من البريد الإلكتروني ====================

@router.post("/check-email")
async def check_email(
    email_data: EmailCheckRequest,
    db: Session = Depends(get_db)
):
    """فحص وجود البريد الإلكتروني في قاعدة البيانات"""
    try:
        email = email_data.email.lower().strip()
        
        if not email:
            return {
                "success": False,
                "message": "البريد الإلكتروني مطلوب",
                "exists": False
            }
        
        # التحقق من صحة البريد
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, email):
            return {
                "success": False,
                "message": "بريد إلكتروني غير صالح",
                "exists": False
            }
        
        # التحقق من قاعدة البيانات - استخدم Session مباشرة
        user_auth = db.query(UserAuth).filter(UserAuth.email == email).first()
        exists = user_auth is not None
        
        return {
            "success": True,
            "exists": exists,
            "message": "البريد موجود" if exists else "البريد غير موجود"
        }
        
    except Exception as e:
        logger.error(f"❌ Error in check-email: {e}")
        return {
            "success": False,
            "exists": False,
            "message": f"خطأ في التحقق: {str(e)}"
        }
        
                  
# ==================== التحقق من اتصال قاعدة البيانات ====================

@router.get("/database-status")
async def database_status(
    db: Session = Depends(get_db)
):
    """التحقق من اتصال قاعدة البيانات"""
    try:
        # محاولة تنفيذ استعلام بسيط
        count = db.query(User).count()
        return {
            "success": True,
            "connected": True,
            "user_count": count,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"❌ Database connection error: {e}")
        return {
            "success": False,
            "connected": False,
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

# ==================== تسجيل مستخدم جديد ====================

@router.post("/register")
async def register_user(
    register_data: RegisterRequest,
    db: Session = Depends(get_db)
):
    """تسجيل مستخدم جديد في قاعدة البيانات"""
    try:
        email = register_data.email.lower().strip()
        password = register_data.password
        confirm_password = register_data.confirm_password
        name = register_data.name
        
        print(f"📝 Registration attempt for: {email}")
        print(f"📦 Register data received")
        
        # التحقق من البيانات المطلوبة
        if not email or not password or not name:
            print(f"❌ Missing required fields")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="البريد الإلكتروني وكلمة المرور والاسم مطلوبة"
            )
        
        if password != confirm_password:
            print(f"❌ Passwords don't match")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="كلمتا المرور غير متطابقتين"
            )
        
        # التحقق من صحة البريد
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, email):
            print(f"❌ Invalid email format: {email}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="بريد إلكتروني غير صالح"
            )
        
        print(f"🔍 Checking if email exists in database: {email}")
        
        # التحقق من وجود البريد - باستخدام قاعدة البيانات مباشرة
        existing_user = db.query(UserAuth).filter(UserAuth.email == email).first()
        
        print(f"📊 Email exists check result: {existing_user is not None}")
        
        if existing_user:
            print(f"❌ Email already registered: {email}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="البريد الإلكتروني مسجل بالفعل"
            )
        
        # بدء المعاملة
        print(f"✅ Email not found, creating new user...")
        
        # إنشاء المستخدم
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
        db.flush()  # للحصول على ID
        
        print(f"✅ User created with ID: {user.id}")
        
        # إنشاء مصادقة المستخدم
        user_auth = UserAuth(
            user_id=user.id,
            email=email,
            password_hash=hash_password(password),
            email_verified=False,
            phone_verified=False,
            created_at=datetime.utcnow()
        )
        db.add(user_auth)
        
        # حفظ التغييرات
        db.commit()
        print(f"✅ Database changes committed")
        
        # إنشاء توكن
        access_token = create_access_token(
            data={"sub": str(user.id), "email": email}
        )
        
        print(f"✅ User registered successfully: {email}")
        
        return {
            "success": True,
            "message": "تم إنشاء الحساب بنجاح",
            "user_id": user.id,
            "access_token": access_token,
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
        
    except HTTPException as http_err:
        print(f"❌ HTTP Exception: {http_err.detail}")
        raise http_err
    except Exception as e:
        print(f"❌ General Exception: {e}")
        db.rollback()
        logger.error(f"❌ Registration failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"فشل إنشاء الحساب: {str(e)}"
        )

# ==================== تسجيل الدخول ====================

@router.post("/login")
async def login_user(
    login_data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """تسجيل دخول المستخدم من قاعدة البيانات"""
    try:
        email = login_data.email.lower().strip()
        password = login_data.password
        
        logger.info(f"🔐 Login attempt for: {email}")
        
        if not email or not password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="البريد الإلكتروني وكلمة المرور مطلوبتان"
            )
        
        # البحث عن مصادقة المستخدم
        user_auth = db.query(UserAuth).filter(
            UserAuth.email == email
        ).first()
        
        if not user_auth:
            logger.warning(f"❌ Email not found: {email}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="المستخدم غير موجود"
            )
        
        # التحقق من كلمة المرور
        if not verify_password(password, user_auth.password_hash):
            logger.warning(f"❌ Wrong password for: {email}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="كلمة المرور غير صحيحة"
            )
        
        # جلب بيانات المستخدم
        user = db.query(User).filter(User.id == user_auth.user_id).first()
        if not user:
            logger.error(f"❌ User not found in users table: {user_auth.user_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="بيانات المستخدم غير موجودة"
            )
        
        if not user.is_active:
            logger.warning(f"❌ User inactive: {email}")
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail="الحساب غير نشط"
            )
        
        # إنشاء التوكن
        access_token = create_access_token(
            data={"sub": str(user.id), "email": email}
        )
        
        # تحديث آخر تسجيل دخول
        user_auth.last_login = datetime.utcnow()
        db.commit()
        
        logger.info(f"✅ Login successful: {email}")
        
        return {
            "success": True,
            "access_token": access_token,
            "token_type": "bearer",
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
        
    except HTTPException as http_err:
        raise http_err
    except Exception as e:
        logger.error(f"❌ Login failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"فشل تسجيل الدخول: {str(e)}"
        )

# ==================== تحديث نشاط المستخدم ====================

@router.post("/update-activity")
async def update_activity(
    activity_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """تحديث آخر نشاط للمستخدم"""
    try:
        user_id = activity_data.get("user_id")
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="معرف المستخدم مطلوب"
            )
        
        # تحديث آخر نشاط في قاعدة البيانات
        user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
        if user_auth:
            user_auth.last_login = datetime.utcnow()
            db.commit()
        
        return {
            "success": True,
            "message": "تم تحديث النشاط"
        }
        
    except Exception as e:
        logger.error(f"❌ Error updating activity: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"فشل تحديث النشاط: {str(e)}"
        )

# ==================== التحقق من صحة التوكن ====================

@router.post("/validate-token")
async def validate_token(
    token_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """التحقق من صحة التوكن"""
    try:
        token = token_data.get("token")
        
        if not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="التوكن مطلوب"
            )
        
        try:
            # فك التوكن
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = int(payload.get("sub"))
            email = payload.get("email")
            
            # التحقق من وجود المستخدم
            user = db.query(User).filter(User.id == user_id).first()
            user_auth = db.query(UserAuth).filter(UserAuth.user_id == user_id).first()
            
            if not user or not user_auth:
                return {
                    "success": False,
                    "valid": False,
                    "message": "المستخدم غير موجود"
                }
            
            return {
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
            
        except jwt.ExpiredSignatureError:
            return {
                "success": False,
                "valid": False,
                "message": "التوكن منتهي الصلاحية"
            }
        except jwt.InvalidTokenError:
            return {
                "success": False,
                "valid": False,
                "message": "التوكن غير صالح"
            }
        
    except Exception as e:
        logger.error(f"❌ Token validation error: {e}")
        return {
            "success": False,
            "valid": False,
            "message": f"خطأ في التحقق: {str(e)}"
        }

# ==================== تسجيل الخروج ====================

@router.post("/logout")
async def logout_user(
    logout_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """تسجيل خروج المستخدم"""
    try:
        # في الخدمة الحقيقية، قد تقوم بحذف التوكن من قائمة التوكنات السوداء
        # لكن حالياً نكتفي بإرجاع نجاح
        return {
            "success": True,
            "message": "تم تسجيل الخروج بنجاح"
        }
        
    except Exception as e:
        logger.error(f"❌ Logout error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"فشل تسجيل الخروج: {str(e)}"
        )