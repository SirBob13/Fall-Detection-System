# Backend/app/ai_model.py
"""
AI Model integration for fall detection.
Uses the trained LSTM-Attention model.
"""

import os
import numpy as np
import tensorflow as tf
import joblib
import logging
from typing import Tuple, Optional, Dict
from datetime import datetime

from .config import MODEL_PATH, SCALER_PATH, TIME_STEPS

logger = logging.getLogger(__name__)

# Global variables for model and scaler
_model = None
_scaler = None

def load_model_and_scaler() -> Tuple[tf.keras.Model, any]:
    """Load the AI model and scaler (singleton pattern)."""
    global _model, _scaler
    
    if _model is None or _scaler is None:
        try:
            logger.info(f"Loading model from: {MODEL_PATH}")
            logger.info(f"Loading scaler from: {SCALER_PATH}")
            
            # Check if files exist
            if not os.path.exists(MODEL_PATH):
                raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")
            if not os.path.exists(SCALER_PATH):
                raise FileNotFoundError(f"Scaler file not found: {SCALER_PATH}")
            
            # Load model
            _model = tf.keras.models.load_model(MODEL_PATH, compile=False)
            
            # Load scaler
            _scaler = joblib.load(SCALER_PATH)
            
            logger.info(f"Model loaded successfully. Input shape: {_model.input_shape}")
            logger.info(f"Scaler loaded. Features: {_scaler.n_features_in_}")
            
        except Exception as e:
            logger.error(f"Failed to load model/scaler: {e}")
            raise
    
    return _model, _scaler

def preprocess_motion_data(
    acc_x: float, acc_y: float, acc_z: float,
    gyro_x: float, gyro_y: float, gyro_z: float
) -> np.ndarray:
    """Preprocess single motion data row."""
    
    # Calculate magnitude
    acc_mag = np.sqrt(acc_x**2 + acc_y**2 + acc_z**2)
    gyro_mag = np.sqrt(gyro_x**2 + gyro_y**2 + gyro_z**2)
    
    # Create feature array
    features = np.array([
        acc_x, acc_y, acc_z,
        gyro_x, gyro_y, gyro_z,
        acc_mag, gyro_mag
    ], dtype=np.float32)
    
    return features

def create_sequences_from_buffer(buffer: np.ndarray, time_steps: int = TIME_STEPS) -> np.ndarray:
    """Create sequences from buffer of motion data."""
    
    if len(buffer) < time_steps:
        # Pad with zeros if not enough data
        padding = np.zeros((time_steps - len(buffer), 8))
        buffer = np.vstack([padding, buffer])
    elif len(buffer) > time_steps:
        # Take only the last time_steps
        buffer = buffer[-time_steps:]
    
    # Reshape for model: (1, time_steps, features)
    return buffer.reshape(1, time_steps, 8)

def predict_fall(
    motion_buffer: np.ndarray,
    threshold: float = 0.5
) -> Dict:
    """
    Predict fall from motion buffer.
    
    Args:
        motion_buffer: Array of shape (n_samples, 8) containing preprocessed motion data
        threshold: Prediction threshold
    
    Returns:
        Dictionary with prediction results
    """
    
    try:
        # Load model and scaler
        model, scaler = load_model_and_scaler()
        
        # Create sequences
        sequences = create_sequences_from_buffer(motion_buffer)
        
        # Scale the data
        n_samples, time_steps, n_features = sequences.shape
        flat = sequences.reshape(-1, n_features)
        scaled_flat = scaler.transform(flat)
        scaled = scaled_flat.reshape(n_samples, time_steps, n_features)
        
        # Make prediction
        pred_now, pred_soon = model.predict(scaled, verbose=0)
        
        # Process results
        fall_now_prob = float(pred_now[0][0])
        fall_soon_prob = float(pred_soon[0][0])
        
        fall_now = fall_now_prob > threshold
        fall_soon = fall_soon_prob > threshold
        
        return {
            "success": True,
            "fall_now_probability": fall_now_prob,
            "fall_soon_probability": fall_soon_prob,
            "fall_now_prediction": bool(fall_now),
            "fall_soon_prediction": bool(fall_soon),
            "threshold": threshold,
            "timestamp": datetime.utcnow()
        }
        
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "fall_now_probability": 0.0,
            "fall_soon_probability": 0.0,
            "fall_now_prediction": False,
            "fall_soon_prediction": False
        }

def check_vital_abnormality(
    current_vitals: Dict,
    previous_vitals: Dict,
    threshold: float = 0.2
) -> Tuple[bool, str]:
    """
    Check if vital signs show abnormality compared to previous reading.
    
    Args:
        current_vitals: Current vital signs
        previous_vitals: Previous vital signs
        threshold: Percentage change threshold
    
    Returns:
        Tuple of (is_abnormal, abnormality_type)
    """
    
    abnormalities = []
    
    # Check heart rate
    if (current_vitals.get('heart_rate') and previous_vitals.get('heart_rate')):
        hr_change = abs(current_vitals['heart_rate'] - previous_vitals['heart_rate']) / previous_vitals['heart_rate']
        if hr_change > threshold:
            abnormalities.append("heart_rate")
    
    # Check oxygen saturation
    if (current_vitals.get('oxygen_saturation') and previous_vitals.get('oxygen_saturation')):
        spo2_change = abs(current_vitals['oxygen_saturation'] - previous_vitals['oxygen_saturation']) / 100
        if spo2_change > threshold:
            abnormalities.append("oxygen_saturation")
    
    # Check blood pressure
    if (current_vitals.get('blood_pressure_systolic') and previous_vitals.get('blood_pressure_systolic')):
        bp_change = abs(current_vitals['blood_pressure_systolic'] - previous_vitals['blood_pressure_systolic']) / previous_vitals['blood_pressure_systolic']
        if bp_change > threshold:
            abnormalities.append("blood_pressure")
    
    # Determine result
    if abnormalities:
        return True, ", ".join(abnormalities)
    else:
        return False, "normal"

# Test function
def test_prediction():
    """Test the prediction function."""
    
    print("Testing AI model prediction...")
    
    # Create test buffer
    test_buffer = []
    for i in range(100):
        features = preprocess_motion_data(
            acc_x=np.random.uniform(-2, 2),
            acc_y=np.random.uniform(-2, 2),
            acc_z=9.8 + np.random.uniform(-1, 1),
            gyro_x=np.random.uniform(-50, 50),
            gyro_y=np.random.uniform(-50, 50),
            gyro_z=np.random.uniform(-50, 50)
        )
        test_buffer.append(features)
    
    test_buffer = np.array(test_buffer)
    
    # Make prediction
    result = predict_fall(test_buffer)
    
    print(f"Prediction result: {result}")
    return result

if __name__ == "__main__":
    test_prediction()