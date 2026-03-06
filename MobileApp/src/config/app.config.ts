import Constants from 'expo-constants';

const extra =
  // SDK 49+ uses expoConfig; older uses manifest
  (Constants.expoConfig?.extra as Record<string, any> | undefined) ||
  (Constants.manifest?.extra as Record<string, any> | undefined) ||
  {};

const rawApiUrl =
  extra.apiUrl ||
  process.env.EXPO_PUBLIC_API_URL ||
  process.env.API_URL ||
  'http://192.168.1.148:8000';

const normalizedApiUrl = rawApiUrl.replace(/\/$/, '');
const baseUrl = normalizedApiUrl.endsWith('/api/v1')
  ? normalizedApiUrl
  : `${normalizedApiUrl}/api/v1`;

export const API_CONFIG = {
  BASE_URL: baseUrl,
  TIMEOUT: parseInt(process.env.API_TIMEOUT || '15000'),
  RETRY_ATTEMPTS: 3,
  VERSION: '1.0.0',

  ENDPOINTS: {
    AUTH: {
      LOGIN: '/auth/login',
      REGISTER: '/auth/register',
      LOGOUT: '/auth/logout',
      REFRESH: '/auth/refresh',
      FORGOT_PASSWORD: '/auth/forgot-password',
    },
    USERS: {
      PROFILE: '/users/profile',
      UPDATE: '/users/update',
      ALERTS: '/users/alerts',
    },
    DEVICES: {
      CONNECT: '/devices/connect',
      STATUS: '/devices/status',
      DATA: '/devices/data',
    },
    EMERGENCY: {
      CONTACTS: '/emergency/contacts',
      SETTINGS: '/emergency/settings',
      TRIGGER: '/emergency/trigger',
    },
  },
};
