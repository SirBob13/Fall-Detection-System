export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string; // 'family', 'friend', 'doctor', 'neighbor'
  priority: number; // 1-3 (1 = عالي)
  is_active: boolean;
}

export interface EmergencyMessage {
  id: string;
  type: 'fall' | 'manual' | 'vital_abnormal';
  timestamp: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
  message: string;
  sent_to: string[];
  status: 'pending' | 'sent' | 'failed';
}

export interface EmergencyResponse {
  id: string;
  contact_id: string;
  response_type: 'answered' | 'missed' | 'replied';
  response_time: number; // ثواني
  notes?: string;
}


export interface EmergencySettings {
  auto_call_emergency: boolean;
  send_sms: boolean;
  send_location: boolean;
  call_after_fall: boolean;
  sos_countdown: number;
  max_retries: number;
}

export interface SystemStats {
  total_emergencies: number;
  successful: number;
  failed: number;
  last_emergency: string;
  average_response_time: number;
}