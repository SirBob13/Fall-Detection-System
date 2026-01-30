# Backend/simulator.py
"""
Fixed sensor simulator for Fall Detection System
"""

import time
import requests
import random
import sys
from datetime import datetime

API_BASE = "http://localhost:8000/api/v1"

def print_header():
    print("=" * 60)
    print("            FALL DETECTION SENSOR SIMULATOR")
    print("=" * 60)
    print("\nThis simulator will:")
    print("1. Test API connection")
    print("2. Create test data")
    print("3. Simulate normal and fall motions")
    print("4. Display AI predictions in real-time")
    print("\nPress Ctrl+C to stop the simulation")
    print("=" * 60)

def test_api():
    """Test if API is available."""
    print("\n🔍 Testing API connection...")
    try:
        response = requests.get(f"{API_BASE}/health", timeout=10)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ API is running!")
            print(f"   Status: {data.get('status', 'unknown')}")
            print(f"   Database: {data.get('database', 'unknown')}")
            print(f"   Model loaded: {data.get('model_loaded', 'unknown')}")
            return True
        else:
            print(f"❌ API error: {response.status_code}")
            print(f"   Response: {response.text[:100]}")
            return False
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to API. Is the server running?")
        print(f"   Trying to connect to: {API_BASE}/health")
        return False
    except Exception as e:
        print(f"❌ Cannot connect to API: {e}")
        print(f"   Make sure the server is running on {API_BASE}")
        return False

def create_test_data():
    """Create test user and device if needed."""
    print("\n👤 Creating test data...")
    
    # Try to create test user
    try:
        user_data = {
            "name": "Test User",
            "age": 75,
            "gender": "male",
            "weight": 70.0,
            "height": 170.0,
            "medical_conditions": "Hypertension",
            "emergency_contact": "+201234567890"
        }
        response = requests.post(f"{API_BASE}/users", json=user_data, timeout=5)
        if response.status_code in [200, 201]:
            print("✅ Test user created/verified")
        else:
            print(f"⚠️ User creation status: {response.status_code}")
    except Exception as e:
        print(f"⚠️ Error with user: {e}")
    
    # Try to create test device
    try:
        device_data = {
            "user_id": 1,
            "device_id": "SIMULATOR_001",
            "mac_address": "AA:BB:CC:DD:EE:FF",
            "firmware_version": "1.0.0",
            "battery_level": 85.0
        }
        response = requests.post(f"{API_BASE}/devices", json=device_data, timeout=5)
        if response.status_code in [200, 201]:
            print("✅ Test device registered")
        else:
            print(f"⚠️ Device registration status: {response.status_code}")
    except Exception as e:
        print(f"⚠️ Error with device: {e}")

def simulate_motion(is_fall=False):
    """Generate motion data."""
    if is_fall:
        # Fall motion data
        return {
            "acc_x": random.uniform(-4.0, 4.0),
            "acc_y": random.uniform(-4.0, 4.0),
            "acc_z": random.uniform(0.5, 3.0),  # Sudden drop in z-axis
            "gyro_x": random.uniform(-180, 180),
            "gyro_y": random.uniform(-180, 180),
            "gyro_z": random.uniform(-180, 180),
            "temperature": 36.5 + random.uniform(-0.5, 0.5)
        }
    else:
        # Normal motion data
        return {
            "acc_x": random.uniform(-1.0, 1.0),
            "acc_y": random.uniform(-1.0, 1.0),
            "acc_z": 9.8 + random.uniform(-0.3, 0.3),  # Normal gravity
            "gyro_x": random.uniform(-30, 30),
            "gyro_y": random.uniform(-30, 30),
            "gyro_z": random.uniform(-30, 30),
            "temperature": 36.5 + random.uniform(-0.2, 0.2)
        }

def simulate_vital():
    """Generate vital signs data."""
    return {
        "user_id": 1,
        "heart_rate": random.uniform(65, 85),
        "blood_pressure_systolic": random.uniform(115, 135),
        "blood_pressure_diastolic": random.uniform(75, 85),
        "oxygen_saturation": random.uniform(96, 99),
        "body_temperature": 36.6 + random.uniform(-0.2, 0.2),
        "respiration_rate": random.uniform(14, 18)
    }

def run_simulation():
    """Run the main simulation loop."""
    print("\n🚀 Starting simulation...\n")
    
    iteration = 0
    fall_count = 0
    detection_count = 0
    
    try:
        while True:
            iteration += 1
            
            # Decide if this is a fall (15% chance)
            is_fall = random.random() < 0.15
            if is_fall:
                fall_count += 1
                motion_type = "FALL"
                emoji = "📢"
            else:
                motion_type = "NORMAL"
                emoji = "🚶"
            
            # Generate motion data
            motion_data = simulate_motion(is_fall)
            
            # Prepare payload
            payload = {
                "user_id": 1,
                "device_id": "SIMULATOR_001",
                **motion_data
            }
            
            # Send to API
            try:
                response = requests.post(f"{API_BASE}/motion", json=payload, timeout=5)
                
                if response.status_code == 200:
                    result = response.json()
                    prediction = result.get("prediction", {})
                    
                    # Display result
                    now_prob = prediction.get("fall_now_probability", 0)
                    soon_prob = prediction.get("fall_soon_probability", 0)
                    detected = prediction.get("fall_now_prediction", False)
                    confidence = prediction.get("confidence_score", 0)
                    
                    if detected:
                        detection_count += 1
                        status = "🚨 DETECTED"
                        color_code = 91  # Red
                    elif prediction.get("fall_soon_prediction", False):
                        status = "⚠️ WARNING"
                        color_code = 93  # Yellow
                    else:
                        status = "✅ NORMAL"
                        color_code = 92  # Green
                    
                    # Format output with colors
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    print(f"[{timestamp}] [{iteration:03d}] {emoji} {motion_type:6} | \033[{color_code}m{status:10}\033[0m | Now: {now_prob:.1%} | Soon: {soon_prob:.1%} | Conf: {confidence:.1%}")
                    
                    # Show alert if generated
                    if result.get("alert_generated"):
                        print(f"      📱 ALERT GENERATED: {result.get('alert_id')}")
                
                elif response.status_code == 404:
                    print(f"[{iteration:03d}] ❌ API endpoint not found: /motion")
                    print("      Check if the server routes are correctly defined")
                    break
                elif response.status_code == 422:
                    print(f"[{iteration:03d}] ⚠️ Validation error")
                    print(f"      Response: {response.text[:100]}")
                else:
                    print(f"[{iteration:03d}] ❌ API Error {response.status_code}")
                    print(f"      Response: {response.text[:100]}")
                    
            except requests.exceptions.RequestException as e:
                print(f"[{iteration:03d}] ❌ Request failed: {e}")
            
            # Send vital data every 10 iterations
            if iteration % 10 == 0:
                try:
                    vital_payload = simulate_vital()
                    response = requests.post(f"{API_BASE}/vitals", json=vital_payload, timeout=3)
                    if response.status_code in [200, 201]:
                        print(f"[{iteration:03d}] 💓 Vital data sent")
                except:
                    pass  # Silently continue
            
            time.sleep(1.5)  # 1.5 second intervals
            
    except KeyboardInterrupt:
        print(f"\n\n{'='*60}")
        print("📊 SIMULATION SUMMARY")
        print("="*60)
        print(f"Total iterations: {iteration}")
        print(f"Simulated falls: {fall_count}")
        print(f"Detected falls: {detection_count}")
        if fall_count > 0:
            accuracy = (detection_count / fall_count) * 100
            print(f"Detection accuracy: {accuracy:.1f}%")
        print("\n✅ Simulation completed successfully!")
        print("="*60)

def main():
    """Main function."""
    print_header()
    
    input("\nPress Enter to start simulation...")
    
    # Test API first
    if not test_api():
        print("\n❌ Cannot start simulation without API connection.")
        print("Please start the server first:")
        print("  cd Backend && python run.py run")
        print("\nOr try:")
        print("  curl http://localhost:8000/api/v1/health")
        return
    
    # Create test data
    create_test_data()
    
    # Run simulation
    run_simulation()

if __name__ == "__main__":
    main()