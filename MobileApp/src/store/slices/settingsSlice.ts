// src/store/slices/settingsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SettingsState {
  notifications: boolean;
  autoConnect: boolean;
  fallDetection: boolean;
  vitalMonitoring: boolean;
  language: 'ar' | 'en';
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
  autoConnect: true,
  fallDetection: true,
  vitalMonitoring: true,
  language: 'ar',
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
      (state as any)[action.payload.key] = action.payload.value;
    },
    updateEmergencySetting: (
      state,
      action: PayloadAction<{ key: keyof SettingsState['emergencySettings']; value: any }>
    ) => {
      (state.emergencySettings as any)[action.payload.key] = action.payload.value;
    },
    changeLanguage: (state, action: PayloadAction<'ar' | 'en'>) => {
      state.language = action.payload;
    },
    resetSettings: () => initialState,
  },
});

export const {
  updateSetting,
  updateEmergencySetting,
  changeLanguage,
  resetSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;
