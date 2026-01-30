#!/usr/bin/env python3
"""
Debug script for Fall Detection System.
"""

import sys
import os
from pathlib import Path
from database import SessionLocal, init_db
from models import User, UserAuth


# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.append(str(project_root))

print("🔧 Fall Detection System Debug Tool")
print("=" * 50)

def test_imports():
    print("\n📦 Testing imports...")
    
    modules = [
        ("app.crud", "crud"),
        ("app.models", "models"),
        ("app.schemas", "schemas"),
        ("app.database", "database"),
        ("app.ai_model", "ai_model"),
        ("app.double_verification", "double_verification"),
        ("app.config", "config"),
    ]
    
    for module_path, module_name in modules:
        try:
            __import__(module_path)
            print(f"✅ {module_name} imported successfully")
        except Exception as e:
            print(f"❌ {module_name} import failed: {e}")

def test_database():
    print("\n🗄️ Testing database...")
    try:
        from app.database import engine, init_db
        print("✅ Database engine created")
        
        # Try to create tables
        init_db()
        print("✅ Database tables created")
        
        # Test connection
        with engine.connect() as conn:
            result = conn.execute("SELECT 1")
            print(f"✅ Database connection test: {result.fetchone()}")
            
    except Exception as e:
        print(f"❌ Database test failed: {e}")

def test_ai_model():
    print("\n🧠 Testing AI model...")
    try:
        from app.ai_model import load_model_and_scaler
        model, scaler = load_model_and_scaler()
        print(f"✅ AI model loaded: {model}")
        print(f"✅ Scaler loaded: {scaler}")
        
        # Test prediction
        import numpy as np
        test_buffer = np.random.randn(50, 8)
        from app.ai_model import predict_fall
        result = predict_fall(test_buffer)
        print(f"✅ Prediction test: {result.get('success', False)}")
        
    except Exception as e:
        print(f"❌ AI model test failed: {e}")

def test_crud_functions():
    print("\n🛠️ Testing CRUD functions...")
    try:
        from app.crud import (
            create_user, get_user, create_device,
            get_device_by_id, create_motion_data,
            create_vital_data, process_motion_and_predict
        )
        print("✅ All CRUD functions imported")
        
        # Check function signatures
        functions = [
            create_user, get_user, create_device,
            get_device_by_id, create_motion_data,
            create_vital_data, process_motion_and_predict
        ]
        
        for func in functions:
            print(f"  ✓ {func.__name__}")
            
    except Exception as e:
        print(f"❌ CRUD test failed: {e}")

def check_file_structure():
    print("\n📁 Checking file structure...")
    
    required_files = [
        "AI/models/FINAL_LSTM_Attention.keras",
        "AI/scaler/scaler_all.save",
        "Backend/app/__init__.py",
        "Backend/app/crud.py",
        "Backend/app/models.py",
        "Backend/app/schemas.py",
        "Backend/app/database.py",
        "Backend/app/main.py",
        "Backend/app/routes/main.py",
        "Backend/requirements.txt",
    ]
    
    for file_path in required_files:
        full_path = project_root / file_path
        if full_path.exists():
            print(f"✅ {file_path}")
        else:
            print(f"❌ {file_path} (MISSING)")

def main():
    print("\n" + "=" * 50)
    print("Starting comprehensive system check...")
    print("=" * 50)
    
    test_imports()
    test_database()
    test_ai_model()
    test_crud_functions()
    check_file_structure()
    
    print("\n" + "=" * 50)
    print("Debug complete!")
    print("=" * 50)

def test_database_connection():
    """اختبار الاتصال بقاعدة البيانات"""
    try:
        db = SessionLocal()
        
        # محاولة قراءة جدول المستخدمين
        users = db.query(User).all()
        print(f"✅ Database connected successfully. Found {len(users)} users")
        
        # عرض المستخدمين إذا وجدوا
        for user in users:
            auth = db.query(UserAuth).filter(UserAuth.user_id == user.id).first()
            print(f"  👤 User: {user.name}, Email: {auth.email if auth else 'No auth'}")
        
        db.close()
        return True
        
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False

if __name__ == "__main__":
    test_database_connection()
    main()