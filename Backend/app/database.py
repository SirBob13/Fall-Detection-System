"""
Updated database configuration for Fall Detection System
"""

import os
from datetime import datetime
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from .config import *

# إصلاح: الحصول على مسار السوكت الصحيح لـ MAMP على macOS
def get_mamp_socket_path():
    """Get correct MySQL socket path for MAMP on macOS"""
    
    # المسارات المحتملة لـ MAMP MySQL socket
    possible_paths = [
        "/Applications/MAMP/tmp/mysql/mysql.sock",  # MAMP عادي
        "/Applications/MAMP/tmp/mysql/mysql.sock.1",
        "/tmp/mysql.sock",
        "/tmp/mysql.sock.1"
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            return path
    
    return "/Applications/MAMP/tmp/mysql/mysql.sock"  # افتراضي

# Create database URL
if DB_CONNECTION == "mysql":
    # إصلاح: استخدام محددات الصحيح لـ pymysql
    socket_path = get_mamp_socket_path()
    print(f"🔍 Using MySQL socket: {socket_path}")
    
    DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@localhost/{DB_DATABASE}?unix_socket={socket_path}&charset=utf8mb4"
    
    print(f"🔗 Database URL: mysql+pymysql://{DB_USER}:*****@localhost/{DB_DATABASE}?unix_socket={socket_path}")
    
    # بديل: استخدام TCP/IP إذا لم يعمل السوكت
    DATABASE_URL_TCP = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@127.0.0.1:3306/{DB_DATABASE}?charset=utf8mb4"
else:
    DATABASE_URL = "sqlite:///fall_detection.db"

# Create engine with better configuration
try:
    connect_args = {'connect_timeout': 10} if DB_CONNECTION == "mysql" else {}
    engine = create_engine(
        DATABASE_URL,
        echo=DEBUG,  # إظهار SQL في وضع التصحيح
        pool_pre_ping=True,
        pool_recycle=3600,
        pool_size=5,
        max_overflow=10,
        connect_args=connect_args
    )
    print("✅ Database engine created successfully")
except Exception as e:
    print(f"❌ Error creating database engine: {e}")
    
    # محاولة الاتصال عبر TCP/IP كبديل
    if DB_CONNECTION == "mysql":
        print("🔄 Trying TCP/IP connection...")
        try:
            engine = create_engine(
                DATABASE_URL_TCP,
                echo=DEBUG,
                pool_pre_ping=True,
                pool_recycle=3600
            )
            print("✅ Database engine created via TCP/IP")
        except Exception as e2:
            print(f"❌ TCP/IP connection also failed: {e2}")
            print("🔄 Falling back to SQLite...")
            engine = create_engine(
                "sqlite:///fall_detection.db",
                echo=DEBUG
            )
    else:
        engine = create_engine(
            "sqlite:///fall_detection.db",
            echo=DEBUG
        )

# Create session
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()

# Dependency for FastAPI
def get_db():
    """
    Get database session
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Initialize database
def init_db():
    """
    Initialize database and create tables
    """
    try:
        from . import models
        Base.metadata.create_all(bind=engine)
        ensure_user_phone_column()
        print("✅ Database initialized successfully")
        
        # إنشاء بيانات تجريبية إذا كانت قاعدة البيانات فارغة
        create_test_data()
        
    except Exception as e:
        print(f"❌ Error initializing database: {e}")
        raise

def ensure_user_phone_column():
    """
    Ensure users.phone column exists (safe, additive migration).
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table("users"):
            return
        columns = [col["name"] for col in inspector.get_columns("users")]
        if "phone" in columns:
            return
        ddl = "ALTER TABLE users ADD COLUMN phone VARCHAR(20)"
        if engine.dialect.name != "sqlite":
            ddl = "ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL"
        with engine.begin() as conn:
            conn.execute(text(ddl))
        print("✅ Added users.phone column")
    except Exception as e:
        print(f"⚠️ Unable to add users.phone column: {e}")

def create_test_data():
    """
    Create test data for development
    """
    try:
        from . import crud, schemas, models
        from sqlalchemy.orm import Session
        
        db = SessionLocal()
        
        # التحقق إذا كان هناك مستخدمين
        from .models import User, UserAuth
        user_count = db.query(User).count()
        
        if user_count == 0:
            print("📝 Creating test data...")
            
            # إنشاء مستخدم تجريبي
            test_user = User(
                name="مستخدم تجريبي",
                phone="+201234567890",
                age=70,
                gender="male",
                weight=75.0,
                height=170.0,
                medical_conditions="ضغط مرتفع",
                emergency_contact="+201234567890",
                is_active=True
            )
            db.add(test_user)
            db.flush()  # للحصول على الـ ID
            
            # إنشاء مصادقة المستخدم
            test_auth = UserAuth(
                user_id=test_user.id,
                email="test@example.com",
                password_hash="$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",  # test123
                email_verified=True,
                phone_verified=True,
                created_at=datetime.utcnow()
            )
            db.add(test_auth)
            
            # إنشاء جهاز تجريبي
            test_device = models.Device(
                user_id=test_user.id,
                device_id="TEST_DEVICE_001",
                mac_address="AA:BB:CC:DD:EE:FF",
                firmware_version="1.0.0",
                battery_level=85.0,
                is_connected=True,
                last_seen=datetime.utcnow()
            )
            db.add(test_device)
            
            db.commit()
            print("✅ Test data created successfully")
            print(f"   👤 Test user: test@example.com / test123")
            print(f"   📱 Device ID: TEST_DEVICE_001")
        
        db.close()
        
    except Exception as e:
        print(f"⚠️ Error creating test data: {e}")
        db.rollback()

# اختبار الاتصال بقاعدة البيانات
def test_connection():
    """
    Test database connection
    """
    try:
        with engine.connect() as conn:
            result = conn.execute("SELECT 1")
            print(f"✅ Database connection test successful: {result.fetchone()}")
            return True
    except Exception as e:
        print(f"❌ Database connection test failed: {e}")
        return False

if __name__ == "__main__":
    # اختبار الاتصال عند التشغيل المباشر
    print("🔍 Testing database connection...")
    if test_connection():
        print("📦 Creating tables...")
        init_db()
    else:
        print("⚠️ Cannot connect to database. Tables will not be created.")
