// src/store/slices/deviceSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Device } from '../../types';

interface DeviceState {
  currentDevice: Device | null;
  isConnected: boolean;
  batteryLevel: number;
  lastSeen: string | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: DeviceState = {
  currentDevice: null,
  isConnected: false,
  batteryLevel: 100,
  lastSeen: null,
  isLoading: false,
  error: null,
};

const deviceSlice = createSlice({
  name: 'device',
  initialState,
  reducers: {
    setDevice: (state, action: PayloadAction<Device>) => {
      state.currentDevice = action.payload;
      state.isConnected = action.payload.is_connected ?? false;
      state.batteryLevel = action.payload.battery_level ?? 0;
      state.lastSeen = action.payload.last_seen ?? null;
    },
    updateConnectionStatus: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload;
    },
    updateBatteryLevel: (state, action: PayloadAction<number>) => {
      state.batteryLevel = action.payload;
    },
    updateLastSeen: (state, action: PayloadAction<string>) => {
      state.lastSeen = action.payload;
    },
    disconnectDevice: (state) => {
      state.isConnected = false;
      state.batteryLevel = 0;
    },
  },
});

export const {
  setDevice,
  updateConnectionStatus,
  updateBatteryLevel,
  updateLastSeen,
  disconnectDevice,
} = deviceSlice.actions;

export default deviceSlice.reducer;
