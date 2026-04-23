import Constants from 'expo-constants';

const CONFIG_BASE_URL =
  Constants.expoConfig?.extra?.apiUrl ||
  Constants.expoConfig?.extra?.apiBaseUrl ||
  '';

const PUBLIC_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  process.env.EXPO_PUBLIC_BASE_URL ||
  CONFIG_BASE_URL ||
  '';

const normalizeBaseUrl = (url: string) => {
  if (!url) return '';
  let trimmed = url.replace(/\/+$/, '');
  if (!/\/api\/v1$/.test(trimmed)) {
    trimmed = `${trimmed}/api/v1`;
  }
  return trimmed;
};

const DEFAULT_BASE_URL = 'https://fall-detection.ddns.net/api/v1';
const RAW_BASE_URL = PUBLIC_BASE_URL || DEFAULT_BASE_URL;

export const API_CONFIG = {
  BASE_URL: normalizeBaseUrl(RAW_BASE_URL),
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  VERSION: '1.0.0',
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
  MONITORED_USER: '@FallDetection:monitoredUser',
  DEVICE_QUEUE: '@FallDetection:deviceQueue',
};

/** Firmware advertises `FallDetectionBracelet`; broad BLE scans use this when OS service-UUID filtering misses devices. */
export const BLE_KNOWN_DEVICE_NAME_PATTERN = /fall|bracelet|detection|esp32/i;

export const BLE_SCAN_TIMEOUT_MS = 8000;

export const BLE_CONFIG = {
  SERVICE_UUID:
    process.env.EXPO_PUBLIC_BLE_SERVICE_UUID ||
    '7A100001-8C6A-4F6D-A55B-000000000001',
  CHARACTERISTIC_UUID:
    process.env.EXPO_PUBLIC_BLE_CHARACTERISTIC_UUID ||
    '7A100004-8C6A-4F6D-A55B-000000000001',
  // ESP Status char (repurpose for telemetry until dedicated data char added)
  PROVISIONING_SERVICE_UUID:
    process.env.EXPO_PUBLIC_BLE_PROVISIONING_SERVICE_UUID ||
    '7A100001-8C6A-4F6D-A55B-000000000001',
  DEVICE_INFO_CHARACTERISTIC_UUID:
    process.env.EXPO_PUBLIC_BLE_DEVICE_INFO_CHARACTERISTIC_UUID ||
    '7A100002-8C6A-4F6D-A55B-000000000001',
  PROVISIONING_CHARACTERISTIC_UUID:
    process.env.EXPO_PUBLIC_BLE_PROVISIONING_CHARACTERISTIC_UUID ||
    '7A100003-8C6A-4F6D-A55B-000000000001',
  STATUS_CHARACTERISTIC_UUID:
    process.env.EXPO_PUBLIC_BLE_STATUS_CHARACTERISTIC_UUID ||
    '7A100004-8C6A-4F6D-A55B-000000000001',
};
