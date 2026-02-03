import time
import tensorflow as tf
from sklearn.metrics import f1_score, accuracy_score, precision_score, recall_score
import numpy as np
import pandas as pd
import os
import sys

# إضافة المسار للوظائف المساعدة
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# المسارات الصحيحة
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_PATH = os.path.join(BASE_DIR, "dataset/DataSet.csv")

# كل الموديلات المتاحة
MODELS = {
    "LSTM": os.path.join(BASE_DIR, "models/FINAL_LSTM_Attention.keras"),
    "BiGRU": os.path.join(BASE_DIR, "models/FINAL_BiGRU_Attention.keras"),
    "Hybrid": os.path.join(BASE_DIR, "models/FINAL_BiGRU_Attention_LSTM.keras"),
    "Dual_Output": os.path.join(BASE_DIR, "models/fall_detection_final.keras"),
}

print(f"🚀 COMPARING ALL MODELS")
print(f"Base directory: {BASE_DIR}")
print(f"Dataset path: {DATASET_PATH}")
print("=" * 50)

# تحقق من وجود الملفات
print("\n🔍 Checking files...")
for name, path in MODELS.items():
    if os.path.exists(path):
        print(f"✅ {name}: {path}")
    else:
        print(f"❌ {name}: NOT FOUND at {path}")

if not os.path.exists(DATASET_PATH):
    print(f"\n❌ Dataset not found at: {DATASET_PATH}")
    print("Looking for dataset in alternative locations...")
    
    # محاولة إيجاد المسار الصحيح
    possible_paths = [
        os.path.join(BASE_DIR, "dataset/DataSet.csv"),
        os.path.join(BASE_DIR, "../dataset/DataSet.csv"),
        os.path.join(BASE_DIR, "../../dataset/DataSet.csv"),
        os.path.join(BASE_DIR, "../DataSet.csv"),
    ]
    
    found = False
    for path in possible_paths:
        if os.path.exists(path):
            DATASET_PATH = path
            print(f"✅ Found dataset at: {path}")
            found = True
            break
    
    if not found:
        print("❌ Could not find dataset. Please check the path.")
        exit(1)

# ======================================
# وظيفة لتحضير البيانات للموديلات القديمة (8 features)
# ======================================
def prepare_data_8_features():
    """Prepare data for old models (8 features)"""
    print(f"\n📊 Loading dataset for 8-feature models...")
    
    # تحميل البيانات
    df = pd.read_csv(DATASET_PATH, nrows=20000, low_memory=False)
    print(f"   Loaded {len(df)} rows")
    
    # تحويل إلى numeric
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.ffill().bfill().fillna(0)
    
    # استخراج بيانات المستشعر
    df['WristAccelerometer_x'] = df.iloc[:, 29]
    df['WristAccelerometer_y'] = df.iloc[:, 30]
    df['WristAccelerometer_z'] = df.iloc[:, 31]
    df['WristAngularVelocity_x'] = df.iloc[:, 32]
    df['WristAngularVelocity_y'] = df.iloc[:, 33]
    df['WristAngularVelocity_z'] = df.iloc[:, 34]
    
    # حساب الـ features الأساسية
    df['Acc_mag'] = np.sqrt(df['WristAccelerometer_x']**2 +
                            df['WristAccelerometer_y']**2 +
                            df['WristAccelerometer_z']**2)
    df['Gyro_mag'] = np.sqrt(df['WristAngularVelocity_x']**2 +
                             df['WristAngularVelocity_y']**2 +
                             df['WristAngularVelocity_z']**2)
    
    # اختيار features (8 فقط)
    FEATURES_8 = [
        'WristAccelerometer_x', 'WristAccelerometer_y', 'WristAccelerometer_z',
        'WristAngularVelocity_x', 'WristAngularVelocity_y', 'WristAngularVelocity_z',
        'Acc_mag', 'Gyro_mag'
    ]
    
    # إنشاء targets
    df['Tag'] = df['Tag'].fillna(0).astype(int)
    FALL_CODES = [7, 8, 9, 10, 11]
    df['fall_now'] = df['Tag'].apply(lambda x: 1 if x in FALL_CODES else 0)
    
    # تحضير البيانات
    X = df[FEATURES_8].values.astype(np.float32)
    y = df['fall_now'].values.astype(np.float32)
    
    # لا نستخدم scaler للموديلات القديمة
    print("   Using raw data (no scaling for 8-feature models)")
    
    # إنشاء sequences
    TIME_STEPS = 100
    STEP_SIZE = 5
    
    X_seq, y_seq = [], []
    for i in range(0, len(X) - TIME_STEPS, STEP_SIZE):
        X_seq.append(X[i:i + TIME_STEPS])
        y_seq.append(y[i + TIME_STEPS - 1])
    
    X_seq = np.array(X_seq, dtype=np.float32)
    y_seq = np.array(y_seq, dtype=np.float32)
    
    print(f"\n✅ 8-feature test data prepared:")
    print(f"   X shape: {X_seq.shape}")
    print(f"   y shape: {y_seq.shape}")
    print(f"   Falls: {np.sum(y_seq==1)} ({np.sum(y_seq==1)/len(y_seq)*100:.1f}%)")
    
    return X_seq, y_seq

# ======================================
# وظيفة لتحضير البيانات للموديل الجديد (16 features)
# ======================================
def prepare_data_16_features():
    """Prepare data for Dual_Output model (16 enhanced features)"""
    print(f"\n📊 Loading dataset for 16-feature model...")
    
    # تحميل البيانات
    df = pd.read_csv(DATASET_PATH, nrows=20000, low_memory=False)
    print(f"   Loaded {len(df)} rows")
    
    # تحويل إلى numeric
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.ffill().bfill().fillna(0)
    
    # استخراج بيانات المستشعر
    df['WristAccelerometer_x'] = df.iloc[:, 29]
    df['WristAccelerometer_y'] = df.iloc[:, 30]
    df['WristAccelerometer_z'] = df.iloc[:, 31]
    df['WristAngularVelocity_x'] = df.iloc[:, 32]
    df['WristAngularVelocity_y'] = df.iloc[:, 33]
    df['WristAngularVelocity_z'] = df.iloc[:, 34]
    
    # حساب الـ features الأساسية
    df['Acc_mag'] = np.sqrt(df['WristAccelerometer_x']**2 +
                            df['WristAccelerometer_y']**2 +
                            df['WristAccelerometer_z']**2)
    df['Gyro_mag'] = np.sqrt(df['WristAngularVelocity_x']**2 +
                             df['WristAngularVelocity_y']**2 +
                             df['WristAngularVelocity_z']**2)
    
    # حساب الـ enhanced features (كما في التدريب)
    window_size = 10
    
    # 1. VARIANCE
    df['Acc_var_x'] = df['WristAccelerometer_x'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var_y'] = df['WristAccelerometer_y'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var_z'] = df['WristAccelerometer_z'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Acc_var'] = (df['Acc_var_x'] + df['Acc_var_y'] + df['Acc_var_z']) / 3
    
    df['Gyro_var_x'] = df['WristAngularVelocity_x'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var_y'] = df['WristAngularVelocity_y'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var_z'] = df['WristAngularVelocity_z'].rolling(window_size, min_periods=1).var().fillna(0)
    df['Gyro_var'] = (df['Gyro_var_x'] + df['Gyro_var_y'] + df['Gyro_var_z']) / 3
    
    # 2. ENERGY
    df['Acc_energy'] = (df['WristAccelerometer_x']**2 + 
                        df['WristAccelerometer_y']**2 + 
                        df['WristAccelerometer_z']**2)
    df['Gyro_energy'] = (df['WristAngularVelocity_x']**2 + 
                         df['WristAngularVelocity_y']**2 + 
                         df['WristAngularVelocity_z']**2)
    
    # 3. JERK
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
    
    # اختيار features (16 enhanced)
    FEATURES_16 = [
        'WristAccelerometer_x', 'WristAccelerometer_y', 'WristAccelerometer_z',
        'WristAngularVelocity_x', 'WristAngularVelocity_y', 'WristAngularVelocity_z',
        'Acc_mag', 'Gyro_mag',
        'Acc_var', 'Gyro_var', 'Acc_energy', 'Gyro_energy',
        'Jerk_mag', 'Acc_MAV', 'Acc_SMA', 'Acc_std'
    ]
    
    # إنشاء targets
    df['Tag'] = df['Tag'].fillna(0).astype(int)
    FALL_CODES = [7, 8, 9, 10, 11]
    df['fall_now'] = df['Tag'].apply(lambda x: 1 if x in FALL_CODES else 0)
    
    # تحضير البيانات
    X = df[FEATURES_16].values.astype(np.float32)
    y = df['fall_now'].values.astype(np.float32)
    
    # تطبيق scaling للموديل الجديد
    scaler_path = os.path.join(BASE_DIR, "scaler/scaler_final.save")
    if os.path.exists(scaler_path):
        import joblib
        scaler = joblib.load(scaler_path)
        X = scaler.transform(X)
        print("   Applied scaling for 16-feature model")
    else:
        print("   ⚠️ Scaler not found, using raw data")
    
    # إنشاء sequences
    TIME_STEPS = 100
    STEP_SIZE = 5
    
    X_seq, y_seq = [], []
    for i in range(0, len(X) - TIME_STEPS, STEP_SIZE):
        X_seq.append(X[i:i + TIME_STEPS])
        y_seq.append(y[i + TIME_STEPS - 1])
    
    X_seq = np.array(X_seq, dtype=np.float32)
    y_seq = np.array(y_seq, dtype=np.float32)
    
    print(f"\n✅ 16-feature test data prepared:")
    print(f"   X shape: {X_seq.shape}")
    print(f"   y shape: {y_seq.shape}")
    print(f"   Falls: {np.sum(y_seq==1)} ({np.sum(y_seq==1)/len(y_seq)*100:.1f}%)")
    
    return X_seq, y_seq

# ======================================
# المقارنة الرئيسية
# ======================================
def compare_models():
    """Compare all models with appropriate data preparation"""
    scores = {}
    results = []
    
    # تحضير البيانات مسبقاً
    print("\n" + "="*50)
    print("📥 PREPARING TEST DATA")
    print("="*50)
    
    X_test_8, y_test_8 = prepare_data_8_features()
    X_test_16, y_test_16 = prepare_data_16_features()
    
    for name, path in MODELS.items():
        print(f"\n🧪 Testing {name} model...")
        
        # التحقق من وجود الموديل
        if not os.path.exists(path):
            print(f"   ⚠️ Model not found: {path}")
            continue
            
        try:
            # تحميل الموديل
            model = tf.keras.models.load_model(path, compile=False)
            print(f"   ✅ Model loaded successfully")
            
            # تحديد نوع البيانات المناسب
            model_input_shape = model.input_shape
            if isinstance(model_input_shape, list):
                model_input_shape = model_input_shape[0]
            
            expected_features = model_input_shape[-1]
            
            if expected_features == 16:
                print(f"   📐 Model expects 16 features (using 16-feature data)")
                X_test = X_test_16
                y_test = y_test_16
            elif expected_features == 8:
                print(f"   📐 Model expects 8 features (using 8-feature data)")
                X_test = X_test_8
                y_test = y_test_8
            else:
                print(f"   ⚠️ Unknown feature count: {expected_features}")
                continue
            
            # استخدام عدد أقل من العينات للاختبار السريع
            sample_size = min(200, len(X_test))
            X_sample = X_test[:sample_size]
            y_sample = y_test[:sample_size]
            
            print(f"   📊 Testing on {sample_size} samples")
            
            # قياس الوقت والأداء
            start = time.time()
            
            if name == "Dual_Output":
                # الموديل الجديد له مخرجين
                preds_now, preds_soon = model.predict(X_sample, verbose=0)
                preds_now = preds_now.reshape(-1)
            else:
                # الموديلات القديمة لها مخرج واحد
                preds_now = model.predict(X_sample, verbose=0).reshape(-1)
            
            end = time.time()
            
            # استخدام العتبة المناسبة
            if name == "Dual_Output":
                # استخدام عتبة 0.35 كما في التدريب
                preds_bin = (preds_now > 0.35).astype(int)
            else:
                preds_bin = (preds_now > 0.5).astype(int)
            
            # حساب المقاييس
            accuracy = accuracy_score(y_sample, preds_bin)
            precision = precision_score(y_sample, preds_bin, zero_division=0)
            recall = recall_score(y_sample, preds_bin, zero_division=0)
            f1 = f1_score(y_sample, preds_bin, zero_division=0)
            
            # حساب الوقت
            total_time = end - start
            time_per_sample = total_time / len(preds_bin)
            
            # تخزين النتائج
            scores[name] = {
                "model": model,
                "accuracy": accuracy,
                "precision": precision,
                "recall": recall,
                "f1": f1,
                "total_time": total_time,
                "time_per_sample": time_per_sample,
                "features": expected_features,
                "samples_tested": sample_size,
                "predictions": preds_bin
            }
            
            # إضافة للنتائج
            results.append({
                "Model": name,
                "Features": expected_features,
                "Accuracy": f"{accuracy:.4f}",
                "Precision": f"{precision:.4f}",
                "Recall": f"{recall:.4f}",
                "F1-Score": f"{f1:.4f}",
                "Total Time (s)": f"{total_time:.3f}",
                "Time/Sample (ms)": f"{time_per_sample*1000:.3f}",
                "Samples Tested": sample_size
            })
            
            print(f"   ✅ F1 Score: {f1:.4f}, Accuracy: {accuracy*100:.1f}%")
            print(f"   ⏱️  Time per sample: {time_per_sample*1000:.2f} ms")
            
        except Exception as e:
            print(f"   ❌ Error with {name}: {e}")
            continue
    
    return scores, results

# ======================================
# العرض والتحليل
# ======================================
def display_results(scores, results):
    """Display comparison results"""
    if not scores:
        print("\n❌ No models were successfully tested!")
        return
    
    print("\n" + "="*50)
    print("📊 COMPARISON RESULTS")
    print("="*50)
    
    # عرض النتائج في جدول
    df_results = pd.DataFrame(results)
    print(df_results.to_string(index=False))
    
    # التصنيف حسب F1-Score
    print("\n" + "="*50)
    print("🏆 MODEL RANKINGS BY F1-SCORE")
    print("="*50)
    
    sorted_by_f1 = sorted(scores.items(), key=lambda x: x[1]["f1"], reverse=True)
    for i, (name, score) in enumerate(sorted_by_f1, 1):
        print(f"{i}. {name} ({score['features']} features):")
        print(f"   F1-Score: {score['f1']:.4f}")
        print(f"   Accuracy: {score['accuracy']*100:.1f}%")
        print(f"   Recall: {score['recall']*100:.1f}%")
        print(f"   Speed: {score['time_per_sample']*1000:.2f} ms/sample")
        print(f"   Samples: {score['samples_tested']}")
        print()
    
    # أفضل موديل شامل
    print("\n" + "="*50)
    print("🎯 BEST OVERALL MODEL")
    print("="*50)
    
    # وزن المقاييس: 60% أداء، 40% سرعة
    for name in scores.keys():
        score = scores[name]
        performance_score = 0.4 * score["f1"] + 0.3 * score["accuracy"] + 0.3 * score["recall"]
        speed_score = 1 - min(score["time_per_sample"] * 200, 1)  # أسرع = أفضل
        
        overall_score = 0.6 * performance_score + 0.4 * speed_score
        scores[name]["overall_score"] = overall_score
    
    best_overall = max(scores.items(), key=lambda x: x[1]["overall_score"])
    best_name = best_overall[0]
    best_score = best_overall[1]
    
    print(f"\n🏆 SELECTED MODEL: {best_name}")
    print(f"   Overall Score: {best_score['overall_score']:.3f}")
    print(f"   F1-Score: {best_score['f1']:.4f}")
    print(f"   Accuracy: {best_score['accuracy']*100:.1f}%")
    print(f"   Recall: {best_score['recall']*100:.1f}%")
    print(f"   Speed: {best_score['time_per_sample']*1000:.2f} ms/sample")
    print(f"   Features: {best_score['features']}")
    
    # توصية للاستخدام
    print("\n" + "="*50)
    print("💡 RECOMMENDATION")
    print("="*50)
    
    if best_score['f1'] > 0.95:
        print("✅ EXCELLENT for production use!")
    elif best_score['f1'] > 0.90:
        print("👍 VERY GOOD for production use")
    elif best_score['f1'] > 0.85:
        print("⚠️ ACCEPTABLE, but may need improvement")
    else:
        print("❌ NEEDS IMPROVEMENT before production")
    
    if best_score['time_per_sample'] * 1000 < 50:
        print("⚡ FAST ENOUGH for real-time applications")
    elif best_score['time_per_sample'] * 1000 < 100:
        print("✅ ACCEPTABLE speed for real-time")
    else:
        print("⚠️ MAY BE TOO SLOW for real-time")
    
    # مقارنة خاصة بين الموديل الجديد والقديم
    if "Dual_Output" in scores and len(scores) > 1:
        print("\n" + "="*50)
        print("🔄 DUAL_OUTPUT VS OLD MODELS")
        print("="*50)
        
        dual_score = scores["Dual_Output"]
        old_models = [m for m in MODELS.keys() if m != "Dual_Output" and m in scores]
        
        if old_models:
            best_old = max(old_models, key=lambda x: scores[x]["f1"])
            old_score = scores[best_old]
            
            print(f"\nComparison: Dual_Output vs {best_old}")
            print(f"{'Metric':<15} {'Dual_Output':<12} {best_old:<12} {'Difference':<12}")
            print(f"{'-'*15} {'-'*12} {'-'*12} {'-'*12}")
            
            f1_diff = dual_score['f1'] - old_score['f1']
            acc_diff = dual_score['accuracy'] - old_score['accuracy']
            rec_diff = dual_score['recall'] - old_score['recall']
            time_diff = dual_score['time_per_sample'] - old_score['time_per_sample']
            
            print(f"{'F1-Score':<15} {dual_score['f1']:<12.4f} {old_score['f1']:<12.4f} {f1_diff:+.4f}")
            print(f"{'Accuracy':<15} {dual_score['accuracy']:<12.4f} {old_score['accuracy']:<12.4f} {acc_diff:+.4f}")
            print(f"{'Recall':<15} {dual_score['recall']:<12.4f} {old_score['recall']:<12.4f} {rec_diff:+.4f}")
            print(f"{'Time (ms)':<15} {dual_score['time_per_sample']*1000:<12.2f} {old_score['time_per_sample']*1000:<12.2f} {time_diff*1000:+.2f} ms")
            
            if f1_diff > 0:
                print(f"\n✅ Dual_Output is BETTER by {f1_diff:.4f} in F1-Score")
            else:
                print(f"\n⚠️  {best_old} is BETTER by {-f1_diff:.4f} in F1-Score")
    
    return best_name, best_score

# ======================================
# التنفيذ الرئيسي
# ======================================
if __name__ == "__main__":
    print("🚀 FALL DETECTION MODELS COMPARISON")
    print("="*60)
    
    # مقارنة الموديلات
    scores, results = compare_models()
    
    if scores:
        # عرض النتائج
        best_name, best_score = display_results(scores, results)
        
        # التنبؤ باستخدام أفضل موديل
        print("\n" + "="*50)
        print("🔮 FINAL PREDICTION WITH BEST MODEL")
        print("="*50)
        
        # استخدام أفضل موديل للتنبؤ
        best_model = scores[best_name]["model"]
        
        if best_name == "Dual_Output":
            # تحضير بيانات للتنبؤ
            X_test_16, y_test_16 = prepare_data_16_features()
            predictions_now, predictions_soon = best_model.predict(X_test_16[:10], verbose=0)
            
            print(f"✅ Dual_Output model predictions (first 10 samples):")
            print(f"{'Sample':<8} {'Fall Now':<12} {'Fall Soon':<12} {'Actual':<8}")
            print("-" * 45)
            
            for i in range(min(10, len(predictions_now))):
                fall_now_prob = predictions_now[i][0]
                fall_soon_prob = predictions_soon[i][0]
                actual = y_test_16[i]
                
                print(f"{i:<8} {fall_now_prob:<12.4f} {fall_soon_prob:<12.4f} {actual:<8.0f}")
        else:
            # تحضير بيانات للتنبؤ
            X_test_8, y_test_8 = prepare_data_8_features()
            predictions = best_model.predict(X_test_8[:10], verbose=0)
            
            print(f"✅ {best_name} model predictions (first 10 samples):")
            print(f"{'Sample':<8} {'Fall Probability':<20} {'Actual':<8}")
            print("-" * 40)
            
            for i in range(min(10, len(predictions))):
                fall_prob = predictions[i][0]
                actual = y_test_8[i]
                print(f"{i:<8} {fall_prob:<20.4f} {actual:<8.0f}")
        
        print("\n✅ Comparison completed successfully!")
    else:
        print("\n❌ No models were successfully tested. Please check:")
        print("   1. Model files exist")
        print("   2. Dataset path is correct")
        print("   3. All dependencies are installed")