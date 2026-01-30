import requests
import time
import random

# endpoint للموديل prediction
URL_PREDICT = "http://127.0.0.1:8000/predict/"

def generate_sensor_data():
    """توليد بيانات عشوائية للمحاكاة"""
    return {
        "user_id": 1,
        "acc_x": round(random.uniform(-2, 2), 3),
        "acc_y": round(random.uniform(-2, 2), 3),
        "acc_z": round(random.uniform(8, 11), 3),  # الجاذبية ~9.8
        "gyro_x": round(random.uniform(-50, 50), 3),
        "gyro_y": round(random.uniform(-50, 50), 3),
        "gyro_z": round(random.uniform(-50, 50), 3)
    }

def generate_fall_data():
    """توليد بيانات سقوط"""
    return {
        "user_id": 1,
        "acc_x": round(random.uniform(-5, 5), 3),
        "acc_y": round(random.uniform(-5, 5), 3),
        "acc_z": round(random.uniform(-2, 2), 3),  # تغيير كبير في Z
        "gyro_x": round(random.uniform(-200, 200), 3),
        "gyro_y": round(random.uniform(-200, 200), 3),
        "gyro_z": round(random.uniform(-200, 200), 3)
    }

if __name__ == "__main__":
    print("Testing Fall Detection API...")
    print("Press Ctrl+C to stop")
    
    fall_counter = 0
    
    try:
        while True:
            # 20% من الوقت نبعت بيانات سقوط
            if random.random() < 0.2 and fall_counter < 5:
                payload = generate_fall_data()
                print("📢 Sending FALL data")
                fall_counter += 1
            else:
                payload = generate_sensor_data()
                print("📢 Sending normal data")
            
            # إرسال البيانات للـ API
            try:
                r = requests.post(URL_PREDICT, json=payload, timeout=5)
                
                if r.status_code == 200:
                    result = r.json()
                    print(f"Response: {result}")
                    
                    # إشعار بالسقوط
                    if result.get("fall_detected"):
                        print("⚠️ ⚠️ ⚠️ FALL DETECTED! Sending alert...")
                    elif result.get("fall_soon_warning"):
                        print("⚠️ Warning: Potential fall soon")
                else:
                    print(f"❌ Request failed: {r.status_code}")
                    print(f"Response: {r.text}")
                    
            except requests.exceptions.RequestException as e:
                print(f"❌ Connection error: {e}")
            
            time.sleep(1)  # انتظر ثانية بين الطلبات
            
    except KeyboardInterrupt:
        print("\nTest stopped by user")