import { Device } from '../types';

const DEVICE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export type UserPresenceStatus = 'active' | 'login' | 'logout';

export const isDeviceOnline = (device?: Device | null): boolean => {
  if (!device) return false;
  if (typeof device.is_online === 'boolean') {
    return device.is_online;
  }
  if (!device.is_connected || !device.last_seen) {
    return false;
  }

  const lastSeen = new Date(device.last_seen).getTime();
  if (Number.isNaN(lastSeen)) {
    return false;
  }

  return Date.now() - lastSeen <= DEVICE_ONLINE_WINDOW_MS;
};

export const getDeviceConnectionState = (device?: Device | null): string => {
  if (!device) return 'offline';
  if (device.connection_state) return device.connection_state;
  return isDeviceOnline(device) ? 'connected' : 'disconnected';
};

export const getUserPresenceStatus = (
  isLoggedIn: boolean,
  devices: Device[] = []
): UserPresenceStatus => {
  if (!isLoggedIn) return 'logout';
  return devices.some((device) => isDeviceOnline(device)) ? 'active' : 'login';
};
