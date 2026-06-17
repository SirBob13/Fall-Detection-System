import { Device } from '../types';
import { parseApiDate } from './helpers';

const DEVICE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export type UserPresenceStatus = 'active' | 'login' | 'logout';
export type DeviceOperationalStatus = 'active' | 'warming_up' | 'connected_no_data' | 'disconnected' | 'offline' | 'archived';

export const isDeviceOnline = (device?: Device | null): boolean => {
  if (!device) return false;
  if (typeof device.is_online === 'boolean') {
    return device.is_online;
  }
  if (!device.is_connected || !device.last_seen) {
    return false;
  }

  const lastSeen = parseApiDate(device.last_seen)?.getTime();
  if (!lastSeen) {
    return false;
  }

  return Date.now() - lastSeen <= DEVICE_ONLINE_WINDOW_MS;
};

export const getDeviceConnectionState = (device?: Device | null): string => {
  if (!device) return 'offline';
  if (device.connection_state) return device.connection_state;
  return isDeviceOnline(device) ? 'connected' : 'disconnected';
};

export const getDeviceOperationalStatus = (device?: Device | null): DeviceOperationalStatus => {
  if (!device) return 'offline';
  if (device.device_status) return device.device_status;

  const connectionState = getDeviceConnectionState(device);
  if (connectionState === 'connected') {
    if (device.ai_warmup) return 'warming_up';
    return device.data_state === 'streaming' ? 'active' : 'connected_no_data';
  }
  if (connectionState === 'archived') return 'archived';
  if (connectionState === 'disconnected') return 'disconnected';
  return 'offline';
};

export const getDeviceStatusLabel = (device?: Device | null): string => {
  if (!device) return 'Offline';
  if (device.device_status_label) return device.device_status_label;

  const status = getDeviceOperationalStatus(device);
  switch (status) {
    case 'active':
      return 'Active';
    case 'warming_up':
      return 'Warming up';
    case 'connected_no_data':
      return 'Connected, no data';
    case 'disconnected':
      return 'Disconnected';
    case 'archived':
      return 'Archived';
    default:
      return 'Offline';
  }
};

export const getUserPresenceStatus = (
  isLoggedIn: boolean,
  devices: Device[] = []
): UserPresenceStatus => {
  if (!isLoggedIn) return 'logout';
  return devices.some((device) => isDeviceOnline(device)) ? 'active' : 'login';
};
