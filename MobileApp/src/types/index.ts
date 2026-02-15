// User Types
export interface User {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  weight?: number;
  height?: number;
  medical_conditions?: string;
  emergency_contact?: string;
  is_active: boolean;
  created_at: string;
}

// Device Types
export interface Device {
  id: number;
  user_id: number;
  device_id: string;
  mac_address?: string;
  firmware_version?: string;
  battery_level?: number;
  is_connected?: boolean;
  last_seen?: string;
  created_at?: string;
}

// Motion Data Types
export interface MotionData {
  id: number;
  user_id: number;
  device_id: string;
  timestamp: string;
  acc_x: number;
  acc_y: number;
  acc_z: number;
  acc_mag: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  gyro_mag: number;
  temperature?: number;
  is_fall_suspected: boolean;
}

// Vital Signs Types
export interface VitalData {
  id: number;
  user_id: number;
  timestamp: string;
  heart_rate?: number;
  blood_pressure_systolic?: number;
  blood_pressure_diastolic?: number;
  oxygen_saturation?: number;
  body_temperature?: number;
  respiration_rate?: number;
  is_abnormal: boolean;
  abnormality_type?: string;
}

// Prediction Types
export interface Prediction {
  id: number;
  user_id: number;
  motion_data_id: number;
  timestamp: string;
  fall_now_probability: number;
  fall_soon_probability: number;
  fall_now_prediction: boolean;
  fall_soon_prediction: boolean;
  vital_check_performed: boolean;
  vital_check_result?: boolean;
  final_verdict?: boolean;
  confidence_score?: number;
}

// Alert Types
export interface Alert {
  id: number;
  user_id: number;
  prediction_id?: number;
  timestamp: string;
  alert_type: 'fall' | 'vital_abnormal' | 'device_offline' | 'heart_rate' | 'blood_pressure' | 'temperature' | 'battery';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  status: 'pending' | 'sent' | 'acknowledged' | 'resolved' | 'active' | 'failed' | 'cancelled';
  sent_to?: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
  resolved_at?: string;
}

// App State Types
export interface AppState {
  user: User | null;
  device: Device | null;
  isConnected: boolean;
  lastFallDetection: string | null;
  unreadAlerts: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// Device Ingest Payload (ESP32 / BLE)
export interface DeviceIngestPayload {
  device_id: string;
  user_id?: number;
  timestamp?: string;
  motion?: {
    acc_x: number;
    acc_y: number;
    acc_z: number;
    gyro_x: number;
    gyro_y: number;
    gyro_z: number;
    temperature?: number;
  };
  vitals?: {
    heart_rate?: number;
    blood_pressure_systolic?: number;
    blood_pressure_diastolic?: number;
    oxygen_saturation?: number;
    body_temperature?: number;
    respiration_rate?: number;
  };
  battery_level?: number;
  firmware_version?: string;
}

// Caregiver / Monitoring Types
export interface CareLink {
  id: number;
  caregiver_id: number;
  patient_id: number;
  relationship?: string;
  is_active: boolean;
  created_at: string;
  patient?: User;
}

// Chat Types
export interface ChatMessage {
  id: string;
  text: string;
  senderId: number;
  senderName?: string;
  createdAt: string;
}
