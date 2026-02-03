# AI/inference/predictor.py

import os
import sys
import joblib
import numpy as np
import tensorflow as tf
from collections import deque

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import *

# =================================================
# Load model & scaler
# =================================================
def load_model_and_scaler():
    if not os.path.exists(FINAL_MODEL_PATH):
        raise FileNotFoundError("Model not found")

    if not os.path.exists(SCALER_PATH):
        raise FileNotFoundError("Scaler not found")

    model = tf.keras.models.load_model(FINAL_MODEL_PATH, compile=False)
    scaler = joblib.load(SCALER_PATH)

    return model, scaler


# =================================================
# Feature Calculation (MATCH TRAINING EXACTLY)
# =================================================
def calculate_features(buffer):
    """
    buffer shape: (N, 6)
    columns:
    [acc_x, acc_y, acc_z, gx, gy, gz]
    """

    buf = np.array(buffer)

    acc_x, acc_y, acc_z = buf[:, 0], buf[:, 1], buf[:, 2]
    gx, gy, gz = buf[:, 3], buf[:, 4], buf[:, 5]

    # BASIC
    acc_mag = np.sqrt(acc_x**2 + acc_y**2 + acc_z**2)
    gyro_mag = np.sqrt(gx**2 + gy**2 + gz**2)

    # VARIANCE
    acc_var = (np.var(acc_x) + np.var(acc_y) + np.var(acc_z)) / 3
    gyro_var = (np.var(gx) + np.var(gy) + np.var(gz)) / 3

    # ENERGY
    acc_energy = acc_x[-1]**2 + acc_y[-1]**2 + acc_z[-1]**2
    gyro_energy = gx[-1]**2 + gy[-1]**2 + gz[-1]**2

    # JERK
    if len(acc_x) > 1:
        jerk_x = acc_x[-1] - acc_x[-2]
        jerk_y = acc_y[-1] - acc_y[-2]
        jerk_z = acc_z[-1] - acc_z[-2]
    else:
        jerk_x = jerk_y = jerk_z = 0

    jerk_mag = np.sqrt(jerk_x**2 + jerk_y**2 + jerk_z**2)

    # MAV
    acc_mav = (abs(acc_x[-1]) + abs(acc_y[-1]) + abs(acc_z[-1])) / 3

    # SMA
    acc_sma = abs(acc_x[-1]) + abs(acc_y[-1]) + abs(acc_z[-1])

    # STD
    acc_std = np.std([acc_x[-1], acc_y[-1], acc_z[-1]])

    return np.array([
        acc_x[-1], acc_y[-1], acc_z[-1],
        gx[-1], gy[-1], gz[-1],
        acc_mag[-1], gyro_mag[-1],
        acc_var, gyro_var,
        acc_energy, gyro_energy,
        jerk_mag, acc_mav, acc_sma, acc_std
    ], dtype=np.float32)


# =================================================
# Real-Time Predictor
# =================================================
class RealTimePredictor:

    def __init__(self):
        self.model, self.scaler = load_model_and_scaler()
        self.raw_buffer = deque(maxlen=TIME_STEPS)
        self.feature_buffer = deque(maxlen=TIME_STEPS)

    def add_row(self, row):
        """
        row = [acc_x, acc_y, acc_z, gx, gy, gz]
        """
        self.raw_buffer.append(row)

        if len(self.raw_buffer) < 2:
            return None

        features = calculate_features(self.raw_buffer)
        self.feature_buffer.append(features)

        if len(self.feature_buffer) < TIME_STEPS:
            return None

        window = np.array(self.feature_buffer).reshape(1, TIME_STEPS, -1)

        # Scale
        flat = window.reshape(-1, window.shape[-1])
        scaled = self.scaler.transform(flat).reshape(window.shape)

        # Predict
        probs_now, probs_soon = self.model.predict(scaled, verbose=0)

        result = {
            "fall_now_prob": float(probs_now[0][0]),
            "fall_soon_prob": float(probs_soon[0][0]),
            "fall_now": bool(probs_now[0][0] > FALL_THRESHOLD_NOW),
            "fall_soon": bool(probs_soon[0][0] > FALL_THRESHOLD_SOON)
        }

        return result
