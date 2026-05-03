"""
AI Model Integration for Fall Detection System
Complete implementation with feature engineering, sliding windows,
and dual output handling for real-time fall detection.
"""

import os
import numpy as np
import pandas as pd
import joblib
import logging
import random
import warnings
from typing import Dict, Any, Tuple, Optional, List, Union
from datetime import datetime
from pathlib import Path
from collections import deque

try:
    import tensorflow as tf
    _TF_IMPORT_ERROR = None
except Exception as e:
    tf = None
    _TF_IMPORT_ERROR = e

# Import config
try:
    from ..config import (
        MODEL_PATH,
        SCALER_PATH,
        TIME_STEPS,
        USE_MOCK_DATA,
        FALL_THRESHOLD_NOW,
        FALL_THRESHOLD_SOON,
        VAR_WINDOW,
    )
except ImportError:
    # Default fallback values if config not available
    BASE_DIR = Path(__file__).resolve().parent.parent
    AI_DIR = BASE_DIR.parent / "AI"
    MODEL_PATH = AI_DIR / "models" / "fall_detection_final.keras"
    SCALER_PATH = AI_DIR / "scaler" / "scaler_final.save"
    TIME_STEPS = 100
    USE_MOCK_DATA = False
    VAR_WINDOW = 10
    FALL_THRESHOLD_NOW = 0.35
    FALL_THRESHOLD_SOON = 0.30

logger = logging.getLogger(__name__)

# Configure TensorFlow to be less verbose
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
if tf is not None:
    tf.get_logger().setLevel('ERROR')
else:
    logger.warning("⚠️ TensorFlow is unavailable, AI predictions will use mock mode: %s", _TF_IMPORT_ERROR)
warnings.filterwarnings('ignore')

# Global variables for loaded model and scaler (singleton pattern)
_model = None
_scaler = None
_model_metadata = {
    "name": None,
    "type": "enhanced",  # "basic" or "enhanced"
    "features_count": 16,  # Default to enhanced model
    "input_shape": None,
    "output_format": "dual",  # "single" or "dual"
    "sample_rate": 20  # Hz - default sample rate
}

# Feature configuration
FEATURE_CONFIG = {
    "basic": [
        'Accelerometer_X', 'Accelerometer_Y', 'Accelerometer_Z',
        'Gyroscope_X', 'Gyroscope_Y', 'Gyroscope_Z',
        'Acc_Magnitude', 'Gyro_Magnitude'
    ],
    "enhanced": [
        'Accelerometer_X', 'Accelerometer_Y', 'Accelerometer_Z',
        'Gyroscope_X', 'Gyroscope_Y', 'Gyroscope_Z',
        'Acc_Magnitude', 'Gyro_Magnitude',
        'Acc_Variance', 'Gyro_Variance',
        'Acc_Energy', 'Gyro_Energy',
        'Jerk_Magnitude', 'Acc_MAV', 'Acc_SMA', 'Acc_Std'
    ]
}

# Sliding window buffer (for real-time raw processing)
class SlidingWindowBuffer:
    def __init__(self, window_size: int = TIME_STEPS, num_features: int = 6):
        self.window_size = window_size
        self.num_features = num_features
        self.buffer = deque(maxlen=window_size * 2)  # Keep double for feature calculations
        
    def add_sample(self, sample: np.ndarray):
        """Add a single sample to the buffer."""
        if len(sample) != self.num_features:
            raise ValueError(f"Sample must have {self.num_features} features, got {len(sample)}")
        self.buffer.append(sample)
        
    def add_samples(self, samples: np.ndarray):
        """Add multiple samples to the buffer."""
        for sample in samples:
            self.add_sample(sample)
            
    def get_window(self) -> np.ndarray:
        """Get the most recent window of size window_size."""
        if len(self.buffer) < self.window_size:
            # Pad with zeros if not enough samples
            pad_size = self.window_size - len(self.buffer)
            padding = np.zeros((pad_size, self.num_features))
            return np.vstack([padding, np.array(self.buffer)])
        else:
            return np.array(list(self.buffer))[-self.window_size:]
            
    def clear(self):
        """Clear the buffer."""
        self.buffer.clear()
        
    def is_full(self) -> bool:
        """Check if buffer has at least window_size samples."""
        return len(self.buffer) >= self.window_size
        
    def size(self) -> int:
        """Get current buffer size."""
        return len(self.buffer)

# Global sliding window buffer (single stream fallback)
_buffer = SlidingWindowBuffer(window_size=TIME_STEPS, num_features=6)

# Per-device/user raw buffers
_raw_buffers: Dict[str, deque] = {}

def _get_raw_buffer(buffer_key: str) -> deque:
    """Get or create a raw buffer for a specific stream key."""
    if buffer_key not in _raw_buffers:
        _raw_buffers[buffer_key] = deque(maxlen=TIME_STEPS)
    return _raw_buffers[buffer_key]

def append_raw_sample(
    buffer_key: str,
    acc_x: float,
    acc_y: float,
    acc_z: float,
    gyro_x: float,
    gyro_y: float,
    gyro_z: float
) -> np.ndarray:
    """Append a raw sample to the per-stream buffer and return the buffer as ndarray."""
    buf = _get_raw_buffer(buffer_key)
    buf.append([acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z])
    return np.array(buf, dtype=np.float32)

def clear_raw_buffer(buffer_key: str) -> None:
    """Clear a per-stream buffer."""
    if buffer_key in _raw_buffers:
        _raw_buffers[buffer_key].clear()


def get_raw_buffer_size(buffer_key: str) -> int:
    """Return the current sample count for a specific realtime stream."""
    if buffer_key not in _raw_buffers:
        return 0
    return len(_raw_buffers[buffer_key])

def load_model_and_scaler() -> Tuple[Optional[Any], Optional[Any]]:
    """
    Load AI model and scaler.
    
    Returns:
        Tuple of (model, scaler) or (None, None) if loading fails
    """
    global _model, _scaler, _model_metadata
    
    if _model is not None and _scaler is not None:
        return _model, _scaler

    try:
        logger.info("🔍 Loading AI model and scaler...")

        if tf is None:
            logger.error(f"❌ TensorFlow import failed: {_TF_IMPORT_ERROR}")
            return None, None
        
        # Check if paths exist
        if not os.path.exists(MODEL_PATH):
            logger.error(f"❌ Model file not found: {MODEL_PATH}")
            return None, None
            
        if not os.path.exists(SCALER_PATH):
            logger.error(f"❌ Scaler file not found: {SCALER_PATH}")
            return None, None
        
        # Load model
        logger.info(f"📦 Loading model from: {MODEL_PATH}")
        _model = tf.keras.models.load_model(MODEL_PATH, compile=False)
        
        # Load scaler
        logger.info(f"📦 Loading scaler from: {SCALER_PATH}")
        _scaler = joblib.load(SCALER_PATH)
        
        # Determine model metadata from input shape
        input_shape = _model.input_shape
        if input_shape[-1] == 16:
            _model_metadata["type"] = "enhanced"
            _model_metadata["features_count"] = 16
        else:
            _model_metadata["type"] = "basic"
            _model_metadata["features_count"] = 8
        
        # Determine output format
        if isinstance(_model.output, list) and len(_model.output) == 2:
            _model_metadata["output_format"] = "dual"
        else:
            _model_metadata["output_format"] = "single"
        
        # Update metadata
        _model_metadata.update({
            "name": os.path.basename(MODEL_PATH),
            "input_shape": input_shape,
            "loaded_at": datetime.now().isoformat()
        })
        
        # Update raw buffer
        global _buffer
        _buffer = SlidingWindowBuffer(
            window_size=TIME_STEPS,
            num_features=6
        )
        
        logger.info(f"✅ Model loaded successfully!")
        logger.info(f"   Type: {_model_metadata['type']} ({_model_metadata['features_count']} features)")
        logger.info(f"   Output: {_model_metadata['output_format']}")
        logger.info(f"   Input shape: {input_shape}")
        
        return _model, _scaler
        
    except Exception as e:
        logger.error(f"❌ Failed to load AI components: {e}", exc_info=True)
        return None, None

def calculate_features_from_raw(
    raw_seq: np.ndarray,
    model_type: Optional[str] = None
) -> np.ndarray:
    """
    Calculate features from raw sensor sequence.
    Matches training feature engineering exactly.
    """
    raw = np.asarray(raw_seq, dtype=np.float32)
    if raw.ndim != 2 or raw.shape[1] != 6:
        raise ValueError(f"raw_seq must have shape (N, 6), got {raw.shape}")

    if model_type is None:
        model_type = _model_metadata.get("type", "enhanced")

    n_samples = raw.shape[0]
    n_features = 8 if model_type == "basic" else 16
    features = np.zeros((n_samples, n_features), dtype=np.float32)

    for i in range(n_samples):
        acc_x, acc_y, acc_z, gx, gy, gz = raw[i]
        acc_mag = np.sqrt(acc_x**2 + acc_y**2 + acc_z**2)
        gyro_mag = np.sqrt(gx**2 + gy**2 + gz**2)

        if model_type == "basic":
            features[i] = np.array([
                acc_x, acc_y, acc_z,
                gx, gy, gz,
                acc_mag, gyro_mag
            ], dtype=np.float32)
            continue

        # Rolling window for variance (match training: window=VAR_WINDOW, ddof=1)
        window_start = max(0, i - VAR_WINDOW + 1)
        window = raw[window_start:i + 1]

        if window.shape[0] < 2:
            acc_var = 0.0
            gyro_var = 0.0
        else:
            acc_var = (
                np.var(window[:, 0], ddof=1) +
                np.var(window[:, 1], ddof=1) +
                np.var(window[:, 2], ddof=1)
            ) / 3
            gyro_var = (
                np.var(window[:, 3], ddof=1) +
                np.var(window[:, 4], ddof=1) +
                np.var(window[:, 5], ddof=1)
            ) / 3

        # Energy (current sample)
        acc_energy = acc_x**2 + acc_y**2 + acc_z**2
        gyro_energy = gx**2 + gy**2 + gz**2

        # Jerk (difference from previous sample)
        if i > 0:
            prev = raw[i - 1]
            jerk_x = acc_x - prev[0]
            jerk_y = acc_y - prev[1]
            jerk_z = acc_z - prev[2]
        else:
            jerk_x = jerk_y = jerk_z = 0.0
        jerk_mag = np.sqrt(jerk_x**2 + jerk_y**2 + jerk_z**2)

        # MAV / SMA / STD (current sample)
        acc_mav = (abs(acc_x) + abs(acc_y) + abs(acc_z)) / 3
        acc_sma = abs(acc_x) + abs(acc_y) + abs(acc_z)
        acc_std = np.std([acc_x, acc_y, acc_z], ddof=1)

        features[i] = np.array([
            acc_x, acc_y, acc_z,
            gx, gy, gz,
            acc_mag, gyro_mag,
            acc_var, gyro_var,
            acc_energy, gyro_energy,
            jerk_mag, acc_mav, acc_sma, acc_std
        ], dtype=np.float32)

    return features


def extract_features_from_raw(
    acc_x: np.ndarray,
    acc_y: np.ndarray,
    acc_z: np.ndarray,
    gyro_x: np.ndarray,
    gyro_y: np.ndarray,
    gyro_z: np.ndarray
) -> np.ndarray:
    """
    Extract features from raw sensor data (batch processing).
    """
    raw = np.column_stack([acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z]).astype(np.float32)
    return calculate_features_from_raw(raw)

def extract_single_sample_features(
    acc_x: float,
    acc_y: float,
    acc_z: float,
    gyro_x: float,
    gyro_y: float,
    gyro_z: float
) -> np.ndarray:
    """
    Extract features from a single sensor reading.
    
    Args:
        acc_x, acc_y, acc_z: Single accelerometer readings
        gyro_x, gyro_y, gyro_z: Single gyroscope readings
    
    Returns:
        Feature array
    """
    # Use raw buffer to compute features exactly like training
    global _buffer
    raw_sample = np.array([acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z], dtype=np.float32)
    _buffer.add_sample(raw_sample)
    window_data = np.array(_buffer.buffer, dtype=np.float32)

    features = calculate_features_from_raw(window_data)[-1]
    return features

def create_sliding_windows(
    data: np.ndarray,
    window_size: int = TIME_STEPS,
    step_size: int = 1
) -> np.ndarray:
    """
    Create sliding windows from time series data.
    
    Args:
        data: Input data of shape (n_samples, n_features)
        window_size: Size of each window
        step_size: Step between windows
    
    Returns:
        Windows of shape (n_windows, window_size, n_features)
    """
    n_samples, n_features = data.shape
    
    # Calculate number of windows
    n_windows = max(0, (n_samples - window_size) // step_size + 1)
    
    if n_windows == 0:
        # Pad with zeros
        window = np.zeros((window_size, n_features))
        if n_samples > 0:
            window[-n_samples:] = data
        return np.array([window])
    
    windows = []
    for i in range(0, n_samples - window_size + 1, step_size):
        window = data[i:i + window_size]
        windows.append(window)
    
    return np.array(windows)

def prepare_sensor_data(
    sensor_df: pd.DataFrame,
    window_size: int = TIME_STEPS
) -> np.ndarray:
    """
    Prepare sensor data for model prediction.
    
    Args:
        sensor_df: DataFrame with columns:
            - accelerometer_x, accelerometer_y, accelerometer_z
            - gyroscope_x, gyroscope_y, gyroscope_z
            - timestamp (optional)
        window_size: Size of window for LSTM
    
    Returns:
        Prepared data of shape (1, window_size, n_features)
    """
    try:
        # Extract sensor data
        acc_x = sensor_df['accelerometer_x'].values
        acc_y = sensor_df['accelerometer_y'].values
        acc_z = sensor_df['accelerometer_z'].values
        gyro_x = sensor_df['gyroscope_x'].values
        gyro_y = sensor_df['gyroscope_y'].values
        gyro_z = sensor_df['gyroscope_z'].values
        
        # Extract features
        features = extract_features_from_raw(acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z)
        
        # Create sliding windows
        windows = create_sliding_windows(features, window_size=window_size)
        
        # Take the most recent window
        if len(windows) > 0:
            X = windows[-1:]  # Shape: (1, window_size, n_features)
        else:
            # If no windows created (data too short), pad with zeros
            X = np.zeros((1, window_size, features.shape[1]))
        
        return X
        
    except Exception as e:
        logger.error(f"❌ Error preparing sensor data: {e}")
        # Return zeros as fallback
        n_features = _model_metadata.get("features_count", 16)
        return np.zeros((1, window_size, n_features))

def preprocess_motion_data(
    acc_x: float,
    acc_y: float,
    acc_z: float,
    gyro_x: float,
    gyro_y: float,
    gyro_z: float,
    temperature: Optional[float] = None,
    buffer_key: Optional[str] = None
) -> np.ndarray:
    """
    Convert a single raw sensor sample into feature vector.
    Uses a rolling raw buffer to match training feature engineering.
    """
    if buffer_key:
        raw_seq = append_raw_sample(buffer_key, acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z)
        features = calculate_features_from_raw(raw_seq)[-1]
        return features

    # Fallback to global single-stream buffer
    return extract_single_sample_features(acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z)

def predict_fall(
    raw_buffer: np.ndarray,
    fall_now_threshold: float = FALL_THRESHOLD_NOW,
    fall_soon_threshold: float = FALL_THRESHOLD_SOON
) -> Dict[str, Any]:
    """
    Predict fall from a raw buffer (shape: N x 6) or precomputed features (N x 16).
    Returns a consistent response structure for API/DB usage.
    """
    prediction_id = f"pred_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"

    try:
        model, scaler = load_model_and_scaler()

        if USE_MOCK_DATA or model is None or scaler is None:
            logger.warning("⚠️ Using mock prediction mode")
            mock = get_mock_prediction()
            return {
                "success": True,
                "message": "Mock prediction",
                "prediction_id": prediction_id,
                "fall_now_probability": mock["fall_now"]["probability"],
                "fall_soon_probability": mock["fall_soon"]["probability"],
                "fall_now_prediction": mock["fall_now"]["prediction"],
                "fall_soon_prediction": mock["fall_soon"]["prediction"],
                "confidence_score": mock["confidence"]["score"],
                "is_mock": True
            }

        raw = np.asarray(raw_buffer, dtype=np.float32)
        if raw.ndim != 2 or raw.shape[1] not in (6, 16):
            raise ValueError(f"raw_buffer must have shape (N,6) or (N,16); got {raw.shape}")

        # If raw has 6 columns -> compute features
        if raw.shape[1] == 6:
            features = calculate_features_from_raw(raw)
        else:
            # Assume already features
            features = raw

        expected_features = _model_metadata.get("features_count", features.shape[1])
        if features.shape[1] != expected_features:
            raise ValueError(
                f"Feature count mismatch: got {features.shape[1]}, "
                f"expected {expected_features} for model type {_model_metadata.get('type')}"
            )

        warmup = False
        if features.shape[0] < TIME_STEPS:
            warmup = True
            pad = np.zeros((TIME_STEPS - features.shape[0], features.shape[1]), dtype=np.float32)
            features = np.vstack([pad, features])
        else:
            features = features[-TIME_STEPS:]

        X = features.reshape(1, TIME_STEPS, -1)

        # Scale
        X_2d = X.reshape(-1, X.shape[-1])
        X_scaled_2d = scaler.transform(X_2d)
        X_scaled = X_scaled_2d.reshape(X.shape)

        # Predict
        predictions = model.predict(X_scaled, verbose=0)

        if _model_metadata.get("output_format") == "dual":
            fall_now_raw = predictions[0][0][0] if len(predictions[0].shape) > 1 else predictions[0][0]
            fall_soon_raw = predictions[1][0][0] if len(predictions[1].shape) > 1 else predictions[1][0]
            fall_now_prob = float(np.clip(fall_now_raw, 0.0, 1.0))
            fall_soon_prob = float(np.clip(fall_soon_raw, 0.0, 1.0))
        else:
            fall_now_raw = predictions[0][0] if len(predictions.shape) > 1 else predictions[0]
            fall_now_prob = float(np.clip(fall_now_raw, 0.0, 1.0))
            fall_soon_prob = estimate_fall_soon_probability(fall_now_prob)

        fall_now_pred = fall_now_prob >= fall_now_threshold
        fall_soon_pred = fall_soon_prob >= fall_soon_threshold

        confidence = calculate_prediction_confidence(
            fall_now_prob, fall_soon_prob, fall_now_pred, fall_soon_pred
        )

        return {
            "success": True,
            "message": "Prediction completed",
            "prediction_id": prediction_id,
            "fall_now_probability": round(fall_now_prob, 4),
            "fall_soon_probability": round(fall_soon_prob, 4),
            "fall_now_prediction": bool(fall_now_pred),
            "fall_soon_prediction": bool(fall_soon_pred),
            "confidence_score": round(confidence, 4),
            "is_mock": False,
            "metadata": {
                "model": _model_metadata.get("name"),
                "model_type": _model_metadata.get("type"),
                "features": _model_metadata.get("features_count"),
                "output_format": _model_metadata.get("output_format"),
                "timestamp": datetime.utcnow().isoformat(),
                "warmup": warmup,
                "samples": int(min(raw.shape[0], TIME_STEPS))
            }
        }

    except Exception as e:
        logger.error(f"❌ Prediction failed: {e}", exc_info=True)
        return {
            "success": False,
            "message": "Prediction failed",
            "prediction_id": prediction_id,
            "error": str(e),
            "fall_now_probability": 0.0,
            "fall_soon_probability": 0.0,
            "fall_now_prediction": False,
            "fall_soon_prediction": False,
            "confidence_score": 0.0,
            "is_mock": True
        }

def predict_from_sample(
    acc_x: float,
    acc_y: float,
    acc_z: float,
    gyro_x: float,
    gyro_y: float,
    gyro_z: float,
    buffer_key: str
) -> Dict[str, Any]:
    """
    Append a single raw sample to a per-stream buffer and run prediction.
    """
    raw_seq = append_raw_sample(buffer_key, acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z)
    return predict_fall(raw_seq)

def predict_from_sensor_data(
    sensor_df: pd.DataFrame,
    threshold: float = FALL_THRESHOLD_NOW
) -> Dict[str, Any]:
    """
    Main prediction function from sensor DataFrame.
    
    Args:
        sensor_df: DataFrame with sensor readings
        threshold: Classification threshold
    
    Returns:
        Prediction results
    """
    try:
        raw = sensor_df[
            [
                'accelerometer_x', 'accelerometer_y', 'accelerometer_z',
                'gyroscope_x', 'gyroscope_y', 'gyroscope_z'
            ]
        ].values
        base = predict_fall(
            raw_buffer=raw,
            fall_now_threshold=threshold,
            fall_soon_threshold=FALL_THRESHOLD_SOON
        )

        if not base.get("success", False):
            return create_error_response(base.get("error", "Prediction failed"), base.get("prediction_id", "pred_error"))

        fall_now_pred = base.get("fall_now_prediction", False)
        fall_soon_pred = base.get("fall_soon_prediction", False)
        confidence_score = base.get("confidence_score", 0.0)

        return {
            "success": True,
            "prediction_id": base.get("prediction_id"),
            "fall_now": {
                "probability": base.get("fall_now_probability", 0.0),
                "prediction": fall_now_pred,
                "threshold": round(threshold, 3)
            },
            "fall_soon": {
                "probability": base.get("fall_soon_probability", 0.0),
                "prediction": fall_soon_pred,
                "threshold": round(FALL_THRESHOLD_SOON, 3)
            },
            "confidence": {
                "score": round(confidence_score, 4),
                "level": get_confidence_level(confidence_score)
            },
            "metadata": base.get("metadata", {}),
            "decision": {
                "status": "FALL" if fall_now_pred else ("WARNING" if fall_soon_pred else "NORMAL"),
                "action": "ALERT" if fall_now_pred else ("MONITOR" if fall_soon_pred else "CONTINUE"),
                "urgency": "HIGH" if fall_now_pred else ("MEDIUM" if fall_soon_pred else "LOW")
            }
        }
    except Exception as e:
        logger.error(f"❌ Prediction failed: {e}", exc_info=True)
        return create_error_response(str(e), f"pred_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}")

def estimate_fall_soon_probability(fall_now_prob: float) -> float:
    """Estimate fall_soon probability from fall_now probability."""
    if fall_now_prob > 0.8:
        return min(fall_now_prob * 0.9, 0.95)  # High fall_now, high fall_soon
    elif fall_now_prob > 0.5:
        return fall_now_prob * 0.8  # Moderate fall_now, moderate fall_soon
    elif fall_now_prob > 0.3:
        return fall_now_prob * 1.2  # Low fall_now, slightly higher fall_soon (early warning)
    else:
        return fall_now_prob * 0.6  # Very low fall_now, very low fall_soon

def calculate_prediction_confidence(
    fall_now_prob: float,
    fall_soon_prob: float,
    fall_now_pred: bool,
    fall_soon_pred: bool
) -> float:
    """Calculate confidence score for prediction."""
    # Base confidence from probabilities
    base_confidence = max(fall_now_prob, fall_soon_prob)
    
    # Adjust based on agreement between predictions
    if fall_now_pred == fall_soon_pred:
        # Agreement increases confidence
        adjustment = 0.1
    else:
        # Disagreement decreases confidence
        adjustment = -0.1
    
    # Adjust based on probability magnitude
    if base_confidence > 0.8 or base_confidence < 0.2:
        # Very high or very low probabilities are more certain
        adjustment += 0.05
    
    confidence = np.clip(base_confidence + adjustment, 0.0, 1.0)
    return confidence

def get_confidence_level(score: float) -> str:
    """Convert confidence score to level."""
    if score >= 0.9:
        return "VERY_HIGH"
    elif score >= 0.7:
        return "HIGH"
    elif score >= 0.5:
        return "MEDIUM"
    elif score >= 0.3:
        return "LOW"
    else:
        return "VERY_LOW"

def create_error_response(error_msg: str, prediction_id: str) -> Dict[str, Any]:
    """Create standardized error response."""
    return {
        "success": False,
        "prediction_id": prediction_id,
        "error": error_msg,
        "fall_now": {
            "probability": 0.0,
            "prediction": False,
            "threshold": FALL_THRESHOLD_NOW
        },
        "fall_soon": {
            "probability": 0.0,
            "prediction": False,
            "threshold": FALL_THRESHOLD_SOON
        },
        "confidence": {
            "score": 0.0,
            "level": "VERY_LOW"
        },
        "metadata": {
            "model": "ERROR",
            "model_type": "ERROR",
            "features": 0,
            "timestamp": datetime.utcnow().isoformat(),
            "is_mock": True,
            "error": True
        },
        "decision": {
            "status": "ERROR",
            "action": "CHECK_SYSTEM",
            "urgency": "HIGH"
        }
    }

def get_mock_prediction() -> Dict[str, Any]:
    """Generate realistic mock predictions."""
    scenario = random.choice(["normal", "warning", "fall", "false_alarm"])
    
    if scenario == "normal":
        fall_now_prob = random.uniform(0.05, 0.25)
        fall_soon_prob = random.uniform(0.1, 0.3)
        fall_now_pred = False
        fall_soon_pred = False
    elif scenario == "warning":
        fall_now_prob = random.uniform(0.3, 0.5)
        fall_soon_prob = random.uniform(0.4, 0.65)
        fall_now_pred = False
        fall_soon_pred = True
    elif scenario == "fall":
        fall_now_prob = random.uniform(0.7, 0.95)
        fall_soon_prob = random.uniform(0.5, 0.8)
        fall_now_pred = True
        fall_soon_pred = True
    else:  # false_alarm
        fall_now_prob = random.uniform(0.5, 0.6)
        fall_soon_prob = random.uniform(0.3, 0.4)
        fall_now_pred = True
        fall_soon_pred = False
    
    confidence = calculate_prediction_confidence(
        fall_now_prob, fall_soon_prob, fall_now_pred, fall_soon_pred
    )
    
    return {
        "success": True,
        "prediction_id": f"mock_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}",
        "fall_now": {
            "probability": round(fall_now_prob, 4),
            "prediction": fall_now_pred,
            "threshold": FALL_THRESHOLD_NOW
        },
        "fall_soon": {
            "probability": round(fall_soon_prob, 4),
            "prediction": fall_soon_pred,
            "threshold": FALL_THRESHOLD_SOON
        },
        "confidence": {
            "score": round(confidence, 4),
            "level": get_confidence_level(confidence)
        },
        "metadata": {
            "model": "MOCK_MODEL",
            "model_type": "mock",
            "features": 8,
            "timestamp": datetime.utcnow().isoformat(),
            "is_mock": True,
            "scenario": scenario
        },
        "decision": {
            "status": "FALL" if fall_now_pred else ("WARNING" if fall_soon_pred else "NORMAL"),
            "action": "ALERT" if fall_now_pred else ("MONITOR" if fall_soon_pred else "CONTINUE"),
            "urgency": "HIGH" if fall_now_pred else ("MEDIUM" if fall_soon_pred else "LOW")
        }
    }

def real_time_prediction(
    accelerometer_data: Tuple[float, float, float],
    gyroscope_data: Tuple[float, float, float]
) -> Dict[str, Any]:
    """
    Real-time prediction for streaming sensor data.
    
    Args:
        accelerometer_data: (x, y, z) accelerometer readings
        gyroscope_data: (x, y, z) gyroscope readings
    
    Returns:
        Prediction results
    """
    try:
        acc_x, acc_y, acc_z = accelerometer_data
        gyro_x, gyro_y, gyro_z = gyroscope_data
        return predict_from_sample(
            acc_x=acc_x,
            acc_y=acc_y,
            acc_z=acc_z,
            gyro_x=gyro_x,
            gyro_y=gyro_y,
            gyro_z=gyro_z,
            buffer_key="realtime_stream"
        )
    except Exception as e:
        logger.error(f"❌ Real-time prediction error: {e}")
        return create_error_response(str(e), "realtime_error")

def get_model_info() -> Dict[str, Any]:
    """Get information about the loaded model."""
    model, scaler = load_model_and_scaler()
    
    info = {
        "model_loaded": model is not None,
        "scaler_loaded": scaler is not None,
        "use_mock_data": USE_MOCK_DATA,
        "metadata": _model_metadata.copy(),
        "config": {
            "model_path": str(MODEL_PATH),
            "scaler_path": str(SCALER_PATH),
            "time_steps": TIME_STEPS,
            "use_mock_data": USE_MOCK_DATA
        },
        "buffer_status": {
            "current_size": _buffer.size(),
            "window_size": TIME_STEPS,
            "is_full": _buffer.is_full()
        }
    }
    
    if model is not None:
        info["model_details"] = {
            "layers": len(model.layers),
            "trainable_params": model.count_params(),
            "input_shape": model.input_shape,
            "output_shape": [out.shape for out in (model.outputs if isinstance(model.outputs, list) else [model.output])]
        }
    
    return info

def test_model_integration() -> Dict[str, Any]:
    """Comprehensive test of the model integration."""
    logger.info("🧪 Starting model integration test...")
    
    # Generate test sensor data
    n_samples = TIME_STEPS + 50
    
    # Simulate different motion patterns
    sensor_data = {
        'accelerometer_x': [],
        'accelerometer_y': [],
        'accelerometer_z': [],
        'gyroscope_x': [],
        'gyroscope_y': [],
        'gyroscope_z': [],
        'timestamp': []
    }
    
    for i in range(n_samples):
        if i < n_samples // 3:
            # Normal walking
            sensor_data['accelerometer_x'].append(np.random.uniform(-1.5, 1.5))
            sensor_data['accelerometer_y'].append(np.random.uniform(-1.5, 1.5))
            sensor_data['accelerometer_z'].append(9.8 + np.random.uniform(-0.5, 0.5))
            sensor_data['gyroscope_x'].append(np.random.uniform(-20, 20))
            sensor_data['gyroscope_y'].append(np.random.uniform(-20, 20))
            sensor_data['gyroscope_z'].append(np.random.uniform(-20, 20))
        elif i < 2 * n_samples // 3:
            # Instability
            sensor_data['accelerometer_x'].append(np.random.uniform(-3, 3))
            sensor_data['accelerometer_y'].append(np.random.uniform(-3, 3))
            sensor_data['accelerometer_z'].append(9.8 + np.random.uniform(-2, 2))
            sensor_data['gyroscope_x'].append(np.random.uniform(-50, 50))
            sensor_data['gyroscope_y'].append(np.random.uniform(-50, 50))
            sensor_data['gyroscope_z'].append(np.random.uniform(-50, 50))
        else:
            # Fall pattern
            sensor_data['accelerometer_x'].append(np.random.uniform(-6, 6))
            sensor_data['accelerometer_y'].append(np.random.uniform(-6, 6))
            sensor_data['accelerometer_z'].append(np.random.uniform(2, 15))
            sensor_data['gyroscope_x'].append(np.random.uniform(-150, 150))
            sensor_data['gyroscope_y'].append(np.random.uniform(-150, 150))
            sensor_data['gyroscope_z'].append(np.random.uniform(-150, 150))
        
        sensor_data['timestamp'].append(datetime.now())
    
    sensor_df = pd.DataFrame(sensor_data)
    
    # Run prediction
    logger.info(f"📊 Test data: {n_samples} samples")
    result = predict_from_sensor_data(sensor_df)
    
    # Prepare report
    report = {
        "success": True,
        "message": "Model integration test completed",
        "test_data": {
            "samples": n_samples,
            "simulated_scenarios": ["normal", "instability", "fall"]
        },
        "prediction_result": result,
        "model_info": get_model_info(),
        "timestamp": datetime.now().isoformat()
    }
    
    logger.info(f"✅ Test completed. Success: {result.get('success', False)}")
    
    return report

def main():
    """Main test function."""
    print("=" * 60)
    print("🧪 AI Model Integration Test")
    print("=" * 60)
    
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Test model loading
    print("\n1️⃣ Testing model loading...")
    model, scaler = load_model_and_scaler()
    
    if model is None or scaler is None:
        print("❌ Failed to load model or scaler")
        print("💡 Using mock mode")
    else:
        print("✅ Model and scaler loaded successfully")
    
    # Test prediction
    print("\n2️⃣ Testing prediction...")
    result = test_model_integration()
    
    if result.get("success"):
        pred_result = result.get("prediction_result", {})
        
        print(f"\n📊 Prediction Results:")
        print(f"   Success: {pred_result.get('success', False)}")
        
        if pred_result.get('success'):
            fall_now = pred_result.get('fall_now', {})
            fall_soon = pred_result.get('fall_soon', {})
            confidence = pred_result.get('confidence', {})
            decision = pred_result.get('decision', {})
            
            print(f"   Fall Now: {fall_now.get('probability', 0):.3f} "
                  f"({'🚨' if fall_now.get('prediction', False) else '✅'})")
            print(f"   Fall Soon: {fall_soon.get('probability', 0):.3f} "
                  f"({'⚠️' if fall_soon.get('prediction', False) else '○'})")
            print(f"   Confidence: {confidence.get('score', 0):.3f} "
                  f"({confidence.get('level', 'UNKNOWN')})")
            print(f"   Decision: {decision.get('status', 'UNKNOWN')} - "
                  f"{decision.get('action', 'UNKNOWN')}")
    else:
        print(f"❌ Test failed: {result.get('message', 'Unknown error')}")
    
    # Show model info
    print("\n3️⃣ Model Information:")
    info = get_model_info()
    print(f"   Model loaded: {info['model_loaded']}")
    print(f"   Scaler loaded: {info['scaler_loaded']}")
    print(f"   Model type: {info['metadata']['type']}")
    print(f"   Features: {info['metadata']['features_count']}")
    print(f"   Output format: {info['metadata']['output_format']}")
    print(f"   Buffer: {info['buffer_status']['current_size']}/{info['buffer_status']['window_size']}")
    
    print("\n" + "=" * 60)
    print("✅ Test completed")
    
    return result

if __name__ == "__main__":
    main()
