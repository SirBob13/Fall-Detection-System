# AI/inference/predictor.py
"""
Production-ready inference helper for the Fall Detection project.

Provides:
- model/scaler loading
- preprocessing (scaling + sliding-window)
- batch prediction
- RealTimePredictor class for streaming data
"""

import os
import joblib
import numpy as np
from collections import deque
from typing import List, Tuple, Optional, Dict
import tensorflow as tf
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import *

# -----------------------------
# Resource loading
# -----------------------------
def load_model_and_scaler(model_path: str = None, scaler_path: str = None, verbose: bool = True):
    """Load the trained LSTM-Attention model and scaler."""
    
    if model_path is None:
        model_path = FINAL_MODEL_PATH
    if scaler_path is None:
        scaler_path = SCALER_PATH
    
    # Check if files exist
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model not found: {model_path}")
    if not os.path.exists(scaler_path):
        raise FileNotFoundError(f"Scaler not found: {scaler_path}")
    
    if verbose:
        print(f"Loading model from: {model_path}")
        print(f"Loading scaler from: {scaler_path}")
    
    # Load model and scaler
    model = tf.keras.models.load_model(model_path, compile=False)
    scaler = joblib.load(scaler_path)
    
    if verbose:
        print(f"Model loaded successfully. Input shape: {model.input_shape}")
        print(f"Scaler loaded. Features: {scaler.n_features_in_}")
    
    return model, scaler

# -----------------------------
# Preprocessing
# -----------------------------
def preprocess_single_row(row: List[float]) -> np.ndarray:
    """Preprocess a single row of sensor data."""
    if len(row) != 6:  # acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z
        raise ValueError(f"Expected 6 features, got {len(row)}")
    
    arr = np.array(row, dtype=np.float32)
    
    # Calculate magnitude
    acc_mag = np.sqrt(arr[0]**2 + arr[1]**2 + arr[2]**2)
    gyro_mag = np.sqrt(arr[3]**2 + arr[4]**2 + arr[5]**2)
    
    # Combine with original features
    return np.concatenate([arr, [acc_mag, gyro_mag]])

def create_sliding_windows(
    raw_array: np.ndarray,
    time_steps: int = TIME_STEPS,
    step_size: int = STEP_SIZE,
) -> np.ndarray:
    """Convert 2D array into 3D sliding windows."""
    
    if raw_array.ndim != 2:
        raise ValueError("raw_array must be 2D: (n_rows, n_features)")
    
    n_rows, n_features = raw_array.shape
    if n_rows < time_steps:
        return np.zeros((0, time_steps, n_features))
    
    windows = []
    for i in range(0, n_rows - time_steps + 1, step_size):
        windows.append(raw_array[i:i + time_steps])
    
    return np.stack(windows, axis=0)

def scale_windows(windows: np.ndarray, scaler) -> np.ndarray:
    """Scale windows using the fitted scaler."""
    
    if windows.size == 0:
        return windows
    
    n_windows, time_steps, n_features = windows.shape
    flat = windows.reshape(-1, n_features)
    scaled_flat = scaler.transform(flat)
    scaled = scaled_flat.reshape(n_windows, time_steps, n_features)
    
    return scaled

# -----------------------------
# Prediction
# -----------------------------
def predict_from_array(
    raw_array: np.ndarray,
    model,
    scaler,
    time_steps: int = TIME_STEPS,
    step_size: int = STEP_SIZE,
    threshold: float = FALL_THRESHOLD,
) -> Dict:
    """Full pipeline for batch prediction."""
    
    if raw_array.ndim != 2:
        raise ValueError("raw_array must be 2D: (n_rows, n_features)")
    
    # Create windows
    windows = create_sliding_windows(raw_array, time_steps=time_steps, step_size=step_size)
    if windows.shape[0] == 0:
        return {
            "probs_now": [],
            "probs_soon": [],
            "pred_now": [],
            "pred_soon": [],
            "n_windows": 0
        }
    
    # Scale windows
    scaled = scale_windows(windows, scaler)
    
    # Predict
    probs_now, probs_soon = model.predict(scaled, verbose=0)
    
    # Convert to binary predictions
    preds_now = (probs_now > threshold).astype(int).reshape(-1).tolist()
    preds_soon = (probs_soon > threshold).astype(int).reshape(-1).tolist()
    
    return {
        "probs_now": probs_now.reshape(-1).tolist(),
        "probs_soon": probs_soon.reshape(-1).tolist(),
        "pred_now": preds_now,
        "pred_soon": preds_soon,
        "n_windows": int(windows.shape[0])
    }

# -----------------------------
# Real-time predictor
# -----------------------------
class RealTimePredictor:
    """Real-time fall detection predictor."""
    
    def __init__(self, model, scaler, time_steps: int = TIME_STEPS, threshold: float = FALL_THRESHOLD):
        self.model = model
        self.scaler = scaler
        self.time_steps = time_steps
        self.threshold = threshold
        self.buffer = deque(maxlen=time_steps)
        self.predictions_history = []
        
    def add_row(self, row: List[float]):
        """Add a single row of sensor data and predict if buffer is full."""
        
        # Preprocess row
        processed_row = preprocess_single_row(row)
        
        # Add to buffer
        self.buffer.append(processed_row)
        
        # Check if buffer is full
        if len(self.buffer) < self.time_steps:
            return None
        
        # Prepare window for prediction
        window = np.stack(list(self.buffer), axis=0)
        window_scaled = scale_windows(window[np.newaxis, ...], self.scaler)
        
        # Predict
        probs_now, probs_soon = self.model.predict(window_scaled, verbose=0)
        
        # Convert to binary
        pred_now = int(probs_now[0][0] > self.threshold)
        pred_soon = int(probs_soon[0][0] > self.threshold)
        
        result = {
            "timestamp": np.datetime64('now'),
            "probs_now": float(probs_now[0][0]),
            "probs_soon": float(probs_soon[0][0]),
            "pred_now": pred_now,
            "pred_soon": pred_soon,
            "fall_detected": bool(pred_now),
            "fall_soon_warning": bool(pred_soon)
        }
        
        # Save to history
        self.predictions_history.append(result)
        
        return result
    
    def get_history(self, n_last: int = None):
        """Get prediction history."""
        if n_last is None:
            return self.predictions_history
        return self.predictions_history[-n_last:]
    
    def reset(self):
        """Reset buffer and history."""
        self.buffer.clear()
        self.predictions_history.clear()

# -----------------------------
# Test function
# -----------------------------
def test_predictor():
    """Test the predictor with sample data."""
    
    print("Testing predictor...")
    
    # Load resources
    model, scaler = load_model_and_scaler(verbose=True)
    
    # Create sample data
    n_samples = 100
    n_features = 8  # بعد preprocessing
    
    # Normal data (walking)
    normal_data = np.random.randn(n_samples, 6)
    normal_data[:, 2] += 9.8  # Add gravity to z-axis
    
    # Fall data
    fall_data = normal_data.copy()
    fall_data[50:, :] = np.random.randn(50, 6) * 5  # Simulate fall
    
    # Test batch prediction
    print("\nTesting batch prediction...")
    
    # Preprocess data
    processed_data = []
    for row in normal_data:
        processed_data.append(preprocess_single_row(row))
    processed_data = np.array(processed_data)
    
    result = predict_from_array(processed_data, model, scaler)
    print(f"Batch prediction result: {result['n_windows']} windows")
    print(f"Fall detections: {sum(result['pred_now'])}")
    
    # Test real-time prediction
    print("\nTesting real-time prediction...")
    rt_predictor = RealTimePredictor(model, scaler)
    
    for i, row in enumerate(normal_data):
        result = rt_predictor.add_row(row.tolist())
        if result is not None and result['fall_detected']:
            print(f"Fall detected at sample {i}: {result}")
    
    return model, scaler

if __name__ == "__main__":
    test_predictor()