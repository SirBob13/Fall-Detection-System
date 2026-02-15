import { apiService } from './api';
import { storageService } from './storage';
import { authService } from './auth.service';
import { bluetoothService } from './bluetooth.service';
import { bleGatewayService } from './bleGateway.service';
import { Device } from '../types';

class DeviceService {
  private isMacAddress(deviceId: string): boolean {
    return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(deviceId);
  }

  async connectDeviceToUser(params: {
    userId: number;
    deviceId: string;
    connectBle?: boolean;
    startGateway?: boolean;
  }): Promise<Device | null> {
    const { userId, deviceId, connectBle = true, startGateway = true } = params;

    if (!userId || !deviceId) return null;

    if (connectBle) {
      try {
        await bluetoothService.requestPermissions();
        if (startGateway) {
          await bleGatewayService.start(deviceId, userId);
        } else {
          await bluetoothService.connect(deviceId);
        }
      } catch (error) {
        console.warn('BLE connect failed, continuing:', error);
      }
    }

    const response = await apiService.connectDevice({
      user_id: userId,
      device_id: deviceId,
      mac_address: this.isMacAddress(deviceId) ? deviceId : undefined,
    });

    if (response.success && response.data) {
      await storageService.saveDevice(response.data);
      return response.data;
    }

    return null;
  }

  async disconnectDevice(deviceId: string): Promise<Device | null> {
    if (!deviceId) return null;

    const response = await apiService.disconnectDevice(deviceId);
    if (response.success && response.data) {
      await storageService.saveDevice(response.data);
      await bleGatewayService.stop();
      return response.data;
    }

    return null;
  }

  async refreshUserDevice(userId: number): Promise<Device | null> {
    if (!userId) return null;

    const response = await apiService.getUserDevice(userId);
    if (response.success && response.data) {
      await storageService.saveDevice(response.data);
      return response.data;
    }

    return null;
  }

  async autoConnectIfEnabled(): Promise<void> {
    try {
      const settings = await storageService.getSettings();
      if (settings && settings.autoConnect === false) {
        return;
      }

      const sessionUser = await authService.getCurrentUser();
      const userId = Number(sessionUser?.id || 0);
      if (!userId) return;

      let device = await storageService.getDevice();
      if (!device) {
        device = await this.refreshUserDevice(userId);
      }

      if (!device) return;
      if (device.is_connected) return;

      await this.connectDeviceToUser({
        userId,
        deviceId: device.device_id,
        connectBle: true,
        startGateway: true,
      });
    } catch (error) {
      console.warn('Auto-connect failed:', error);
    }
  }
}

export const deviceService = new DeviceService();
