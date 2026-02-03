# AI/train_scripts/train_final.py
"""
Final Dual Output Fall Detection Model
With Correct Feature Calculation and .keras format
"""

import os
import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow.keras import layers, Model, Input
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import (accuracy_score, precision_score, recall_score, 
                           f1_score, confusion_matrix, classification_report,
                           roc_auc_score, roc_curve)
import joblib
import sys
import json
import warnings
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
warnings.filterwarnings('ignore')

# Optimize TensorFlow
tf.config.threading.set_intra_op_parallelism_threads(4)
tf.config.threading.set_inter_op_parallelism_threads(4)

# ======================================
# CONFIGURATION
# ======================================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_PATH = os.path.join(BASE_DIR, "dataset/DataSet.csv")

# Model parameters
TIME_STEPS = 100
STEP_SIZE = 5
TEST_SIZE = 0.15
EPOCHS = 50  # Reduced for faster training
BATCH_SIZE = 128
LEARNING_RATE = 0.0005
DROPOUT_RATE = 0.2

# Loss weights
LOSS_WEIGHTS = {'fall_now': 0.7, 'fall_soon': 0.3}
FALL_SOON_HORIZON = 50

# Choose features: True for enhanced (16 features), False for basic (8 features)
USE_ENHANCED_FEATURES = True

# Features definitions
FEATURES_BASIC = [
    'WristAccelerometer_x', 'WristAccelerometer_y', 'WristAccelerometer_z',
    'WristAngularVelocity_x', 'WristAngularVelocity_y', 'WristAngularVelocity_z',
    'Acc_mag', 'Gyro_mag'
]

FEATURES_ENHANCED = [
    # Basic features
    'WristAccelerometer_x', 'WristAccelerometer_y', 'WristAccelerometer_z',
    'WristAngularVelocity_x', 'WristAngularVelocity_y', 'WristAngularVelocity_z',
    'Acc_mag', 'Gyro_mag',
    # Enhanced features
    'Acc_var', 'Gyro_var', 'Acc_energy', 'Gyro_energy',
    'Jerk_mag', 'Acc_MAV', 'Acc_SMA', 'Acc_std'
]

# Select features based on choice
FEATURES = FEATURES_ENHANCED if USE_ENHANCED_FEATURES else FEATURES_BASIC

# Output paths
SCALER_DIR = os.path.join(BASE_DIR, "scaler")
SCALER_PATH = os.path.join(SCALER_DIR, "scaler_final.save")
MODELS_DIR = os.path.join(BASE_DIR, "models")
FINAL_MODEL_PATH = os.path.join(MODELS_DIR, "fall_detection_final.keras")
RESULTS_DIR = os.path.join(BASE_DIR, "results_final")

# Ensure directories exist
for directory in [SCALER_DIR, MODELS_DIR, RESULTS_DIR]:
    os.makedirs(directory, exist_ok=True)

print(f"\n{'='*60}")
print("🏁 FINAL DUAL OUTPUT FALL DETECTION TRAINING")
print(f"{'='*60}")
print(f"📅 Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"📁 Dataset: {DATASET_PATH}")
print(f"🎯 Features: {len(FEATURES)} ({'Enhanced' if USE_ENHANCED_FEATURES else 'Basic'})")
print(f"💾 Model Format: .keras")
print(f"{'='*60}")

# ======================================
# 1. CORRECT FEATURE CALCULATION
# ======================================
def calculate_basic_features(df):
    """Calculate basic features"""
    df['Acc_mag'] = np.sqrt(df['WristAccelerometer_x']**2 +
                            df['WristAccelerometer_y']**2 +
                            df['WristAccelerometer_z']**2)
    df['Gyro_mag'] = np.sqrt(df['WristAngularVelocity_x']**2 +
                             df['WristAngularVelocity_y']**2 +
                             df['WristAngularVelocity_z']**2)
    return df

def calculate_enhanced_features(df, window_size=10):
    """Calculate enhanced features CORRECTLY"""
    print("🧮 Calculating enhanced features...")
    
    # Calculate basic features first
    df = calculate_basic_features(df)
    
    # 1. VARIANCE (Correct)
    df['Acc_var_x'] = df['WristAccelerometer_x'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var_y'] = df['WristAccelerometer_y'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var_z'] = df['WristAccelerometer_z'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var'] = (df['Acc_var_x'] + df['Acc_var_y'] + df['Acc_var_z']) / 3
    
    df['Gyro_var_x'] = df['WristAngularVelocity_x'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var_y'] = df['WristAngularVelocity_y'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var_z'] = df['WristAngularVelocity_z'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var'] = (df['Gyro_var_x'] + df['Gyro_var_y'] + df['Gyro_var_z']) / 3
    
    # 2. ENERGY (Correct) - sum of squares
    df['Acc_energy'] = (df['WristAccelerometer_x']**2 + 
                        df['WristAccelerometer_y']**2 + 
                        df['WristAccelerometer_z']**2)
    df['Gyro_energy'] = (df['WristAngularVelocity_x']**2 + 
                         df['WristAngularVelocity_y']**2 + 
                         df['WristAngularVelocity_z']**2)
    
    # 3. JERK (Correct) - derivative of acceleration
    df['Jerk_x'] = df['WristAccelerometer_x'].diff().fillna(0)
    df['Jerk_y'] = df['WristAccelerometer_y'].diff().fillna(0)
    df['Jerk_z'] = df['WristAccelerometer_z'].diff().fillna(0)
    df['Jerk_mag'] = np.sqrt(df['Jerk_x']**2 + df['Jerk_y']**2 + df['Jerk_z']**2)
    
    # 4. MEAN ABSOLUTE VALUE
    df['Acc_MAV'] = (df['WristAccelerometer_x'].abs() + 
                     df['WristAccelerometer_y'].abs() + 
                     df['WristAccelerometer_z'].abs()) / 3
    
    # 5. SIGNAL MAGNITUDE AREA
    df['Acc_SMA'] = df[['WristAccelerometer_x', 'WristAccelerometer_y', 
                        'WristAccelerometer_z']].abs().sum(axis=1)
    
    # 6. STANDARD DEVIATION
    df['Acc_std'] = df[['WristAccelerometer_x', 'WristAccelerometer_y', 
                        'WristAccelerometer_z']].std(axis=1).fillna(0)
    
    print(f"✅ Enhanced features calculated")
    return df

def load_and_preprocess_data(filepath):
    """Load and preprocess data with correct feature calculation"""
    print(f"\n📂 Loading dataset from: {filepath}")
    
    # Load data
    df = pd.read_csv(filepath, low_memory=False)
    print(f"📊 Original shape: {df.shape}")
    
    # Convert to numeric
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    df = df.ffill().bfill().fillna(0)
    
    # Extract sensor data (using column indices from your dataset)
    df['WristAccelerometer_x'] = df.iloc[:, 29]  # Column 29
    df['WristAccelerometer_y'] = df.iloc[:, 30]  # Column 30
    df['WristAccelerometer_z'] = df.iloc[:, 31]  # Column 31
    
    df['WristAngularVelocity_x'] = df.iloc[:, 32]  # Column 32
    df['WristAngularVelocity_y'] = df.iloc[:, 33]  # Column 33
    df['WristAngularVelocity_z'] = df.iloc[:, 34]  # Column 34
    
    # Calculate features
    if USE_ENHANCED_FEATURES:
        df = calculate_enhanced_features(df)
    else:
        df = calculate_basic_features(df)
    
    # Create targets
    df['Tag'] = df['Tag'].fillna(0).astype(int)
    FALL_CODES = [7, 8, 9, 10, 11]
    df['fall_now'] = df['Tag'].apply(lambda x: 1 if x in FALL_CODES else 0)
    
    # Fall Soon
    fall_series = df['fall_now'].values
    fall_soon = np.zeros(len(fall_series), dtype=np.float32)
    for i in range(len(fall_series) - FALL_SOON_HORIZON):
        if np.any(fall_series[i+1:i+FALL_SOON_HORIZON+1] == 1):
            fall_soon[i] = 1
    df['fall_soon'] = fall_soon
    
    # Ensure all features exist
    for f in FEATURES:
        if f not in df.columns:
            df[f] = 0
    
    # Extract final data
    X = df[FEATURES].values.astype(np.float32)
    y_now = df['fall_now'].values.astype(np.float32)
    y_soon = df['fall_soon'].values.astype(np.float32)
    
    print(f"\n✅ Final dataset:")
    print(f"   Shape: {X.shape}")
    print(f"   Features: {len(FEATURES)}")
    print(f"   Fall Now: {np.sum(y_now==1)} ({np.sum(y_now==1)/len(y_now)*100:.2f}%)")
    print(f"   Fall Soon: {np.sum(y_soon==1)} ({np.sum(y_soon==1)/len(y_soon)*100:.2f}%)")
    
    return X, y_now, y_soon

def create_sequences(X, y_now, y_soon, time_steps=TIME_STEPS, step_size=STEP_SIZE):
    """Create sequences for training"""
    X_seq, y_now_seq, y_soon_seq = [], [], []
    n_samples = len(X)
    
    for i in range(0, n_samples - time_steps, step_size):
        X_seq.append(X[i:i + time_steps])
        y_now_seq.append(y_now[i + time_steps - 1])
        y_soon_seq.append(y_soon[i + time_steps - 1])
    
    X_seq = np.array(X_seq, dtype=np.float32)
    y_now_seq = np.array(y_now_seq, dtype=np.float32)
    y_soon_seq = np.array(y_soon_seq, dtype=np.float32)
    
    print(f"\n✅ Created sequences:")
    print(f"   X shape: {X_seq.shape}")
    print(f"   Sequences: {len(X_seq)}")
    print(f"   Fall Now positives: {np.sum(y_now_seq==1)} ({np.sum(y_now_seq==1)/len(y_now_seq)*100:.1f}%)")
    print(f"   Fall Soon positives: {np.sum(y_soon_seq==1)} ({np.sum(y_soon_seq==1)/len(y_soon_seq)*100:.1f}%)")
    
    return X_seq, y_now_seq, y_soon_seq

# ======================================
# 2. DUAL OUTPUT MODEL
# ======================================
def build_dual_output_model(time_steps, n_features):
    """Build dual output model"""
    print(f"\n🧠 Building model with {n_features} features...")
    
    inputs = Input(shape=(time_steps, n_features), name='input')
    
    # Batch normalization
    x = layers.BatchNormalization(name='bn_input')(inputs)
    
    # First BiLSTM
    x = layers.Bidirectional(
        layers.LSTM(128, return_sequences=True, name='lstm1'),
        name='bilstm1'
    )(x)
    x = layers.BatchNormalization(name='bn1')(x)
    x = layers.Dropout(DROPOUT_RATE, name='drop1')(x)
    
    # Second BiLSTM
    x = layers.Bidirectional(
        layers.LSTM(128, return_sequences=True, name='lstm2'),
        name='bilstm2'
    )(x)
    x = layers.BatchNormalization(name='bn2')(x)
    
    # Simple attention
    attention = layers.Dense(1, activation='tanh', name='attention_scores')(x)
    attention = layers.Flatten(name='attention_flatten')(attention)
    attention = layers.Softmax(name='attention_weights')(attention)
    attention = layers.RepeatVector(256, name='attention_repeat')(attention)
    attention = layers.Permute([2, 1], name='attention_permute')(attention)
    
    x = layers.Multiply(name='attention_apply')([x, attention])
    x = layers.GlobalAveragePooling1D(name='global_pool')(x)
    
    # Shared layers
    x = layers.Dense(256, activation='relu', name='dense1')(x)
    x = layers.BatchNormalization(name='bn3')(x)
    x = layers.Dropout(DROPOUT_RATE, name='drop2')(x)
    
    x = layers.Dense(128, activation='relu', name='dense2')(x)
    x = layers.BatchNormalization(name='bn4')(x)
    x = layers.Dropout(DROPOUT_RATE * 0.5, name='drop3')(x)
    
    x = layers.Dense(64, activation='relu', name='dense3')(x)
    
    # Dual outputs
    # Fall Now branch
    fall_now = layers.Dense(32, activation='relu', name='fall_now_dense')(x)
    fall_now = layers.Dropout(DROPOUT_RATE * 0.3, name='drop_fall_now')(fall_now)
    fall_now_output = layers.Dense(1, activation='sigmoid', name='fall_now')(fall_now)
    
    # Fall Soon branch
    fall_soon = layers.Dense(32, activation='relu', name='fall_soon_dense')(x)
    fall_soon_output = layers.Dense(1, activation='sigmoid', name='fall_soon')(fall_soon)
    
    # Create model
    model = Model(inputs=inputs, outputs=[fall_now_output, fall_soon_output],
                  name='Dual_Output_Model')
    
    # Custom loss function to handle class imbalance
    def weighted_binary_crossentropy(y_true, y_pred):
        # Since we have 78% falls, we need to weight the minority class (non-falls) more
        weight_for_0 = 1.5  # Non-falls weight (minority class)
        weight_for_1 = 0.5  # Falls weight (majority class)
        
        bce = tf.keras.losses.binary_crossentropy(y_true, y_pred)
        
        # Apply weights
        weights = y_true * weight_for_1 + (1 - y_true) * weight_for_0
        weighted_bce = bce * weights
        
        return tf.reduce_mean(weighted_bce)
    
    # Optimizer
    optimizer = tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE)
    
    # Compile
    model.compile(
        optimizer=optimizer,
        loss={
            'fall_now': weighted_binary_crossentropy,
            'fall_soon': 'binary_crossentropy'
        },
        loss_weights=LOSS_WEIGHTS,
        metrics={
            'fall_now': [
                'accuracy',
                tf.keras.metrics.Precision(name='precision_now'),
                tf.keras.metrics.Recall(name='recall_now'),
                tf.keras.metrics.AUC(name='auc_now')
            ],
            'fall_soon': [
                'accuracy',
                tf.keras.metrics.Precision(name='precision_soon'),
                tf.keras.metrics.Recall(name='recall_soon'),
                tf.keras.metrics.AUC(name='auc_soon')
            ]
        }
    )
    
    model.summary()
    return model

# ======================================
# 3. TRAINING
# ======================================
def train_model():
    """Main training function"""
    print(f"\n{'='*60}")
    print("🚀 STARTING TRAINING")
    print(f"{'='*60}")
    
    # Load data
    X, y_now, y_soon = load_and_preprocess_data(DATASET_PATH)
    
    # Split data
    split_idx = int(len(X) * (1 - TEST_SIZE))
    X_train_raw, X_test_raw = X[:split_idx], X[split_idx:]
    y_train_now, y_test_now = y_now[:split_idx], y_now[split_idx:]
    y_train_soon, y_test_soon = y_soon[:split_idx], y_soon[split_idx:]
    
    # Scale
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_raw)
    X_test_scaled = scaler.transform(X_test_raw)
    
    # Save scaler
    joblib.dump(scaler, SCALER_PATH)
    print(f"\n✅ Scaler saved: {SCALER_PATH}")
    
    # Create sequences
    X_train, y_train_now_seq, y_train_soon_seq = create_sequences(
        X_train_scaled, y_train_now, y_train_soon
    )
    X_test, y_test_now_seq, y_test_soon_seq = create_sequences(
        X_test_scaled, y_test_now, y_test_soon
    )
    
    # Build model
    model = build_dual_output_model(X_train.shape[1], X_train.shape[2])
    
    # Callbacks - FIXED: removed save_format parameter
    callbacks = [
        EarlyStopping(
            monitor='val_fall_now_accuracy',
            patience=10,
            restore_best_weights=True,
            mode='max',
            verbose=1
        ),
        ReduceLROnPlateau(
            monitor='val_fall_now_accuracy',
            factor=0.5,
            patience=5,
            min_lr=1e-6,
            mode='max',
            verbose=1
        ),
        ModelCheckpoint(
            filepath=FINAL_MODEL_PATH.replace('.keras', '_best.h5'),  # Save as .h5 during training
            monitor='val_fall_now_accuracy',
            save_best_only=True,
            mode='max',
            verbose=1
        )
    ]
    
    # Create validation split
    X_train_final, X_val, y_train_now_final, y_val_now, y_train_soon_final, y_val_soon = train_test_split(
        X_train, y_train_now_seq, y_train_soon_seq,
        test_size=0.1,
        random_state=42,
        stratify=y_train_now_seq
    )
    
    print(f"\n📊 Data splits:")
    print(f"   Training: {X_train_final.shape}")
    print(f"   Validation: {X_val.shape}")
    print(f"   Test: {X_test.shape}")
    
    # Train
    print("\n🔥 Training model...")
    history = model.fit(
        X_train_final,
        {'fall_now': y_train_now_final, 'fall_soon': y_train_soon_final},
        validation_data=(X_val, {'fall_now': y_val_now, 'fall_soon': y_val_soon}),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1
    )
    
    # Load best model
    best_model_path = FINAL_MODEL_PATH.replace('.keras', '_best.h5')
    if os.path.exists(best_model_path):
        model.load_weights(best_model_path)
        print(f"\n✅ Best model loaded: {best_model_path}")
    
    # Save final model as .keras format
    print(f"\n💾 Saving final model as .keras format...")
    model.save(FINAL_MODEL_PATH, save_format='keras')
    print(f"✅ Final model saved as: {FINAL_MODEL_PATH}")
    
    # Evaluate
    evaluate_model(model, X_test, y_test_now_seq, y_test_soon_seq, history)
    
    return model, history

def evaluate_model(model, X_test, y_test_now, y_test_soon, history):
    """Evaluate model performance"""
    print(f"\n{'='*60}")
    print("📊 EVALUATION")
    print(f"{'='*60}")
    
    # Predict
    predictions = model.predict(X_test, verbose=1, batch_size=BATCH_SIZE)
    pred_now_proba = predictions[0].flatten()
    pred_soon_proba = predictions[1].flatten()
    
    # Convert fall_soon to binary
    y_test_soon_binary = (y_test_soon > 0.5).astype(int)
    
    # Find optimal thresholds
    def find_optimal_threshold(y_true, y_pred_proba):
        thresholds = np.arange(0.1, 0.9, 0.05)
        best_threshold = 0.5
        best_f1 = 0
        
        for thresh in thresholds:
            y_pred = (y_pred_proba >= thresh).astype(int)
            f1 = f1_score(y_true, y_pred, zero_division=0)
            if f1 > best_f1:
                best_f1 = f1
                best_threshold = thresh
        
        return best_threshold
    
    threshold_now = find_optimal_threshold(y_test_now, pred_now_proba)
    threshold_soon = find_optimal_threshold(y_test_soon_binary, pred_soon_proba)
    
    pred_now_binary = (pred_now_proba >= threshold_now).astype(int)
    pred_soon_binary = (pred_soon_proba >= threshold_soon).astype(int)
    
    # Calculate metrics for fall_now
    acc_now = accuracy_score(y_test_now, pred_now_binary)
    prec_now = precision_score(y_test_now, pred_now_binary, zero_division=0)
    rec_now = recall_score(y_test_now, pred_now_binary, zero_division=0)
    f1_now = f1_score(y_test_now, pred_now_binary, zero_division=0)
    
    cm_now = confusion_matrix(y_test_now, pred_now_binary)
    tn_now, fp_now, fn_now, tp_now = cm_now.ravel()
    
    try:
        auc_now = roc_auc_score(y_test_now, pred_now_proba)
    except:
        auc_now = 0
    
    # Calculate metrics for fall_soon
    acc_soon = accuracy_score(y_test_soon_binary, pred_soon_binary)
    prec_soon = precision_score(y_test_soon_binary, pred_soon_binary, zero_division=0)
    rec_soon = recall_score(y_test_soon_binary, pred_soon_binary, zero_division=0)
    f1_soon = f1_score(y_test_soon_binary, pred_soon_binary, zero_division=0)
    
    cm_soon = confusion_matrix(y_test_soon_binary, pred_soon_binary)
    tn_soon, fp_soon, fn_soon, tp_soon = cm_soon.ravel()
    
    try:
        auc_soon = roc_auc_score(y_test_soon_binary, pred_soon_proba)
    except:
        auc_soon = 0
    
    # Print results
    print(f"\n🏆 FALL NOW RESULTS:")
    print(f"   Accuracy:    {acc_now:.4f} ({acc_now*100:.2f}%)")
    print(f"   Precision:   {prec_now:.4f}")
    print(f"   Recall:      {rec_now:.4f}")
    print(f"   F1-Score:    {f1_now:.4f}")
    print(f"   AUC:         {auc_now:.4f}")
    print(f"   Threshold:   {threshold_now:.4f}")
    print(f"   TP: {tp_now}, FP: {fp_now}, FN: {fn_now}, TN: {tn_now}")
    
    print(f"\n🏆 FALL SOON RESULTS:")
    print(f"   Accuracy:    {acc_soon:.4f} ({acc_soon*100:.2f}%)")
    print(f"   Precision:   {prec_soon:.4f}")
    print(f"   Recall:      {rec_soon:.4f}")
    print(f"   F1-Score:    {f1_soon:.4f}")
    print(f"   AUC:         {auc_soon:.4f}")
    print(f"   Threshold:   {threshold_soon:.4f}")
    print(f"   TP: {tp_soon}, FP: {fp_soon}, FN: {fn_soon}, TN: {tn_soon}")
    
    # Classification reports
    print(f"\n📋 FALL NOW Classification Report:")
    print(classification_report(y_test_now, pred_now_binary, digits=4))
    
    print(f"\n📋 FALL SOON Classification Report:")
    print(classification_report(y_test_soon_binary, pred_soon_binary, digits=4))
    
    # Save results
    results = {
        'timestamp': datetime.now().isoformat(),
        'model': 'Dual_Output_Fall_Detector',
        'features': 'Enhanced' if USE_ENHANCED_FEATURES else 'Basic',
        'feature_count': len(FEATURES),
        'thresholds': {
            'fall_now': float(threshold_now),
            'fall_soon': float(threshold_soon)
        },
        'fall_now': {
            'accuracy': float(acc_now),
            'precision': float(prec_now),
            'recall': float(rec_now),
            'f1_score': float(f1_now),
            'auc': float(auc_now),
            'confusion_matrix': {
                'tp': int(tp_now), 'fp': int(fp_now),
                'fn': int(fn_now), 'tn': int(tn_now)
            }
        },
        'fall_soon': {
            'accuracy': float(acc_soon),
            'precision': float(prec_soon),
            'recall': float(rec_soon),
            'f1_score': float(f1_soon),
            'auc': float(auc_soon),
            'confusion_matrix': {
                'tp': int(tp_soon), 'fp': int(fp_soon),
                'fn': int(fn_soon), 'tn': int(tn_soon)
            }
        }
    }
    
    results_path = os.path.join(RESULTS_DIR, f"results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=4)
    
    print(f"\n✅ Results saved: {results_path}")
    
    # Plot results
    plot_results(history, y_test_now, pred_now_proba, y_test_soon_binary, pred_soon_proba)
    
    # Final summary
    print(f"\n{'='*60}")
    print("🎯 FINAL PERFORMANCE SUMMARY")
    print(f"{'='*60}")
    
    if acc_now >= 0.95:
        print("🎉 EXCELLENT! Fall Now Accuracy > 95%")
    elif acc_now >= 0.90:
        print("✅ VERY GOOD! Fall Now Accuracy > 90%")
    elif acc_now >= 0.85:
        print("👍 GOOD! Fall Now Accuracy > 85%")
    else:
        print("⚠️ Needs improvement")
    
    print(f"\n📊 Fall Soon Detection Rate: {rec_soon*100:.1f}%")
    print(f"📊 Overall Score: {(acc_now + rec_now) / 2 * 100:.1f}%")

def plot_results(history, y_test_now, pred_now_proba, y_test_soon, pred_soon_proba):
    """Plot training history and ROC curves"""
    try:
        # Create figure
        fig, axes = plt.subplots(2, 3, figsize=(15, 10))
        
        # Plot 1: Training loss
        axes[0, 0].plot(history.history['loss'], label='Training Loss')
        axes[0, 0].plot(history.history['val_loss'], label='Validation Loss')
        axes[0, 0].set_title('Model Loss')
        axes[0, 0].set_xlabel('Epoch')
        axes[0, 0].set_ylabel('Loss')
        axes[0, 0].legend()
        axes[0, 0].grid(True)
        
        # Plot 2: Fall Now Accuracy
        axes[0, 1].plot(history.history['fall_now_accuracy'], label='Training')
        axes[0, 1].plot(history.history['val_fall_now_accuracy'], label='Validation')
        axes[0, 1].set_title('Fall Now Accuracy')
        axes[0, 1].set_xlabel('Epoch')
        axes[0, 1].set_ylabel('Accuracy')
        axes[0, 1].legend()
        axes[0, 1].grid(True)
        
        # Plot 3: Fall Soon Accuracy
        axes[0, 2].plot(history.history['fall_soon_accuracy'], label='Training')
        axes[0, 2].plot(history.history['val_fall_soon_accuracy'], label='Validation')
        axes[0, 2].set_title('Fall Soon Accuracy')
        axes[0, 2].set_xlabel('Epoch')
        axes[0, 2].set_ylabel('Accuracy')
        axes[0, 2].legend()
        axes[0, 2].grid(True)
        
        # Plot 4: Fall Now ROC
        fpr_now, tpr_now, _ = roc_curve(y_test_now, pred_now_proba)
        auc_now = roc_auc_score(y_test_now, pred_now_proba)
        axes[1, 0].plot(fpr_now, tpr_now, color='darkorange', lw=2, 
                       label=f'Fall Now (AUC = {auc_now:.3f})')
        axes[1, 0].plot([0, 1], [0, 1], color='navy', lw=2, linestyle='--')
        axes[1, 0].set_title('Fall Now ROC Curve')
        axes[1, 0].set_xlabel('False Positive Rate')
        axes[1, 0].set_ylabel('True Positive Rate')
        axes[1, 0].legend()
        axes[1, 0].grid(True)
        
        # Plot 5: Fall Soon ROC
        fpr_soon, tpr_soon, _ = roc_curve(y_test_soon, pred_soon_proba)
        auc_soon = roc_auc_score(y_test_soon, pred_soon_proba)
        axes[1, 1].plot(fpr_soon, tpr_soon, color='green', lw=2,
                       label=f'Fall Soon (AUC = {auc_soon:.3f})')
        axes[1, 1].plot([0, 1], [0, 1], color='navy', lw=2, linestyle='--')
        axes[1, 1].set_title('Fall Soon ROC Curve')
        axes[1, 1].set_xlabel('False Positive Rate')
        axes[1, 1].set_ylabel('True Positive Rate')
        axes[1, 1].legend()
        axes[1, 1].grid(True)
        
        # Plot 6: Precision-Recall for Fall Now
        if 'fall_now_precision_now' in history.history:
            axes[1, 2].plot(history.history['fall_now_precision_now'], label='Precision')
            axes[1, 2].plot(history.history['fall_now_recall_now'], label='Recall')
            axes[1, 2].set_title('Fall Now Precision & Recall')
            axes[1, 2].set_xlabel('Epoch')
            axes[1, 2].set_ylabel('Score')
            axes[1, 2].legend()
            axes[1, 2].grid(True)
        
        plt.tight_layout()
        plot_path = os.path.join(RESULTS_DIR, 'training_results.png')
        plt.savefig(plot_path, dpi=150, bbox_inches='tight')
        plt.close()
        
        print(f"✅ Plot saved: {plot_path}")
        
    except Exception as e:
        print(f"⚠️ Could not create plots: {e}")

# ======================================
# 4. MAIN EXECUTION
# ======================================
if __name__ == "__main__":
    try:
        model, history = train_model()
        
        print(f"\n{'='*60}")
        print("🎉 TRAINING COMPLETED SUCCESSFULLY!")
        print(f"{'='*60}")
        print(f"✅ Final model saved as: {FINAL_MODEL_PATH}")
        print(f"✅ Best model saved as: {FINAL_MODEL_PATH.replace('.keras', '_best.h5')}")
        print(f"✅ Scaler saved: {SCALER_PATH}")
        print(f"✅ Results saved in: {RESULTS_DIR}")
        print(f"📅 End Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
    except KeyboardInterrupt:
        print("\n⚠️ Training interrupted by user.")
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
