export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  relationship: string; // 'family', 'friend', 'doctor', 'neighbor'
  priority: number; // 1-3 (1 = عالي)
  is_active: boolean;
  notification_enabled?: boolean;
  can_receive_location?: boolean;
}

export interface EmergencyMessage {
  id: string;
  type: 'fall' | 'manual' | 'vital_abnormal' | 'inactivity';
  source_alert_id?: number;
  source_event_key?: string;
  timestamp: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  } | null;
  message: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  sent_to: string[];
  status: 'pending' | 'sent' | 'failed' | 'test';
}

export interface EmergencyResponse {
  contact_id: string;
  contact_name?: string;
  response_type:
    | 'pending'
    | 'answered'
    | 'missed'
    | 'replied'
    | 'sms_sent'
    | 'sms_failed'
    | 'sms_and_call_sent'
    | 'call_initiated'
    | 'failed'
    | 'test_sent';
  response_time?: number; // ثواني
  timestamp?: string;
  attempts?: number;
  error?: string;
  notes?: string;
}

export interface EmergencyHistoryItem extends EmergencyMessage {
  responses: EmergencyResponse[];
  read: boolean;
}

export interface EmergencySettings {
  auto_call_emergency: boolean;
  send_sms: boolean;
  send_location: boolean;
  call_after_fall: boolean;
  sos_countdown: number;
  max_retries: number;
  enable_vibration?: boolean;
  enable_sound?: boolean;
  notification_preview?: 'show_all' | 'minimal' | 'hidden';
  emergency_numbers?: Record<string, string>;
}

export interface SystemStats {
  total_emergencies: number;
  successful: number;
  failed: number;
  last_emergency: string;
  average_response_time: number;
}
