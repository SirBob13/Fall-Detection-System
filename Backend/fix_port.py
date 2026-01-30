# Backend/fix_port.py

import os
import subprocess
import sys

def find_and_kill_process(port=8000):
    """إيجاد وإيقاف العملية التي تستخدم البورت"""
    
    print(f"🔍 البحث عن عمليات تستخدم البورت {port}...")
    
    try:
        # للأجهزة التي تعمل بنظام macOS/Linux
        result = subprocess.run(
            f"lsof -ti:{port}", 
            shell=True, 
            capture_output=True, 
            text=True
        )
        
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            print(f"📌 وجد {len(pids)} عملية تستخدم البورت {port}")
            
            for pid in pids:
                print(f"🛑 إيقاف العملية {pid}...")
                subprocess.run(f"kill -9 {pid}", shell=True)
            
            print("✅ تم إيقاف جميع العمليات")
            return True
        else:
            print("✅ لا توجد عمليات تستخدم البورت")
            return True
            
    except Exception as e:
        print(f"❌ خطأ في البحث عن العمليات: {e}")
        
        # محاولة استخدام طريقة بديلة
        try:
            import psutil
            
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    connections = proc.connections()
                    for conn in connections:
                        if conn.laddr.port == port:
                            print(f"🛑 إيقاف العملية {proc.pid} ({proc.name()})...")
                            proc.kill()
                except:
                    pass
                    
            print("✅ تم تنظيف البورت")
            return True
            
        except ImportError:
            print("⚠️ يلزم تثبيت psutil: pip install psutil")
            return False

def change_port_in_config():
    """تغيير البورت في ملفات التكوين"""
    
    print("\n🔄 تحديث إعدادات البورت...")
    
    # 1. تحديث ملف run.py
    run_py_path = "run.py"
    
    if os.path.exists(run_py_path):
        with open(run_py_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # تغيير البورت من 8000 إلى 8001
        content = content.replace('port=8000', 'port=8001')
        content = content.replace('Port: 8000', 'Port: 8001')
        content = content.replace('localhost:8000', 'localhost:8001')
        
        with open(run_py_path, 'w', encoding='utf-8') as file:
            file.write(content)
        
        print("✅ تم تحديث run.py")
    
    # 2. تحديث ملفات التطبيق
    config_files = [
        "app/config.py",
        "MobileApp/src/utils/constants.ts",
        "MobileApp/app.json"
    ]
    
    for config_file in config_files:
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8') as file:
                    content = file.read()
                
                # استبدال البورت
                content = content.replace(':8000', ':8001')
                content = content.replace('"8000"', '"8001"')
                
                with open(config_file, 'w', encoding='utf-8') as file:
                    file.write(content)
                
                print(f"✅ تم تحديث {config_file}")
                
            except Exception as e:
                print(f"⚠️ لم يتم تحديث {config_file}: {e}")
    
    print("\n📋 ملخص التغييرات:")
    print("  - البورت الرئيسي: 8000 → 8001")
    print("  - رابط API: http://localhost:8001/api/v1")
    print("  - الوثائق: http://localhost:8001/docs")

def setup_new_server():
    """إعداد وتشغيل خادم جديد"""
    
    print("\n🚀 إعداد خادم جديد...")
    
    # 1. إيقاف العمليات القديمة
    find_and_kill_process(8000)
    find_and_kill_process(8001)  # في حال كان 8001 مشغولاً أيضاً
    
    # 2. تغيير البورت في التكوين
    change_port_in_config()
    
    # 3. تشغيل الخادم
    print("\n🎯 تشغيل الخادم على البورت 8001...")
    print("=" * 60)
    
    try:
        # تشغيل الخادم مباشرة
        import uvicorn
        from main import app
        
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=8001,
            reload=True,
            log_level="info"
        )
        
    except Exception as e:
        print(f"❌ خطأ في تشغيل الخادم: {e}")
        print("\nيمكنك تشغيل الخادم يدوياً:")
        print("  python run.py")
        print("\nأو:")
        print("  uvicorn main:app --host 0.0.0.0 --port 8001 --reload")

def main():
    """الوظيفة الرئيسية"""
    print("🔧 إصلاح مشكلة البورت المشغول")
    print("=" * 50)
    
    print("\nاختر خياراً:")
    print("1. إيقاف العمليات القديمة واستخدام البورت 8000")
    print("2. تغيير البورت إلى 8001 وتشغيل خادم جديد")
    print("3. إظهار العمليات النشطة فقط")
    
    choice = input("\nادخل الخيار (1-3): ").strip()
    
    if choice == "1":
        # خيار 1: تنظيف البورت 8000
        if find_and_kill_process(8000):
            print("\n✅ يمكنك الآن تشغيل الخادم:")
            print("  python run.py")
    elif choice == "2":
        # خيار 2: تغيير البورت
        setup_new_server()
    elif choice == "3":
        # خيار 3: عرض العمليات
        os.system("lsof -i :8000")
        os.system("lsof -i :8001")
    else:
        print("❌ خيار غير صالح")

if __name__ == "__main__":
    main()