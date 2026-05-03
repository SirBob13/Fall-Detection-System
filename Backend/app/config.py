import os
from pathlib import Path
from dotenv import load_dotenv

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"

# Load environment variables from the project .env if present.
load_dotenv(BASE_DIR / ".env")

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

# Realtime gating:
# The model was trained on a 100-step sequence. With the firmware now sending
# 50 Hz raw-motion batches, waiting for the full sequence means only ~2 seconds
# of warmup, which is a reasonable tradeoff for higher confidence alerts.
MIN_REALTIME_SAMPLES_FOR_ALERT = int(os.getenv("MIN_REALTIME_SAMPLES_FOR_ALERT", "100"))

# Model thresholds
# `FALL_THRESHOLD_NOW` and `FALL_THRESHOLD_SOON` are used for prediction labeling.
# Alerting is stricter and handled in the double-verification layer.
FALL_THRESHOLD_NOW = float(os.getenv("FALL_THRESHOLD_NOW", "0.55"))
FALL_THRESHOLD_SOON = float(os.getenv("FALL_THRESHOLD_SOON", "0.80"))

# Alerting thresholds
# If vitals confirm stress/abnormality we can accept a lower motion score.
FALL_ALERT_THRESHOLD = float(os.getenv("FALL_ALERT_THRESHOLD", "0.85"))
FALL_ALERT_WITH_VITALS_THRESHOLD = float(os.getenv("FALL_ALERT_WITH_VITALS_THRESHOLD", "0.70"))

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

# Vital thresholds (can override via env)
VITAL_HR_MIN = float(os.getenv("VITAL_HR_MIN", "50"))
VITAL_HR_MAX = float(os.getenv("VITAL_HR_MAX", "120"))
VITAL_SPO2_MIN = float(os.getenv("VITAL_SPO2_MIN", "90"))
VITAL_TEMP_MIN = float(os.getenv("VITAL_TEMP_MIN", "35.0"))
VITAL_TEMP_MAX = float(os.getenv("VITAL_TEMP_MAX", "38.5"))

# Vital sanity ranges (filter obvious sensor noise)
VITAL_HR_MIN_VALID = float(os.getenv("VITAL_HR_MIN_VALID", "30"))
VITAL_HR_MAX_VALID = float(os.getenv("VITAL_HR_MAX_VALID", "220"))
VITAL_SPO2_MIN_VALID = float(os.getenv("VITAL_SPO2_MIN_VALID", "70"))
VITAL_SPO2_MAX_VALID = float(os.getenv("VITAL_SPO2_MAX_VALID", "100"))
VITAL_TEMP_MIN_VALID = float(os.getenv("VITAL_TEMP_MIN_VALID", "30.0"))
VITAL_TEMP_MAX_VALID = float(os.getenv("VITAL_TEMP_MAX_VALID", "42.0"))

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
USE_MOCK_DATA = os.getenv("USE_MOCK_DATA", "false").lower() == "true"
MOCK_FALL_PROBABILITY = 0.15  # 15% chance of mock fall

# Admin access (comma-separated emails)
ADMIN_EMAILS_RAW = os.getenv("ADMIN_EMAILS", "")
ADMIN_EMAILS = [e.strip().lower() for e in ADMIN_EMAILS_RAW.split(",") if e.strip()]

# Docs exposure (disable in production)
EXPOSE_DOCS = os.getenv("EXPOSE_DOCS", "false").lower() == "true"

# CORS origins (comma-separated; default "*")
CORS_ORIGINS_RAW = os.getenv("CORS_ORIGINS", "*")
CORS_ORIGINS = [o.strip() for o in CORS_ORIGINS_RAW.split(",") if o.strip()]

# Push/SMS notifications
ENABLE_PUSH_ALERTS = os.getenv("ENABLE_PUSH_ALERTS", "true").lower() == "true"
ENABLE_SMS_ALERTS = os.getenv("ENABLE_SMS_ALERTS", "false").lower() == "true"

EXPO_PUSH_URL = os.getenv("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
EXPO_ACCESS_TOKEN = os.getenv("EXPO_ACCESS_TOKEN", "")

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
