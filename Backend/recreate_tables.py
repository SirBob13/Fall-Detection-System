# Backend/recreate_tables.py
import sys
import os

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import engine, Base, init_db
from app.models import *

def main():
    print("🔧 Starting database recreation...")
    
    try:
        # حذف جميع الجداول
        print("🗑️  Dropping all tables...")
        Base.metadata.drop_all(bind=engine)
        print("✅ Tables dropped successfully")
        
        # إنشاء جميع الجداول من جديد
        print("📦 Creating all tables...")
        Base.metadata.create_all(bind=engine)
        print("✅ Tables created successfully")
        
        # إنشاء بيانات تجريبية
        print("📝 Creating test data...")
        init_db()
        print("✅ Test data created")
        
        print("\n🎉 Database recreation completed successfully!")
        print("📊 Tables recreated:")
        for table in Base.metadata.tables.keys():
            print(f"   - {table}")
            
    except Exception as e:
        print(f"❌ Error recreating tables: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()