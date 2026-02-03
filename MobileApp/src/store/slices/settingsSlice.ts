// src/store/slices/settingsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SettingsState {
  notifications: boolean;
  vibration: boolean;
  sound: boolean;
  autoConnect: boolean;
  fallDetection: boolean;
  vitalMonitoring: boolean;
  language: 'ar' | 'en';
  theme: 'light' | 'dark';
  emergencySettings: {
    autoCallEmergency: boolean;
    sendSMS: boolean;
    sendLocation: boolean;
    callAfterFall: boolean;
    sosCountdown: number;
    maxRetries: number;
  };
}

const initialState: SettingsState = {
  notifications: true,
  vibration: true,
  sound: true,
  autoConnect: true,
  fallDetection: true,
  vitalMonitoring: true,
  language: 'ar',
  theme: 'light',
  emergencySettings: {
    autoCallEmergency: true,
    sendSMS: true,
    sendLocation: true,
    callAfterFall: true,
    sosCountdown: 5,
    maxRetries: 3,
  },
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    updateSetting: (state, action: PayloadAction<{ key: keyof SettingsState; value: any }>) => {
      state[action.payload.key] = action.payload.value;
    },
    updateEmergencySetting: (
      state,
      action: PayloadAction<{ key: keyof SettingsState['emergencySettings']; value: any }>
    ) => {
      state.emergencySettings[action.payload.key] = action.payload.value;
    },
    changeLanguage: (state, action: PayloadAction<'ar' | 'en'>) => {
      state.language = action.payload;
    },
    toggleTheme: (state) => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
    },
    resetSettings: (state) => {
      return initialState;
    },
  },
});

export const {
  updateSetting,
  updateEmergencySetting,
  changeLanguage,
  toggleTheme,
  resetSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;