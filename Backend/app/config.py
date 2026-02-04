import os
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"

# AI paths - SINGLE MODEL VERSION
AI_DIR = BASE_DIR.parent / "AI"

# Single model path
MODEL_PATH = AI_DIR / "models" / "fall_detection_final.keras"

# Single scaler path
SCALER_PATH = AI_DIR / "scaler" / "scaler_final.save"

# MUST match the trained model (100 time steps)
TIME_STEPS = 100
# Feature engineering window (must match training)
VAR_WINDOW = 10

# Thresholds (must match training)
FALL_THRESHOLD_NOW = 0.35
FALL_THRESHOLD_SOON = 0.30

print(f"🔍 AI Model Path: {MODEL_PATH}")
print(f"🔍 AI Scaler Path: {SCALER_PATH}")
print(f"🔍 Time Steps: {TIME_STEPS}")

# Database settings - Fixed for MAMP
DB_CONNECTION = os.getenv("DB_CONNECTION", "mysql")
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "8889")  # MAMP default
DB_DATABASE = os.getenv("DB_DATABASE", "fall_detection")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "root")

# Fix: Using single connection string compatible with MAMP
if os.path.exists("/Applications/MAMP/tmp/mysql/mysql.sock"):
    DB_SOCKET = "/Applications/MAMP/tmp/mysql/mysql.sock"
else:
    DB_SOCKET = None

# Double Verification settings
VITAL_CHECK_INTERVAL = 1800  # 30 minutes in seconds
VITAL_MONITOR_DURATION = 60   # 1 minute in seconds
VITAL_CHANGE_THRESHOLD = 0.2  # 20% change threshold

# Alert settings
ALERT_COOLDOWN = 300  # 5 minutes between alerts for same user
EMERGENCY_CONTACTS = ["+201234567890"]  # Example contacts

# Sensor thresholds
ACCELERATION_THRESHOLD = 2.5  # g
GYRO_THRESHOLD = 200  # degrees/second

# API settings
API_HOST = "0.0.0.0"
API_PORT = 8000
DEBUG = True

# Logging
LOG_DIR = BASE_DIR / "logs"
LOG_FILE = LOG_DIR / "fall_detection.log"

# Create directories if they don't exist
LOG_DIR.mkdir(exist_ok=True)

# JWT Settings
SECRET_KEY = os.getenv("SECRET_KEY", "fall-detection-secret-key-2024-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 43200
REFRESH_TOKEN_EXPIRE_DAYS = 90

# Social Login Settings
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_IDS = os.getenv("GOOGLE_CLIENT_IDS", "")
APPLE_CLIENT_ID = os.getenv("APPLE_CLIENT_ID", "")
ALLOW_UNVERIFIED_SOCIAL_LOGIN = os.getenv("ALLOW_UNVERIFIED_SOCIAL_LOGIN", "true").lower() == "true"

# Email Settings (optional)
SMTP_SERVER = os.getenv("SMTP_SERVER", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", "noreply@falldetection.com")

# Mock mode settings
USE_MOCK_DATA = os.getenv("USE_MOCK_DATA", "true").lower() == "true"
MOCK_FALL_PROBABILITY = 0.15  # 15% chance of mock fall
