# Backend/setup.py

import subprocess
import sys

def install_packages():
    """تثبيت الحزم المطلوبة"""
    
    packages = [
        "fastapi==0.109.2",
        "uvicorn[standard]==0.27.1",
        "pydantic==2.6.1",
        "sqlalchemy==2.0.25",
        "pysqlite3-binary",
        "alembic==1.13.1",
        "python-dotenv==1.0.1",
        "requests==2.31.0",
        "loguru==0.7.2",
        "numpy==1.26.4",
        "pandas==2.2.1",
        "scikit-learn==1.4.1.post1",
        "joblib==1.3.2",
        "python-jose[cryptography]==3.3.0",
        "passlib[bcrypt]==1.7.4",
        "bcrypt==4.1.2"
    ]
    
    print("🔧 Installing packages...")
    
    for package in packages:
        try:
            print(f"📦 Installing {package}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        except subprocess.CalledProcessError as e:
            print(f"⚠️ Failed to install {package}: {e}")
            # حاول بدون الإصدار
            try:
                base_pkg = package.split('==')[0].split('[')[0]
                subprocess.check_call([sys.executable, "-m", "pip", "install", base_pkg])
            except:
                print(f"❌ Skipping {package}")
    
    print("✅ Installation completed!")

if __name__ == "__main__":
    install_packages()