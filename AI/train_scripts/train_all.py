# AI/train_scripts/train_all.py
import os
import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow.keras import layers, Model, Input
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import *

# ==============================
# 1) DATA PREPROCESSING
# ==============================
def prepare_common_data(filepath=DATASET_PATH, time_steps=TIME_STEPS, test_size=TEST_SIZE, step_size=STEP_SIZE):
    print(f"Loading dataset from {filepath}")
    df = pd.read_csv(filepath, low_memory=False)
    
    # Extract wrist sensor data
    df['WristAccelerometer_x'] = pd.to_numeric(df['WristAccelerometer'], errors='coerce')
    df['WristAccelerometer_y'] = pd.to_numeric(df['Unnamed: 30'], errors='coerce')
    df['WristAccelerometer_z'] = pd.to_numeric(df['Unnamed: 31'], errors='coerce')
    df['WristAngularVelocity_x'] = pd.to_numeric(df['WristAngularVelocity'], errors='coerce')
    df['WristAngularVelocity_y'] = pd.to_numeric(df['Unnamed: 33'], errors='coerce')
    df['WristAngularVelocity_z'] = pd.to_numeric(df['Unnamed: 34'], errors='coerce')

    # Calculate magnitude
    df['Acc_mag'] = np.sqrt(df['WristAccelerometer_x']**2 +
                            df['WristAccelerometer_y']**2 +
                            df['WristAccelerometer_z']**2)
    df['Gyro_mag'] = np.sqrt(df['WristAngularVelocity_x']**2 +
                             df['WristAngularVelocity_y']**2 +
                             df['WristAngularVelocity_z']**2)

    # Define Fall Now based on Tag
    FALL_CODES = [7, 8, 9, 10, 11]
    df['fall_now'] = df['Tag'].apply(lambda x: 1 if x in FALL_CODES else 0)

    # Fall Soon (FALL_SOON_HORIZON seconds ahead)
    fall_series = df['fall_now'].values
    df['fall_soon'] = [int(fall_series[i+1:i+FALL_SOON_HORIZON+1].max()) 
                       if i+FALL_SOON_HORIZON < len(fall_series) else 0
                       for i in range(len(fall_series))]

    # Handle missing values
    df[FEATURES] = df[FEATURES].fillna(0)

    X = df[FEATURES].values
    y_now = df['fall_now'].values
    y_soon = df['fall_soon'].values

    # Split data
    X_train_raw, X_test_raw, y_train_now, y_test_now, y_train_soon, y_test_soon = train_test_split(
        X, y_now, y_soon, test_size=test_size, random_state=42, stratify=y_now
    )

    # Ensure folders exist
    os.makedirs(SCALER_DIR, exist_ok=True)
    os.makedirs(MODELS_DIR, exist_ok=True)

    # Scaling
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_raw)
    X_test_scaled = scaler.transform(X_test_raw)
    
    # Save scaler
    joblib.dump(scaler, SCALER_PATH)
    print(f"Scaler saved to {SCALER_PATH}")

    # Create sequences with sliding window
    def create_sequences(data, target, steps, step_size=1):
        X_seq, y_seq = [], []
        for i in range(0, len(data)-steps, step_size):
            X_seq.append(data[i:i+steps])
            y_seq.append(target[i+steps-1])
        return np.array(X_seq), np.array(y_seq)

    X_train, y_train_now_seq = create_sequences(X_train_scaled, y_train_now, time_steps, step_size)
    _, y_train_soon_seq = create_sequences(X_train_scaled, y_train_soon, time_steps, step_size)
    X_test, y_test_now_seq = create_sequences(X_test_scaled, y_test_now, time_steps, step_size)
    _, y_test_soon_seq = create_sequences(X_test_scaled, y_test_soon, time_steps, step_size)

    print(f"Training set: {X_train.shape}, Test set: {X_test.shape}")
    return X_train, X_test, y_train_now_seq, y_test_now_seq, y_train_soon_seq, y_test_soon_seq

# ==============================
# 2) ATTENTION BLOCK
# ==============================
def attention_block(inputs):
    score = layers.Dense(128, activation='tanh')(inputs)
    score = layers.Dense(1, activation='sigmoid')(score)
    attention = layers.Multiply()([inputs, score])
    context = layers.GlobalAveragePooling1D()(attention)
    return context

# ==============================
# 3) LSTM-ATTENTION MODEL (الموديل النهائي)
# ==============================
def build_lstm_attention(time_steps, features):
    print("Building LSTM-Attention model...")
    inp = Input(shape=(time_steps, features))
    
    # First BiLSTM layer with residual connection
    x = layers.Bidirectional(layers.LSTM(128, return_sequences=True))(inp)
    x = layers.LayerNormalization()(x)
    x = layers.Dropout(0.3)(x)
    
    # Second BiLSTM layer
    x2 = layers.Bidirectional(layers.LSTM(128, return_sequences=True))(x)
    x = layers.Add()([x, x2])
    x = layers.LayerNormalization()(x)
    x = layers.Dropout(0.3)(x)
    
    # Attention mechanism
    att = attention_block(x)
    
    # Shared dense layers
    shared = layers.Dense(128, activation='relu')(att)
    shared = layers.Dropout(0.3)(shared)
    
    # Fall Now output
    fall_now = layers.Dense(64, activation='relu')(shared)
    fall_now = layers.Dropout(0.2)(fall_now)
    fall_now = layers.Dense(1, activation='sigmoid', name='fall_now')(fall_now)
    
    # Fall Soon output
    fall_soon = layers.Dense(64, activation='relu')(shared)
    fall_soon = layers.Dropout(0.2)(fall_soon)
    fall_soon = layers.Dense(1, activation='sigmoid', name='fall_soon')(fall_soon)
    
    # Create model
    model = Model(inp, [fall_now, fall_soon])
    
    # Compile with Adam optimizer
    model.compile(
        optimizer=tf.keras.optimizers.Adam(LEARNING_RATE),
        loss='binary_crossentropy',
        metrics={
            "fall_now": ['accuracy', tf.keras.metrics.Precision(name='precision_now'), 
                        tf.keras.metrics.Recall(name='recall_now')],
            "fall_soon": ['accuracy', tf.keras.metrics.Precision(name='precision_soon'), 
                         tf.keras.metrics.Recall(name='recall_soon')]
        }
    )
    
    model.summary()
    return model

# ==============================
# 4) TRAIN FINAL MODEL
# ==============================
def train_final_model():
    print("="*50)
    print("TRAINING FINAL LSTM-ATTENTION MODEL")
    print("="*50)
    
    # Prepare data
    X_train, X_test, y_train_now, y_test_now, y_train_soon, y_test_soon = prepare_common_data()
    
    # Build model
    model = build_lstm_attention(X_train.shape[1], X_train.shape[2])
    
    # Callbacks
    callbacks = [
        EarlyStopping(monitor='val_loss', patience=8, restore_best_weights=True, verbose=1),
        ReduceLROnPlateau(monitor='val_loss', factor=0.4, patience=4, verbose=1),
        ModelCheckpoint(FINAL_MODEL_PATH, save_best_only=True, monitor='val_loss', verbose=1)
    ]
    
    # Train model
    history = model.fit(
        X_train,
        {"fall_now": y_train_now, "fall_soon": y_train_soon},
        validation_data=(X_test, {"fall_now": y_test_now, "fall_soon": y_test_soon}),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1
    )
    
    # Save final model
    model.save(FINAL_MODEL_PATH)
    print(f"Final model saved to {FINAL_MODEL_PATH}")
    
    # Evaluate on test set
    print("\nEvaluating on test set...")
    results = model.evaluate(X_test, {"fall_now": y_test_now, "fall_soon": y_test_soon}, verbose=0)
    
    print(f"\nTest Results:")
    print(f"Loss: {results[0]:.4f}")
    print(f"Fall Now Accuracy: {results[1]:.4f}")
    print(f"Fall Soon Accuracy: {results[6]:.4f}")
    
    return model, history

if __name__ == "__main__":
    train_final_model()