#!/bin/bash

echo "🚀 Starting Fall Detection System..."
echo "======================================"

# تنشيط البيئة الافتراضية (إذا كنت تستخدمها)
if [ -d "venv" ]; then
    echo "🔧 Activating virtual environment..."
    source venv/bin/activate
fi

# تثبيت المتطلبات إذا لزم الأمر
if [ ! -d "venv" ] && [ "$1" == "--install" ]; then
    echo "📦 Installing requirements..."
    pip install -r requirements.txt
fi

# إنشاء قاعدة البيانات إذا لم تكن موجودة
echo "🗄️  Initializing database..."
python -c "
from app.database import init_db, test_connection
if test_connection():
    init_db()
else:
    print('⚠️ Using SQLite database')
"

# تشغيل السيرفر
echo "🌐 Starting API server on http://localhost:8000"
echo "📚 API Docs: http://localhost:8000/docs"
echo "======================================"
echo "Press Ctrl+C to stop the server"
echo ""

python main.py