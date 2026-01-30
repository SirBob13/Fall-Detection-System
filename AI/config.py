# AI/config.py
import os

# مسارات أساسية
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
SCALER_DIR = os.path.join(BASE_DIR, "scaler")
DATASET_DIR = os.path.join(BASE_DIR, "dataset")

# إعدادات النموذج
TIME_STEPS = 50
STEP_SIZE = 1
FEATURES = ['WristAccelerometer_x', 'WristAccelerometer_y', 'WristAccelerometer_z',
            'WristAngularVelocity_x', 'WristAngularVelocity_y', 'WristAngularVelocity_z',
            'Acc_mag', 'Gyro_mag']

# إعدادات التدريب
BATCH_SIZE = 128
EPOCHS = 80
LEARNING_RATE = 0.0008
TEST_SIZE = 0.2

# إعدادات الكشف
FALL_THRESHOLD = 0.5
FALL_SOON_HORIZON = 10  # ثواني للتنبؤ بالسقوط القريب

# مسارات الملفات
DATASET_PATH = os.path.join(DATASET_DIR, "DataSet.csv")
SCALER_PATH = os.path.join(SCALER_DIR, "scaler_all.save")

# الموديل النهائي المختار (LSTM-Attention كما في العرض)
FINAL_MODEL_NAME = "FINAL_LSTM_Attention.keras"
FINAL_MODEL_PATH = os.path.join(MODELS_DIR, FINAL_MODEL_NAME)