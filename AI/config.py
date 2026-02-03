# AI/config.py
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# =========================
# Paths
# =========================
MODELS_DIR = os.path.join(BASE_DIR, "models")
SCALER_DIR = os.path.join(BASE_DIR, "scaler")

FINAL_MODEL_PATH = os.path.join(
    MODELS_DIR, "fall_detection_final.keras"
)

SCALER_PATH = os.path.join(
    SCALER_DIR, "scaler_final.save"
)

# =========================
# Model parameters (MATCH TRAINING)
# =========================
TIME_STEPS = 100
STEP_SIZE = 5

# =========================
# Features (ENHANCED – 16)
# =========================
FEATURES = [
    'WristAccelerometer_x', 'WristAccelerometer_y', 'WristAccelerometer_z',
    'WristAngularVelocity_x', 'WristAngularVelocity_y', 'WristAngularVelocity_z',
    'Acc_mag', 'Gyro_mag',
    'Acc_var', 'Gyro_var', 'Acc_energy', 'Gyro_energy',
    'Jerk_mag', 'Acc_MAV', 'Acc_SMA', 'Acc_std'
]

# =========================
# Thresholds (FROM TRAINING RESULTS)
# =========================
FALL_THRESHOLD_NOW = 0.35
FALL_THRESHOLD_SOON = 0.30
