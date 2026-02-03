# AI/test/test_fixed.py
"""
Corrected test script - matches training features
"""

import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow import keras
import joblib
from sklearn.metrics import (accuracy_score, precision_score, recall_score, 
                           f1_score, confusion_matrix, classification_report,
                           roc_auc_score, roc_curve)
import json
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')
import argparse

# ======================================
# CONFIGURATION - MATCH TRAINING EXACTLY
# ======================================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_PATH = os.path.join(BASE_DIR, "dataset/DataSet.csv")

# Model paths
MODEL_PATHS = [
    os.path.join(BASE_DIR, "models/fall_detection_final.keras"),
    os.path.join(BASE_DIR, "models/fall_detection_final_best.h5"),
]

SCALER_PATH = os.path.join(BASE_DIR, "scaler/scaler_final.save")

# Model parameters - MUST MATCH TRAINING
TIME_STEPS = 100
STEP_SIZE = 5
TEST_SIZE = 0.15
FALL_SOON_HORIZON = 50

# THRESHOLDS FROM TRAINING RESULTS
FALL_NOW_THRESHOLD = 0.35    # من نتائج التدريب
FALL_SOON_THRESHOLD = 0.30   # من نتائج التدريب

# IMPORTANT: MUST USE SAME FEATURES AS TRAINING
FEATURES_ENHANCED = [
    # Basic features (SAME AS TRAINING)
    'WristAccelerometer_x', 'WristAccelerometer_y', 'WristAccelerometer_z',
    'WristAngularVelocity_x', 'WristAngularVelocity_y', 'WristAngularVelocity_z',
    'Acc_mag', 'Gyro_mag',
    # Enhanced features (SAME AS TRAINING)
    'Acc_var', 'Gyro_var', 'Acc_energy', 'Gyro_energy',
    'Jerk_mag', 'Acc_MAV', 'Acc_SMA', 'Acc_std'
]

# Fall codes - MUST MATCH TRAINING
FALL_CODES = [7, 8, 9, 10, 11]

print(f"\n{'='*60}")
print("✅ TEST CONFIGURATION (MATCHES TRAINING)")
print(f"{'='*60}")
print(f"📊 Features: {len(FEATURES_ENHANCED)} Enhanced Features")
print(f"🎯 Fall Codes: {FALL_CODES}")
print(f"📈 Thresholds - Fall Now: {FALL_NOW_THRESHOLD}, Fall Soon: {FALL_SOON_THRESHOLD}")
print(f"{'='*60}")

# ======================================
# 1. LOAD MODEL
# ======================================
def load_model():
    """Load the trained model"""
    print("🔍 Loading trained model...")
    
    for model_path in MODEL_PATHS:
        if os.path.exists(model_path):
            print(f"✅ Found model: {model_path}")
            try:
                model = tf.keras.models.load_model(model_path, compile=False)
                print(f"✅ Model loaded successfully")
                
                # Check input shape
                input_shape = model.input_shape
                if isinstance(input_shape, list):
                    input_shape = input_shape[0]
                
                num_features = input_shape[-1]
                print(f"📐 Model expects {num_features} features per time step")
                
                # Simple compilation
                model.compile(
                    optimizer='adam',
                    loss='binary_crossentropy',
                    metrics=['accuracy']
                )
                
                return model, model_path, num_features
                
            except Exception as e:
                print(f"❌ Error loading model: {e}")
                continue
    
    print("❌ No trained model found!")
    return None, None, None

# ======================================
# 2. DATA PREPARATION - EXACTLY LIKE TRAINING
# ======================================
def calculate_features(df, window_size=10):
    """
    Calculate features EXACTLY like in training
    """
    print("🧮 Calculating features (same as training)...")
    
    # 1. Basic features
    df['Acc_mag'] = np.sqrt(df['WristAccelerometer_x']**2 +
                            df['WristAccelerometer_y']**2 +
                            df['WristAccelerometer_z']**2)
    df['Gyro_mag'] = np.sqrt(df['WristAngularVelocity_x']**2 +
                             df['WristAngularVelocity_y']**2 +
                             df['WristAngularVelocity_z']**2)
    
    # 2. VARIANCE (same as training)
    df['Acc_var_x'] = df['WristAccelerometer_x'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var_y'] = df['WristAccelerometer_y'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var_z'] = df['WristAccelerometer_z'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var'] = (df['Acc_var_x'] + df['Acc_var_y'] + df['Acc_var_z']) / 3
    
    df['Gyro_var_x'] = df['WristAngularVelocity_x'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var_y'] = df['WristAngularVelocity_y'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var_z'] = df['WristAngularVelocity_z'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var'] = (df['Gyro_var_x'] + df['Gyro_var_y'] + df['Gyro_var_z']) / 3
    
    # 3. ENERGY (same as training)
    df['Acc_energy'] = (df['WristAccelerometer_x']**2 + 
                        df['WristAccelerometer_y']**2 + 
                        df['WristAccelerometer_z']**2)
    df['Gyro_energy'] = (df['WristAngularVelocity_x']**2 + 
                         df['WristAngularVelocity_y']**2 + 
                         df['WristAngularVelocity_z']**2)
    
    # 4. JERK (same as training)
    df['Jerk_x'] = df['WristAccelerometer_x'].diff().fillna(0)
    df['Jerk_y'] = df['WristAccelerometer_y'].diff().fillna(0)
    df['Jerk_z'] = df['WristAccelerometer_z'].diff().fillna(0)
    df['Jerk_mag'] = np.sqrt(df['Jerk_x']**2 + df['Jerk_y']**2 + df['Jerk_z']**2)
    
    # 5. MEAN ABSOLUTE VALUE (same as training)
    df['Acc_MAV'] = (df['WristAccelerometer_x'].abs() + 
                     df['WristAccelerometer_y'].abs() + 
                     df['WristAccelerometer_z'].abs()) / 3
    
    # 6. SIGNAL MAGNITUDE AREA (same as training)
    df['Acc_SMA'] = df[['WristAccelerometer_x', 'WristAccelerometer_y', 
                        'WristAccelerometer_z']].abs().sum(axis=1)
    
    # 7. STANDARD DEVIATION (same as training)
    df['Acc_std'] = df[['WristAccelerometer_x', 'WristAccelerometer_y', 
                        'WristAccelerometer_z']].std(axis=1).fillna(0)
    
    return df

def prepare_data(num_samples=5000):
    """
    Prepare test data EXACTLY like training
    """
    print(f"\n📊 Preparing test data (matching training pipeline)...")
    
    # Load data
    try:
        if num_samples is None:
            df = pd.read_csv(DATASET_PATH, low_memory=False)
        else:
            df = pd.read_csv(DATASET_PATH, nrows=num_samples + TIME_STEPS, low_memory=False)
        print(f"   ✓ Loaded {len(df)} rows")
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        return None, None, None
    
    # Convert to numeric
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.ffill().bfill().fillna(0)
    
    # Extract sensor data - SAME COLUMNS AS TRAINING
    df['WristAccelerometer_x'] = df.iloc[:, 29]  # Column 29
    df['WristAccelerometer_y'] = df.iloc[:, 30]  # Column 30
    df['WristAccelerometer_z'] = df.iloc[:, 31]  # Column 31
    
    df['WristAngularVelocity_x'] = df.iloc[:, 32]  # Column 32
    df['WristAngularVelocity_y'] = df.iloc[:, 33]  # Column 33
    df['WristAngularVelocity_z'] = df.iloc[:, 34]  # Column 34
    
    # Calculate features (SAME AS TRAINING)
    df = calculate_features(df)
    
    # Ensure all features exist
    for f in FEATURES_ENHANCED:
        if f not in df.columns:
            df[f] = 0
            print(f"   ⚠️ Feature {f} not found, setting to 0")
    
    # Extract features
    X = df[FEATURES_ENHANCED].values.astype(np.float32)
    
    # Create targets (SAME AS TRAINING)
    df['Tag'] = df['Tag'].fillna(0).astype(int)
    df['fall_now'] = df['Tag'].apply(lambda x: 1 if x in FALL_CODES else 0)
    
    # Fall Soon (SAME AS TRAINING)
    fall_series = df['fall_now'].values
    fall_soon = np.zeros(len(fall_series), dtype=np.float32)
    for i in range(len(fall_series) - FALL_SOON_HORIZON):
        if np.any(fall_series[i+1:i+FALL_SOON_HORIZON+1] == 1):
            fall_soon[i] = 1
    df['fall_soon'] = fall_soon
    
    y_now = df['fall_now'].values.astype(np.float32)
    y_soon = df['fall_soon'].values.astype(np.float32)
    
    # Apply scaling (SAME AS TRAINING)
    if os.path.exists(SCALER_PATH):
        try:
            print("   Loading and applying scaler...")
            scaler = joblib.load(SCALER_PATH)
            
            # Reshape, scale, reshape back
            original_shape = X.shape
            X_flat = X.reshape(-1, len(FEATURES_ENHANCED))
            X_scaled_flat = scaler.transform(X_flat)
            X = X_scaled_flat.reshape(original_shape)
            print(f"   ✓ Applied scaling from {SCALER_PATH}")
        except Exception as e:
            print(f"⚠️ Error applying scaler: {e}")
    else:
        print("⚠️ Scaler not found, using raw data")
    
    # Create sequences (SAME AS TRAINING)
    X_seq, y_now_seq, y_soon_seq = [], [], []
    
    for i in range(0, len(X) - TIME_STEPS, STEP_SIZE):
        X_seq.append(X[i:i + TIME_STEPS])
        y_now_seq.append(y_now[i + TIME_STEPS - 1])
        y_soon_seq.append(y_soon[i + TIME_STEPS - 1])
    
    X_seq = np.array(X_seq, dtype=np.float32)
    y_now_seq = np.array(y_now_seq, dtype=np.float32)
    y_soon_seq = np.array(y_soon_seq, dtype=np.float32)
    
    print(f"\n✅ Test data prepared (matching training):")
    print(f"   X shape: {X_seq.shape}")
    print(f"   Fall Now samples: {np.sum(y_now_seq==1)}/{len(y_now_seq)} ({np.sum(y_now_seq==1)/len(y_now_seq)*100:.1f}%)")
    print(f"   Fall Soon samples: {np.sum(y_soon_seq==1)}/{len(y_soon_seq)} ({np.sum(y_soon_seq==1)/len(y_soon_seq)*100:.1f}%)")
    print(f"   Data range: [{X_seq.min():.3f}, {X_seq.max():.3f}]")
    
    return X_seq, y_now_seq, y_soon_seq

# ======================================
# 3. EVALUATION FUNCTIONS
# ======================================
def evaluate_model(model, X_test, y_now_true, y_soon_true):
    """
    Evaluate model with proper metrics
    """
    print(f"\n{'='*60}")
    print("📊 EVALUATION RESULTS")
    print(f"{'='*60}")
    
    # Predict
    batch_size = 64
    predictions = model.predict(X_test, batch_size=batch_size, verbose=1)
    
    # Check model outputs
    if isinstance(predictions, list) and len(predictions) >= 2:
        print(f"✅ Dual-output model detected")
        pred_now_proba = predictions[0].flatten()
        pred_soon_proba = predictions[1].flatten()
        
        # Convert fall_soon to binary
        y_soon_true_binary = (y_soon_true > 0.5).astype(int)
        
        # Apply thresholds from training
        pred_now_binary = (pred_now_proba >= FALL_NOW_THRESHOLD).astype(int)
        pred_soon_binary = (pred_soon_proba >= FALL_SOON_THRESHOLD).astype(int)
        
        # Calculate metrics for fall_now
        acc_now = accuracy_score(y_now_true, pred_now_binary)
        prec_now = precision_score(y_now_true, pred_now_binary, zero_division=0)
        rec_now = recall_score(y_now_true, pred_now_binary, zero_division=0)
        f1_now = f1_score(y_now_true, pred_now_binary, zero_division=0)
        
        # Calculate metrics for fall_soon
        acc_soon = accuracy_score(y_soon_true_binary, pred_soon_binary)
        prec_soon = precision_score(y_soon_true_binary, pred_soon_binary, zero_division=0)
        rec_soon = recall_score(y_soon_true_binary, pred_soon_binary, zero_division=0)
        f1_soon = f1_score(y_soon_true_binary, pred_soon_binary, zero_division=0)
        
        # Confusion matrices
        cm_now = confusion_matrix(y_now_true, pred_now_binary)
        cm_soon = confusion_matrix(y_soon_true_binary, pred_soon_binary)
        
        print(f"\n🏆 FALL NOW RESULTS (threshold={FALL_NOW_THRESHOLD}):")
        print(f"   Accuracy:    {acc_now:.4f} ({acc_now*100:.2f}%)")
        print(f"   Precision:   {prec_now:.4f}")
        print(f"   Recall:      {rec_now:.4f}")
        print(f"   F1-Score:    {f1_now:.4f}")
        print(f"   Confusion Matrix:")
        print(f"     [[TN={cm_now[0,0]:4d}  FP={cm_now[0,1]:4d}]")
        print(f"      [FN={cm_now[1,0]:4d}  TP={cm_now[1,1]:4d}]]")
        
        print(f"\n🏆 FALL SOON RESULTS (threshold={FALL_SOON_THRESHOLD}):")
        print(f"   Accuracy:    {acc_soon:.4f} ({acc_soon*100:.2f}%)")
        print(f"   Precision:   {prec_soon:.4f}")
        print(f"   Recall:      {rec_soon:.4f}")
        print(f"   F1-Score:    {f1_soon:.4f}")
        print(f"   Confusion Matrix:")
        print(f"     [[TN={cm_soon[0,0]:4d}  FP={cm_soon[0,1]:4d}]")
        print(f"      [FN={cm_soon[1,0]:4d}  TP={cm_soon[1,1]:4d}]]")
        
        # Sample predictions
        print(f"\n📋 SAMPLE PREDICTIONS (first 10):")
        print(f"{'Index':6} {'Fall Now':10} {'Fall Soon':10} {'Actual Now':10} {'Actual Soon':10}")
        print("-" * 50)
        for i in range(min(10, len(X_test))):
            print(f"{i:6d} {pred_now_proba[i]:10.4f} {pred_soon_proba[i]:10.4f} "
                  f"{y_now_true[i]:10.0f} {y_soon_true_binary[i]:10.0f}")
        
        return {
            'fall_now': {
                'accuracy': acc_now, 'precision': prec_now, 
                'recall': rec_now, 'f1': f1_now
            },
            'fall_soon': {
                'accuracy': acc_soon, 'precision': prec_soon,
                'recall': rec_soon, 'f1': f1_soon
            }
        }
    
    else:
        print("❌ Model output format not recognized")
        return None

# ======================================
# 4. MAIN FUNCTION
# ======================================
def main():
    """Main test function"""
    parser = argparse.ArgumentParser(description="Fall detection model test")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Run evaluation on the full dataset"
    )
    parser.add_argument(
        "--num-samples",
        type=int,
        default=5000,
        help="Number of rows to sample (default: 5000). Ignored if --full is set."
    )
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print("🧪 FALL DETECTION MODEL TEST")
    print("MATCHING TRAINING PIPELINE EXACTLY")
    print(f"{'='*60}")
    print(f"📅 Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    try:
        # 1. Load model
        model, model_path, num_features = load_model()
        if model is None:
            print("❌ Cannot proceed without model")
            return
        
        # 2. Prepare data (EXACTLY like training)
        sample_size = None if args.full else args.num_samples
        X_test, y_now, y_soon = prepare_data(num_samples=sample_size)
        if X_test is None:
            print("❌ Failed to prepare test data")
            return
        
        # 3. Verify feature count matches
        expected_features = len(FEATURES_ENHANCED)
        if num_features != expected_features:
            print(f"⚠️ WARNING: Model expects {num_features} features, but we have {expected_features}")
            print(f"   This may cause issues!")
        
        # 4. Evaluate
        results = evaluate_model(model, X_test, y_now, y_soon)
        
        # 5. Summary
        print(f"\n{'='*60}")
        print("🎯 TEST SUMMARY")
        print(f"{'='*60}")
        
        if results:
            print(f"✅ Model: {os.path.basename(model_path)}")
            print(f"✅ Features: {expected_features} (Enhanced)")
            print(f"✅ Test Samples: {len(X_test)}")
            print(f"✅ Fall Now Accuracy: {results['fall_now']['accuracy']*100:.1f}%")
            print(f"✅ Fall Soon Accuracy: {results['fall_soon']['accuracy']*100:.1f}%")
            
            # Compare with training results
            if results['fall_now']['accuracy'] >= 0.95:
                print(f"\n🎉 EXCELLENT! Results match training performance!")
            elif results['fall_now']['accuracy'] >= 0.90:
                print(f"\n👍 GOOD! Close to training performance")
            else:
                print(f"\n⚠️ WARNING: Results lower than expected from training")
                print(f"   Training was 96%, testing is {results['fall_now']['accuracy']*100:.1f}%")
        
        print(f"\n📅 End Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
    except Exception as e:
        print(f"\n❌ Error during testing: {str(e)}")
        import traceback
        traceback.print_exc()

# ======================================
# EXECUTION
# ======================================
if __name__ == "__main__":
    main()
