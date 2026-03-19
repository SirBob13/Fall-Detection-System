import type { Device as BleDevice } from 'react-native-ble-plx';
import { bluetoothService } from './bluetooth.service';
import { offlineQueueService } from './offlineQueue.service';
import { emergencyService } from './emergency.service';
import { networkService } from './network.service';
import { storageService } from './storage';
import { BLE_CONFIG } from '../utils/constants';
import { DeviceIngestPayload } from '../types';

const decodeBase64 = (value: string): string | null => {
  try {
    if (typeof atob === 'function') {
      return atob(value);
    }
  } catch (error) {
    // ignore
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Buffer } = require('buffer');
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch (error) {
    return null;
  }
};

class BleGatewayService {
  private device: BleDevice | null = null;
  private subscription: any = null;
  private lastOfflineSosAt: number = 0;
  private readonly offlineSosCooldownMs = 2 * 60 * 1000; // 2 minutes
  private readonly fallbackAccThreshold = 2.5; // g-force threshold

  async start(deviceId: string, userId?: number): Promise<void> {
    if (!BLE_CONFIG.SERVICE_UUID || !BLE_CONFIG.CHARACTERISTIC_UUID) {
      console.warn('BLE UUIDs not configured. Set EXPO_PUBLIC_BLE_SERVICE_UUID and EXPO_PUBLIC_BLE_CHARACTERISTIC_UUID.');
      return;
    }

    const device = await bluetoothService.connect(deviceId);
    this.device = device;

    this.subscription = device.monitorCharacteristicForService(
      BLE_CONFIG.SERVICE_UUID,
      BLE_CONFIG.CHARACTERISTIC_UUID,
      async (error, characteristic) => {
        if (error) {
          console.warn('BLE monitor error:', error.message);
          return;
        }

        const raw = characteristic?.value;
        if (!raw) return;

        const decoded = decodeBase64(raw);
        if (!decoded) return;

        try {
          const parsed = JSON.parse(decoded);
          const payload: DeviceIngestPayload = {
            device_id: deviceId,
            user_id: userId,
            timestamp: parsed.timestamp || new Date().toISOString(),
            motion: parsed.motion,
            vitals: parsed.vitals,
            battery_level: parsed.battery_level,
            firmware_version: parsed.firmware_version,
          };

          // Offline SOS fallback (when both device and phone have no internet)
          try {
            const settings = await storageService.getSettings();
            const autoSosEnabled = settings?.automaticSOS ?? true;
            const status = networkService.getCurrentStatus();
            const isOffline = !(status.isConnected && status.isInternetReachable);

            if (autoSosEnabled && isOffline) {
              const now = Date.now();
              if (now - this.lastOfflineSosAt > this.offlineSosCooldownMs) {
                const motion = parsed.motion || payload.motion || {};
                const accX = Number(motion.acc_x ?? 0);
                const accY = Number(motion.acc_y ?? 0);
                const accZ = Number(motion.acc_z ?? 0);
                const accMag = Math.sqrt(accX * accX + accY * accY + accZ * accZ);

                const fallFlag =
                  parsed?.fall_detected === true ||
                  parsed?.sos === true ||
                  parsed?.alert?.type === 'fall' ||
                  accMag >= this.fallbackAccThreshold;

                if (fallFlag) {
                  this.lastOfflineSosAt = now;
                  emergencyService
                    .triggerEmergency('fall', {
                      source: 'ble_offline',
                      device_id: deviceId,
                      acc_mag: accMag,
                      timestamp: payload.timestamp,
                    })
                    .catch(() => undefined);
                }
              }
            }
          } catch (offlineError) {
            console.warn('Offline SOS fallback check failed:', offlineError);
          }

          await offlineQueueService.enqueue(payload);
        } catch (parseError) {
          console.warn('BLE payload parse failed:', parseError);
        }
      }
    );
  }

  async stop(): Promise<void> {
    try {
      if (this.subscription) {
        this.subscription.remove();
        this.subscription = null;
      }
      if (this.device) {
        await this.device.cancelConnection();
        this.device = null;
      }
    } catch (error) {
      console.warn('BLE gateway stop error:', error);
    }
  }
}

export const bleGatewayService = new BleGatewayService();
