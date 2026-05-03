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
        ensure_device_archived_column()
        ensure_vital_device_id_column()
        ensure_alert_device_id_column()
        ensure_emergency_log_device_id_column()
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

def ensure_device_archived_column():
    """
    Ensure devices.is_archived column exists (safe, additive migration).
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table("devices"):
            return
        columns = [col["name"] for col in inspector.get_columns("devices")]
        if "is_archived" in columns:
            return
        ddl = "ALTER TABLE devices ADD COLUMN is_archived BOOLEAN DEFAULT 0"
        if engine.dialect.name != "sqlite":
            ddl = "ALTER TABLE devices ADD COLUMN is_archived BOOLEAN DEFAULT FALSE"
        with engine.begin() as conn:
            conn.execute(text(ddl))
        print("✅ Added devices.is_archived column")
    except Exception as e:
        print(f"⚠️ Unable to add devices.is_archived column: {e}")

def ensure_vital_device_id_column():
    """
    Ensure vital_sensor_data.device_id column exists (safe, additive migration).
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table("vital_sensor_data"):
            return

        columns = [col["name"] for col in inspector.get_columns("vital_sensor_data")]
        if "device_id" not in columns:
            ddl = "ALTER TABLE vital_sensor_data ADD COLUMN device_id VARCHAR(50)"
            if engine.dialect.name != "sqlite":
                ddl = "ALTER TABLE vital_sensor_data ADD COLUMN device_id VARCHAR(50) NULL"
            with engine.begin() as conn:
                conn.execute(text(ddl))
            print("✅ Added vital_sensor_data.device_id column")

        vital_indexes = {index["name"] for index in inspector.get_indexes("vital_sensor_data")}
        if "idx_vital_device_timestamp" not in vital_indexes:
            with engine.begin() as conn:
                if engine.dialect.name == "sqlite":
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS idx_vital_device_timestamp "
                            "ON vital_sensor_data (device_id, timestamp)"
                        )
                    )
                else:
                    conn.execute(
                        text(
                            "CREATE INDEX idx_vital_device_timestamp "
                            "ON vital_sensor_data (device_id, timestamp)"
                        )
                    )
            print("✅ Added vital_sensor_data device/timestamp index")
    except Exception as e:
        print(f"⚠️ Unable to add vital_sensor_data.device_id column/index: {e}")

def ensure_alert_device_id_column():
    """
    Ensure alerts.device_id column exists (safe, additive migration).
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table("alerts"):
            return

        columns = [col["name"] for col in inspector.get_columns("alerts")]
        if "device_id" not in columns:
            ddl = "ALTER TABLE alerts ADD COLUMN device_id VARCHAR(50)"
            if engine.dialect.name != "sqlite":
                ddl = "ALTER TABLE alerts ADD COLUMN device_id VARCHAR(50) NULL"
            with engine.begin() as conn:
                conn.execute(text(ddl))
            print("✅ Added alerts.device_id column")

        indexes = {index["name"] for index in inspector.get_indexes("alerts")}
        if "idx_alert_device_timestamp" not in indexes:
            with engine.begin() as conn:
                if engine.dialect.name == "sqlite":
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS idx_alert_device_timestamp "
                            "ON alerts (device_id, timestamp)"
                        )
                    )
                else:
                    conn.execute(
                        text(
                            "CREATE INDEX idx_alert_device_timestamp "
                            "ON alerts (device_id, timestamp)"
                        )
                    )
            print("✅ Added alerts device/timestamp index")
    except Exception as e:
        print(f"⚠️ Unable to add alerts.device_id column/index: {e}")

def ensure_emergency_log_device_id_column():
    """
    Ensure emergency_logs.device_id column exists (safe, additive migration).
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table("emergency_logs"):
            return

        columns = [col["name"] for col in inspector.get_columns("emergency_logs")]
        if "device_id" not in columns:
            ddl = "ALTER TABLE emergency_logs ADD COLUMN device_id VARCHAR(50)"
            if engine.dialect.name != "sqlite":
                ddl = "ALTER TABLE emergency_logs ADD COLUMN device_id VARCHAR(50) NULL"
            with engine.begin() as conn:
                conn.execute(text(ddl))
            print("✅ Added emergency_logs.device_id column")

        indexes = {index["name"] for index in inspector.get_indexes("emergency_logs")}
        if "idx_emergencylog_device_timestamp" not in indexes:
            with engine.begin() as conn:
                if engine.dialect.name == "sqlite":
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS idx_emergencylog_device_timestamp "
                            "ON emergency_logs (device_id, timestamp)"
                        )
                    )
                else:
                    conn.execute(
                        text(
                            "CREATE INDEX idx_emergencylog_device_timestamp "
                            "ON emergency_logs (device_id, timestamp)"
                        )
                    )
            print("✅ Added emergency_logs device/timestamp index")
    except Exception as e:
        print(f"⚠️ Unable to add emergency_logs.device_id column/index: {e}")

def create_test_data():
    """
    Create test data for development
    """
    db = None
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
        
    except Exception as e:
        print(f"⚠️ Error creating test data: {e}")
        if db is not None:
            db.rollback()
    finally:
        if db is not None:
            db.close()

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
