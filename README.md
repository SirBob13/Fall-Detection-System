# 📘 AI-Based Fall Detection System (End-to-End)

[![Python](https://img.shields.io/badge/Python-3.10-blue?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.95-green?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![TensorFlow](https://img.shields.io/badge/TensorFlow-2.14-orange?logo=tensorflow&logoColor=white)](https://www.tensorflow.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-blue?logo=mysql&logoColor=white)](https://www.mysql.com/)

End-to-end **AI Fall Detection System** predicting **fall_now** and **fall_soon** using LSTM, BiGRU, and Hybrid models.

---

# 🚀 Features

### 🧠 AI & ML
- Ensemble: **LSTM + BiGRU + Hybrid (BiGRU-LSTM)**  
- Multi-task outputs: **fall_now**, **fall_soon**  
- Sliding-window (50 timesteps) + StandardScaler  
- Weighted model fusion + real-time prediction

### ⚙️ Backend
- FastAPI, MySQL integration, motion & vital data, prediction logging

### 💓 Vital Signs
- Sample every 30 min  
- Activate sensor 1 min if abnormal  
- Alert if still abnormal

### 🔌 Hardware
- ESP32 + IMU (`hardware/hardware.ino`), Wi‑Fi / BLE provisioning

### 📱 Mobile App
- Expo / React Native (`MobileApp/`): alerts, BLE pairing, vitals, offline queue

### 🖥 Admin dashboard
- Next.js (`admin-dashboard/`): users, devices, overview

---

# 🧱 System Architecture (3D-like Interactive)

```mermaid
flowchart TD
    subgraph Device
        A[ESP32 + IMU]
    end
    subgraph Backend
        B[FastAPI Backend]
        C[Motion Sensor Data]
        D[Vital Signs Data]
        E[AI Inference: fall_now / fall_soon]
        F[SQL Database]
    end
    subgraph App
        G[Mobile App: Alerts / History / Monitoring]
    end

    A -->|WiFi/BLE| B
    B --> C
    B --> D
    B --> E
    C --> F
    D --> F
    E --> F
    F --> G

    click A href "#hardware" "Go to Hardware"
    click B href "#backend" "Go to Backend"
    click E href "#ai-models" "Go to AI Models"
    click G href "#mobile-app" "Go to Mobile App"
```

---

# 🔄 Workflow (3D Interactive)

```mermaid
flowchart TD
    A[Motion Sensor → ESP32] --> B[Backend receives & stores data]
    B --> C[Preprocessing: Scaling + Sliding-window]
    C --> D[AI Ensemble Prediction: LSTM/BiGRU/Hybrid]
    D --> E[Weighted Fusion → fall_now & fall_soon]
    E --> F[Store Prediction in DB]
    F --> G{Fall Detected?}
    G -- Yes --> H[Mobile Alert + Activate Vital Sensor]
    H --> I{Abnormal Vital Signs?}
    I -- Yes --> J[Final Alert Sent]
    G -- No --> K[Continue Monitoring]

    click D href "#ai-models" "Go to AI Models"
    click H href "#vital-signs" "Go to Vital Signs"
```

---

# 📁 Project Structure

```
AI/
├── dataset/DataSet.csv
├── models/
│   ├── FINAL_LSTM_Attention.keras
│   ├── FINAL_BiGRU_Attention.keras
│   └── FINAL_BiGRU_Attention_LSTM.keras
├── scaler/scaler_all.save
├── train_scripts/
│   ├── train_all.py
│   └── ensemble_predict.py
└── inference/predictor.py

Backend/
├── app/
│   ├── ai_model.py
│   ├── crud.py
│   ├── database.py
│   ├── main.py
│   ├── models.py
│   ├── schemas.py
│   ├── simulate_sensor.py
│   └── routes/
│       ├── motions.py
│       ├── predictions.py
│       ├── users.py
│       ├── vitals.py
│       └── predict.py
└── test/test_full_system.py

MobileApp/
├── README.md, app.json, eas.json, src/ (screens, services, i18n)
admin-dashboard/
├── src/app/admin/ …
hardware/
└── hardware.ino
```

---

# 🧪 AI Models <a name="ai-models"></a>

- **LSTM + Attention**: Bidirectional LSTM, Residual connections, Custom attention  
- **BiGRU + Attention**: 2 BiGRU layers, Normalization + Dropout, Attention pooling  
- **Hybrid BiGRU-LSTM**: GRU → LSTM stacked, Residual fusion

### 🎛 Ensemble Fusion
```python
weights = {"m1": 0.5, "m2": 0.2, "m3": 0.3}
ensemble = (p1*m1 + p2*m2 + p3*m3)
```

---

# ⚙️ Backend <a name="backend"></a>

**Users:** POST `/users/`, GET `/users/{id}`  
**Motion Sensor:** POST `/motions/`  
**Vitals:** POST `/vitals/`  
**Prediction:** POST `/predict/`  
**History:** GET `/predictions/{user_id}`

---

# 💓 Vital Signs <a name="vital-signs"></a>

- Sample every 30 min  
- Activate 1 min if abnormal  
- Send final alert if still abnormal

---

# 🔌 Hardware <a name="hardware"></a>

- ESP32 + IMU (MPU6050/9250)  
- WiFi/BLE streaming to backend

---

# 📱 Mobile App <a name="mobile-app">

- Live alerts  
- History visualization  
- Real-time dashboard

---

# ▶️ Running the Project

**Backend** (from repo root):

```bash
cd Backend
pip install -r requirements.txt
# copy Backend/.env.example to Backend/.env and edit
uvicorn app.main:app --reload
```

**Mobile app:** see [`MobileApp/README.md`](MobileApp/README.md) — setup, `.env`, local APK, and EAS builds.

---

# 💻 Installation

**Windows / macOS / Linux**

```bash
git clone <repo-url>
cd <repo-folder>/Backend
pip install -r requirements.txt
```

---

# 🔧 Next Phase
- ESP32 firmware  
- IMU integration  
- BLE/WiFi real streaming  
- Mobile app ( React Native)

---

# 👥 Contributors
- Aysha Kassem 
- Nada Etman 
- Ali Tamer
- Abdelrahman Mostafa
- Mohamed Kamal

- Supervisor: Assoc. Prof. Dr. Wessam M.Salama

---

# ⭐ Support
Star ⭐ if you like this project!

