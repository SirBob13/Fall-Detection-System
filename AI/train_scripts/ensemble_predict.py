import time
import tensorflow as tf
from sklearn.metrics import f1_score
from train_all import prepare_common_data

MODELS = {
    "LSTM": "../models/FINAL_LSTM_Attention.keras",
    "BiGRU": "../models/FINAL_BiGRU_Attention.keras",
    "Hybrid": "../models/FINAL_BiGRU_Attention_LSTM.keras",
}

print("Loading test data...")
_, X_test, _, y_test_now, _, _ = prepare_common_data()

scores = {}

for name, path in MODELS.items():
    model = tf.keras.models.load_model(path, compile=False)

    start = time.time()
    preds_now, _ = model.predict(X_test, verbose=0)
    end = time.time()

    preds_bin = (preds_now > 0.5).astype(int)
    f1 = f1_score(y_test_now, preds_bin)

    time_per_sample = (end - start) / len(X_test)

    scores[name] = {
        "model": model,
        "f1": f1,
        "time": time_per_sample
    }

best_name = min(scores.items(), key=lambda x: (1 - x[1]["f1"], x[1]["time"]))[0]
best_model = scores[best_name]["model"]

print("\n==============================")
print(f"🏆 SELECTED MODEL: {best_name}")
print(f"F1 Score        : {scores[best_name]['f1']:.4f}")
print(f"Inference Time  : {scores[best_name]['time']*1000:.2f} ms")
print("==============================")

p_now, p_soon = best_model.predict(X_test)
print("Prediction completed using best model only.")
