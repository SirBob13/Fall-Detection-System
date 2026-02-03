// src/types/health.ts
export interface HealthMetrics {
  heartRate: {
    value: number;
    status: 'normal' | 'low' | 'high' | 'critical';
    timestamp: string;
  };
  bloodPressure: {
    systolic: number;
    diastolic: number;
    status: 'normal' | 'elevated' | 'high' | 'critical';
    timestamp: string;
  };
  oxygenSaturation: {
    value: number;
    status: 'normal' | 'low' | 'critical';
    timestamp: string;
  };
  activity: {
    steps: number;
    calories: number;
    distance: number;
    activeMinutes: number;
  };
}