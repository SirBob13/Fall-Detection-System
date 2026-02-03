"""
AI Model Integration for Fall Detection System
Complete implementation with feature engineering, sliding windows,
and dual output handling for real-time fall detection.
"""

import os
import numpy as np
import pandas as pd
import tensorflow as tf
import joblib
import logging
import random
import warnings
from typing import Dict, Any, Tuple, Optional, List, Union
from datetime import datetime
from scipy import signal
from collections import deque

# Import config
try:
    from ..config import MODEL_PATH, SCALER_PATH, TIME_STEPS, USE_MOCK_DATA
except ImportError:
    # Default fallback values if config not available
    BASE_DIR = Path(__file__).resolve().parent.parent
    AI_DIR = BASE_DIR.parent / "AI"
    MODEL_PATH = AI_DIR / "models" / "fall_detection_final.keras"
    SCALER_PATH = AI_DIR / "scaler" / "scaler_final.save"
    TIME_STEPS = 100
    USE_MOCK_DATA = False

logger = logging.getLogger(__name__)

# Configure TensorFlow to be less verbose
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
tf.get_logger().setLevel('ERROR')
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

# Sliding window buffer (for real-time processing)
class SlidingWindowBuffer:
    def __init__(self, window_size: int = TIME_STEPS, num_features: int = 16):
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

# Global sliding window buffer
_buffer = SlidingWindowBuffer(window_size=TIME_STEPS, num_features=16)

def load_model_and_scaler() -> Tuple[Optional[tf.keras.Model], Optional[any]]:
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
        
        # Update buffer with correct number of features
        global _buffer
        _buffer = SlidingWindowBuffer(
            window_size=TIME_STEPS, 
            num_features=_model_metadata["features_count"]
        )
        
        logger.info(f"✅ Model loaded successfully!")
        logger.info(f"   Type: {_model_metadata['type']} ({_model_metadata['features_count']} features)")
        logger.info(f"   Output: {_model_metadata['output_format']}")
        logger.info(f"   Input shape: {input_shape}")
        
        return _model, _scaler
        
    except Exception as e:
        logger.error(f"❌ Failed to load AI components: {e}", exc_info=True)
        return None, None

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
    
    Args:
        acc_x, acc_y, acc_z: Accelerometer arrays
        gyro_x, gyro_y, gyro_z: Gyroscope arrays
    
    Returns:
        Feature matrix of shape (n_samples, n_features)
    """
    n_samples = len(acc_x)
    features = []
    
    for i in range(n_samples):
        # Get single sample
        sample_features = extract_single_sample_features(
            acc_x[i], acc_y[i], acc_z[i],
            gyro_x[i], gyro_y[i], gyro_z[i]
        )
        features.append(sample_features)
    
    return np.array(features)

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
    # Calculate basic features
    acc_magnitude = np.sqrt(acc_x**2 + acc_y**2 + acc_z**2)
    gyro_magnitude = np.sqrt(gyro_x**2 + gyro_y**2 + gyro_z**2)
    
    if _model_metadata["type"] == "basic":
        return np.array([
            acc_x, acc_y, acc_z,
            gyro_x, gyro_y, gyro_z,
            acc_magnitude, gyro_magnitude
        ], dtype=np.float32)
    
    # Enhanced features (16 features)
    # For single sample, we need temporal context from buffer
    global _buffer
    
    # Add current sample to buffer for temporal features
    basic_features = np.array([
        acc_x, acc_y, acc_z,
        gyro_x, gyro_y, gyro_z,
        acc_magnitude, gyro_magnitude
    ], dtype=np.float32)
    
    # Get recent window for temporal features
    _buffer.add_sample(basic_features)
    window_data = np.array(_buffer.buffer)
    
    if len(window_data) > 1:
        # Calculate variance using recent samples
        acc_values = window_data[:, :3]  # First 3 columns are acc_x, acc_y, acc_z
        gyro_values = window_data[:, 3:6]  # Next 3 columns are gyro_x, gyro_y, gyro_z
        
        acc_variance = np.var(acc_values.flatten())
        gyro_variance = np.var(gyro_values.flatten())
        
        # Energy (sum of squares)
        acc_energy = np.sum(acc_values[-10:]**2) if len(acc_values) >= 10 else np.sum(acc_values**2)
        gyro_energy = np.sum(gyro_values[-10:]**2) if len(gyro_values) >= 10 else np.sum(gyro_values**2)
        
        # Jerk magnitude (rate of change of acceleration)
        if len(acc_values) >= 2:
            # Calculate jerk as difference between consecutive acceleration magnitudes
            acc_mags = np.sqrt(np.sum(acc_values**2, axis=1))
            jerk = np.diff(acc_mags[-5:]) if len(acc_mags) >= 5 else np.diff(acc_mags)
            jerk_magnitude = np.mean(np.abs(jerk)) if len(jerk) > 0 else 0.0
        else:
            jerk_magnitude = 0.0
        
        # MAV (Mean Absolute Value)
        acc_mav = np.mean(np.abs(acc_values[-10:])) if len(acc_values) >= 10 else np.mean(np.abs(acc_values))
        
        # SMA (Signal Magnitude Area)
        acc_sma = np.sum(np.abs(acc_values[-10:])) if len(acc_values) >= 10 else np.sum(np.abs(acc_values))
        
        # Standard deviation
        acc_std = np.std(acc_values.flatten())
        
    else:
        # Not enough data for temporal features
        acc_variance = 0.0
        gyro_variance = 0.0
        acc_energy = acc_magnitude**2
        gyro_energy = gyro_magnitude**2
        jerk_magnitude = 0.0
        acc_mav = np.mean([abs(acc_x), abs(acc_y), abs(acc_z)])
        acc_sma = abs(acc_x) + abs(acc_y) + abs(acc_z)
        acc_std = 0.0
    
    return np.array([
        acc_x, acc_y, acc_z,
        gyro_x, gyro_y, gyro_z,
        acc_magnitude, gyro_magnitude,
        acc_variance, gyro_variance,
        acc_energy, gyro_energy,
        jerk_magnitude, acc_mav, acc_sma, acc_std
    ], dtype=np.float32)

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

def predict_from_sensor_data(
    sensor_df: pd.DataFrame,
    threshold: float = 0.5
) -> Dict[str, Any]:
    """
    Main prediction function from sensor DataFrame.
    
    Args:
        sensor_df: DataFrame with sensor readings
        threshold: Classification threshold
    
    Returns:
        Prediction results
    """
    prediction_id = f"pred_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
    
    try:
        logger.info(f"🎯 Starting prediction {prediction_id}")
        
        # Load model and scaler
        model, scaler = load_model_and_scaler()
        
        # Check if we should use mock data
        if USE_MOCK_DATA or model is None or scaler is None:
            logger.warning("⚠️ Using mock prediction mode")
            result = get_mock_prediction()
            result["prediction_id"] = prediction_id
            return result
        
        # Prepare data
        X = prepare_sensor_data(sensor_df)
        
        # Scale data
        original_shape = X.shape
        X_2d = X.reshape(-1, original_shape[-1])
        X_scaled_2d = scaler.transform(X_2d)
        X_scaled = X_scaled_2d.reshape(original_shape)
        
        # Make prediction
        logger.info("🤖 Running model inference...")
        start_time = datetime.now()
        predictions = model.predict(X_scaled, verbose=0)
        inference_time = (datetime.now() - start_time).total_seconds() * 1000
        
        # Process predictions based on output format
        if _model_metadata["output_format"] == "dual":
            # Dual output: [fall_now, fall_soon]
            fall_now_raw = predictions[0][0][0] if len(predictions[0].shape) > 1 else predictions[0][0]
            fall_soon_raw = predictions[1][0][0] if len(predictions[1].shape) > 1 else predictions[1][0]
            
            fall_now_prob = float(np.clip(fall_now_raw, 0.0, 1.0))
            fall_soon_prob = float(np.clip(fall_soon_raw, 0.0, 1.0))
        else:
            # Single output
            fall_now_raw = predictions[0][0] if len(predictions.shape) > 1 else predictions[0]
            fall_now_prob = float(np.clip(fall_now_raw, 0.0, 1.0))
            # Estimate fall_soon probability
            fall_soon_prob = estimate_fall_soon_probability(fall_now_prob)
        
        # Apply thresholds
        fall_now_threshold = threshold
        fall_soon_threshold = threshold * 0.7  # Lower threshold for early warning
        
        fall_now_pred = fall_now_prob >= fall_now_threshold
        fall_soon_pred = fall_soon_prob >= fall_soon_threshold
        
        # Calculate confidence
        confidence = calculate_prediction_confidence(
            fall_now_prob, fall_soon_prob,
            fall_now_pred, fall_soon_pred
        )
        
        # Build response
        result = {
            "success": True,
            "prediction_id": prediction_id,
            "fall_now": {
                "probability": round(fall_now_prob, 4),
                "prediction": bool(fall_now_pred),
                "threshold": round(fall_now_threshold, 3)
            },
            "fall_soon": {
                "probability": round(fall_soon_prob, 4),
                "prediction": bool(fall_soon_pred),
                "threshold": round(fall_soon_threshold, 3)
            },
            "confidence": {
                "score": round(confidence, 4),
                "level": get_confidence_level(confidence)
            },
            "metadata": {
                "model": _model_metadata["name"],
                "model_type": _model_metadata["type"],
                "features": _model_metadata["features_count"],
                "output_format": _model_metadata["output_format"],
                "inference_time_ms": round(inference_time, 1),
                "timestamp": datetime.utcnow().isoformat(),
                "input_shape": str(X.shape),
                "is_mock": False
            },
            "decision": {
                "status": "FALL" if fall_now_pred else ("WARNING" if fall_soon_pred else "NORMAL"),
                "action": "ALERT" if fall_now_pred else ("MONITOR" if fall_soon_pred else "CONTINUE"),
                "urgency": "HIGH" if fall_now_pred else ("MEDIUM" if fall_soon_pred else "LOW")
            }
        }
        
        logger.info(f"📈 Prediction Results:")
        logger.info(f"   Fall Now: {fall_now_prob:.3f} ({'🚨' if fall_now_pred else '✅'})")
        logger.info(f"   Fall Soon: {fall_soon_prob:.3f} ({'⚠️' if fall_soon_pred else '○'})")
        logger.info(f"   Confidence: {confidence:.3f}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Prediction failed: {e}", exc_info=True)
        return create_error_response(str(e), prediction_id)

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
            "threshold": 0.5
        },
        "fall_soon": {
            "probability": 0.0,
            "prediction": False,
            "threshold": 0.35
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
            "threshold": 0.5
        },
        "fall_soon": {
            "probability": round(fall_soon_prob, 4),
            "prediction": fall_soon_pred,
            "threshold": 0.35
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
        # Extract features from single reading
        acc_x, acc_y, acc_z = accelerometer_data
        gyro_x, gyro_y, gyro_z = gyroscope_data
        
        features = extract_single_sample_features(acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z)
        
        # Add to sliding window buffer
        _buffer.add_sample(features)
        
        # Get current window
        if _buffer.is_full():
            window = _buffer.get_window()
            
            # Create DataFrame for prediction
            # This simulates having enough data for a window
            n_samples = len(window)
            
            # For demonstration, create a DataFrame with repeated data
            # In production, you would accumulate real-time data
            sensor_data = {
                'accelerometer_x': [window[-1][0]] * n_samples,
                'accelerometer_y': [window[-1][1]] * n_samples,
                'accelerometer_z': [window[-1][2]] * n_samples,
                'gyroscope_x': [window[-1][3]] * n_samples,
                'gyroscope_y': [window[-1][4]] * n_samples,
                'gyroscope_z': [window[-1][5]] * n_samples
            }
            
            sensor_df = pd.DataFrame(sensor_data)
            
            # Run prediction
            return predict_from_sensor_data(sensor_df)
        else:
            # Not enough data yet
            return {
                "success": True,
                "message": "Collecting data...",
                "samples_collected": _buffer.size(),
                "samples_needed": TIME_STEPS,
                "status": "COLLECTING"
            }
            
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