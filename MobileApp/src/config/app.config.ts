export const API_CONFIG = {
  BASE_URL: process.env.API_URL || 'http://192.168.1.148:8000/api/v1',
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
