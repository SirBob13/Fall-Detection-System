# AI/test/test_model.py
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import tensorflow as tf
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from train_scripts.train_all import prepare_common_data
from config import *

def evaluate_model():
    """Evaluate the final model on test set."""
    
    print("="*50)
    print("EVALUATING FINAL LSTM-ATTENTION MODEL")
    print("="*50)
    
    # Load test data
    print("Loading test data...")
    _, X_test, _, y_test_now, _, y_test_soon = prepare_common_data()
    
    # Load model
    print(f"Loading model from {FINAL_MODEL_PATH}")
    if not os.path.exists(FINAL_MODEL_PATH):
        print("Model not found. Please train the model first.")
        return
    
    model = tf.keras.models.load_model(FINAL_MODEL_PATH, compile=False)
    
    # Predict
    print("Making predictions...")
    pred_now, pred_soon = model.predict(X_test, verbose=0)
    
    # Convert to binary
    y_pred_now = (pred_now > FALL_THRESHOLD).astype(int)
    y_pred_soon = (pred_soon > FALL_THRESHOLD).astype(int)
    
    # Calculate metrics for Fall Now
    acc_now = accuracy_score(y_test_now, y_pred_now)
    prec_now = precision_score(y_test_now, y_pred_now, zero_division=0)
    rec_now = recall_score(y_test_now, y_pred_now, zero_division=0)
    f1_now = f1_score(y_test_now, y_pred_now, zero_division=0)
    
    # Calculate metrics for Fall Soon
    acc_soon = accuracy_score(y_test_soon, y_pred_soon)
    prec_soon = precision_score(y_test_soon, y_pred_soon, zero_division=0)
    rec_soon = recall_score(y_test_soon, y_pred_soon, zero_division=0)
    f1_soon = f1_score(y_test_soon, y_pred_soon, zero_division=0)
    
    # Print results
    print("\n" + "="*50)
    print("FALL NOW PREDICTION RESULTS")
    print("="*50)
    print(f"Accuracy:  {acc_now:.4f}")
    print(f"Precision: {prec_now:.4f}")
    print(f"Recall:    {rec_now:.4f}")
    print(f"F1-Score:  {f1_now:.4f}")
    
    print("\n" + "="*50)
    print("FALL SOON PREDICTION RESULTS")
    print("="*50)
    print(f"Accuracy:  {acc_soon:.4f}")
    print(f"Precision: {prec_soon:.4f}")
    print(f"Recall:    {rec_soon:.4f}")
    print(f"F1-Score:  {f1_soon:.4f}")
    
    # Confusion matrix for Fall Now
    from sklearn.metrics import confusion_matrix
    cm = confusion_matrix(y_test_now, y_pred_now)
    
    print("\n" + "="*50)
    print("CONFUSION MATRIX (Fall Now)")
    print("="*50)
    print("True Negatives:  ", cm[0, 0])
    print("False Positives: ", cm[0, 1])
    print("False Negatives: ", cm[1, 0])
    print("True Positives:  ", cm[1, 1])
    
    # Calculate False Alarm Rate
    if cm[0, 0] + cm[0, 1] > 0:
        far = cm[0, 1] / (cm[0, 0] + cm[0, 1])
        print(f"False Alarm Rate: {far:.4f}")
    
    # Save results to file
    results = {
        'fall_now': {
            'accuracy': acc_now,
            'precision': prec_now,
            'recall': rec_now,
            'f1': f1_now
        },
        'fall_soon': {
            'accuracy': acc_soon,
            'precision': prec_soon,
            'recall': rec_soon,
            'f1': f1_soon
        },
        'confusion_matrix': cm.tolist()
    }
    
    import json
    results_path = os.path.join(BASE_DIR, "results", "model_evaluation.json")
    os.makedirs(os.path.dirname(results_path), exist_ok=True)
    
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=4)
    
    print(f"\nResults saved to: {results_path}")
    
    return results

if __name__ == "__main__":
    evaluate_model()