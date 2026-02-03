// src/store/slices/alertSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Alert } from '../../types';

interface AlertState {
  alerts: Alert[];
  unreadCount: number;
  criticalAlerts: Alert[];
  isLoading: boolean;
  error: string | null;
}

const initialState: AlertState = {
  alerts: [],
  unreadCount: 0,
  criticalAlerts: [],
  isLoading: false,
  error: null,
};

const alertSlice = createSlice({
  name: 'alerts',
  initialState,
  reducers: {
    addAlert: (state, action: PayloadAction<Alert>) => {
      state.alerts.unshift(action.payload);
      
      if (action.payload.severity === 'critical') {
        state.criticalAlerts.unshift(action.payload);
      }
      
      if (action.payload.status === 'pending') {
        state.unreadCount += 1;
      }
    },
    acknowledgeAlert: (state, action: PayloadAction<number>) => {
      const alertIndex = state.alerts.findIndex(a => a.id === action.payload);
      if (alertIndex !== -1) {
        state.alerts[alertIndex].status = 'acknowledged';
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      }
    },
    resolveAlert: (state, action: PayloadAction<number>) => {
      const alertIndex = state.alerts.findIndex(a => a.id === action.payload);
      if (alertIndex !== -1) {
        state.alerts[alertIndex].status = 'resolved';
      }
    },
    clearAlerts: (state) => {
      state.alerts = [];
      state.criticalAlerts = [];
      state.unreadCount = 0;
    },
    markAllAsRead: (state) => {
      state.alerts.forEach(alert => {
        if (alert.status === 'pending') {
          alert.status = 'acknowledged';
        }
      });
      state.unreadCount = 0;
    },
    setAlerts: (state, action: PayloadAction<Alert[]>) => {
      state.alerts = action.payload;
      state.criticalAlerts = action.payload.filter(a => a.severity === 'critical');
      state.unreadCount = action.payload.filter(a => a.status === 'pending').length;
    },
  },
});

export const {
  addAlert,
  acknowledgeAlert,
  resolveAlert,
  clearAlerts,
  markAllAsRead,
  setAlerts,
} = alertSlice.actions;

export default alertSlice.reducer;