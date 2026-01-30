
export const API_CONFIG = {
  BASE_URL: 'http://192.168.1.4:8000/api/v1',
  TIMEOUT: 15000,
  RETRY_ATTEMPTS: 3,
};

export const COLORS = {
  primary: '#2196F3',
  secondary: '#4CAF50',
  danger: '#F44336',
  warning: '#FF9800',
  success: '#4CAF50',
  info: '#2196F3',
  dark: '#333333',
  light: '#F5F5F5',
  white: '#FFFFFF',
  black: '#000000',
  gray: '#9E9E9E',
  lightGray: '#E0E0E0',
};

export const FALL_THRESHOLDS = {
  ACCELERATION: 2.5,
  GYROSCOPE: 200,
  CONFIDENCE: 0.7,
};

export const STORAGE_KEYS = {
  USER_DATA: '@FallDetection:user',
  DEVICE_DATA: '@FallDetection:device',
  SETTINGS: '@FallDetection:settings',
  ALERTS_HISTORY: '@FallDetection:alerts',
  FALL_HISTORY: '@FallDetection:falls',
};
