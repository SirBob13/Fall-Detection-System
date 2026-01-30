#!/usr/bin/env python3
"""
Run script for Fall Detection System - FIXED VERSION
"""

import sys
import os
from pathlib import Path

# Add current directory to path
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

def main():
    print("=" * 60)
    print("🎯 Fall Detection System Manager")
    print("=" * 60)
    
    print("\nChoose an option:")
    print("1. 🚀 Run main API server")
    print("2. 🎮 Run sensor simulator")
    print("3. 🧪 Run system tests")
    print("4. 📊 View system status")
    print("5. 🔧 Run debug check")
    print("\nPress Ctrl+C to exit")
    print("=" * 60)
    
    try:
        choice = input("\nEnter choice (1-5): ").strip()
        
        if choice == "1":
            run_server()
        elif choice == "2":
            run_simulator()
        elif choice == "3":
            run_tests()
        elif choice == "4":
            show_status()
        elif choice == "5":
            run_debug()
        else:
            print("Invalid choice")
            
    except KeyboardInterrupt:
        print("\n\nExiting...")
    except Exception as e:
        print(f"\nError: {e}")

def run_server():
    """Run the main API server"""
    import uvicorn
    
    print("\n🚀 Starting Fall Detection API Server...")
    print("📡 Host: 0.0.0.0")
    print("🔌 Port: 8000")
    print("📚 Docs: http://localhost:8000/docs")
    print("🏥 Health: http://localhost:8000/health")
    print("=" * 60)
    
    # الطريقة الصحيحة: تشغيل من ملف app/main.py
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["app"],
        log_level="info"
    )

def run_simulator():
    """Run the sensor simulator"""
    try:
        from simulator import main as run_sim
        run_sim()
    except ImportError as e:
        print(f"❌ Cannot import simulator: {e}")
        print("\nMake sure simulator.py exists in the Backend directory")

def run_tests():
    """Run system tests"""
    print("\n🧪 Running system tests...")
    
    try:
        import requests
        
        print("Testing API endpoints...")
        
        # Test 1: Root endpoint
        try:
            response = requests.get("http://localhost:8000/", timeout=5)
            print(f"✅ Root endpoint: {response.status_code}")
        except:
            print("❌ Root endpoint: Server not running")
        
        # Test 2: Health endpoint
        try:
            response = requests.get("http://localhost:8000/health", timeout=5)
            print(f"✅ Health endpoint: {response.status_code}")
        except:
            print("❌ Health endpoint: Failed")
        
        # Test 3: Test motion endpoint
        try:
            test_data = {
                "user_id": 1,
                "device_id": "TEST_001",
                "acc_x": 0.1,
                "acc_y": 0.2,
                "acc_z": 9.8,
                "gyro_x": 5.0,
                "gyro_y": -3.0,
                "gyro_z": 2.0,
            }
            response = requests.post("http://localhost:8000/api/v1/motion", 
                                   json=test_data, timeout=5)
            print(f"✅ Motion endpoint: {response.status_code}")
        except Exception as e:
            print(f"❌ Motion endpoint: {e}")
            
    except ImportError:
        print("❌ requests library not installed")
        print("Install it with: pip install requests")

def show_status():
    """Show system status"""
    print("\n📊 System Status")
    print("=" * 40)
    
    import requests
    try:
        response = requests.get("http://localhost:8000/health", timeout=3)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Server Status: {data.get('status', 'unknown')}")
            print(f"📅 Last Check: {data.get('timestamp', 'unknown')}")
            
            # Try to get root
            response = requests.get("http://localhost:8000/", timeout=3)
            if response.status_code == 200:
                info = response.json()
                print(f"🎯 API Version: {info.get('version', 'unknown')}")
        else:
            print(f"❌ Server error: {response.status_code}")
    except:
        print("❌ Cannot connect to server")

def run_debug():
    """Run debug checks"""
    print("\n🔧 Debug Information")
    print("=" * 40)
    
    print(f"Python version: {sys.version.split()[0]}")
    print(f"Working directory: {os.getcwd()}")
    print(f"Script directory: {current_dir}")
    
    # Check if app/main.py exists
    app_main_path = current_dir / "app" / "main.py"
    print(f"\n📁 Checking app/main.py: {app_main_path}")
    if app_main_path.exists():
        print(f"✅ app/main.py exists")
        
        # Check if 'app' is defined in app.main
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("app.main", str(app_main_path))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            if hasattr(module, 'app'):
                print("✅ 'app' found in app.main")
            else:
                print("❌ 'app' NOT found in app.main")
                print("   Available attributes:", [attr for attr in dir(module) if not attr.startswith('_')])
        except Exception as e:
            print(f"❌ Error checking app.main: {e}")
    else:
        print("❌ app/main.py NOT found")
    
    # Check required files
    print("\n📁 File structure check:")
    required_files = [
        "app/__init__.py",
        "app/main.py",
        "app/models.py",
        "app/database.py",
        "app/routes/main.py",
        "app/routes/auth.py",
    ]
    
    for file in required_files:
        file_path = current_dir / file
        if file_path.exists():
            print(f"✅ {file}")
        else:
            print(f"❌ {file} (MISSING)")
    
    print("\n🎯 Ready to run!")

if __name__ == "__main__":
    main()