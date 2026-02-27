import requests

BASE_URL = "http://127.0.0.1:8000"

# مثال: استدعاء endpoint موجود عندك
try:
    r = requests.get(f"{BASE_URL}/health")  # لو عندك endpoint للفحص
    if r.status_code == 200:
        print("✅ Backend is running fine!")
        print("Response:", r.json())
    else:
        print("⚠️ Backend running but returned error:", r.status_code)
except Exception as e:
    print("❌ Backend not reachable:", e)
