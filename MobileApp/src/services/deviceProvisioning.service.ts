import type { Device as BleDevice } from 'react-native-ble-plx';
import { bluetoothService, describeBleError } from './bluetooth.service';
import { apiService } from './api';
import { BLE_CONFIG } from '../utils/constants';
import type {
  DevicePairingTokenResponse,
  DeviceProvisioningDeviceInfo,
  DeviceProvisioningPayload,
  DeviceProvisioningStatus,
} from '../types';

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

const encodeBase64 = (value: string): string => {
  try {
    if (typeof btoa === 'function') {
      return btoa(value);
    }
  } catch (error) {
    // ignore
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Buffer } = require('buffer');
  return Buffer.from(value, 'utf-8').toString('base64');
};

const buildProvisioningWritePayload = (payload: DeviceProvisioningPayload): string => {
  return JSON.stringify({
    d: payload.device_id,
    u: payload.user_id,
    pt: payload.pairing_token,
    w: {
      s: payload.wifi.ssid,
      p: payload.wifi.password,
    },
    m: {
      h: payload.mqtt.host,
      o: payload.mqtt.port,
      t: payload.mqtt.topic,
    },
    a: {
      b: payload.api.base_url,
    },
  });
};

const PROVISIONING_CHUNK_DATA_CHARS = 120;
const PROVISIONING_CHUNK_DELAY_MS = 25;

type ProvisioningBleMessage = {
  payload: string;
  requiresResponse: boolean;
};

const buildChunkedProvisioningMessages = (rawPayload: string): ProvisioningBleMessage[] => {
  const encoded = encodeBase64(rawPayload);
  const total = Math.ceil(encoded.length / PROVISIONING_CHUNK_DATA_CHARS);
  const transferId = `prov-${Date.now()}`;
  const messages: ProvisioningBleMessage[] = [];

  for (let index = 0; index < total; index += 1) {
    const start = index * PROVISIONING_CHUNK_DATA_CHARS;
    const data = encoded.slice(start, start + PROVISIONING_CHUNK_DATA_CHARS);
    messages.push({
      payload: JSON.stringify({
        type: 'chunk',
        id: transferId,
        index,
        total,
        data,
      }),
      requiresResponse: false,
    });
  }

  messages.push({
    payload: JSON.stringify({
      type: 'commit',
      id: transferId,
    }),
    requiresResponse: true,
  });

  return messages;
};

class DeviceProvisioningService {
  private device: BleDevice | null = null;
  private statusSubscription: { remove?: () => void } | null = null;
  private readonly provisioningTimeoutMs = 40000;

  private async settleDevice(device: BleDevice, delayMs: number = 1000): Promise<void> {
    // Some ESP32 firmware builds need a small pause after discovery before reads/writes stabilize.
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private async writeProvisioningPayloadWithFallback(
    device: BleDevice,
    rawPayload: string,
    requiresResponse: boolean
  ): Promise<void> {
    const encodedPayload = encodeBase64(rawPayload);

    try {
      if (requiresResponse) {
        await device.writeCharacteristicWithResponseForService(
          BLE_CONFIG.PROVISIONING_SERVICE_UUID,
          BLE_CONFIG.PROVISIONING_CHARACTERISTIC_UUID,
          encodedPayload
        );
      } else {
        await device.writeCharacteristicWithoutResponseForService(
          BLE_CONFIG.PROVISIONING_SERVICE_UUID,
          BLE_CONFIG.PROVISIONING_CHARACTERISTIC_UUID,
          encodedPayload
        );
      }
      return;
    } catch (primaryError) {
      console.warn('⚠️ [BLE Provisioning] Direct service write failed, trying characteristic fallback:', primaryError);
    }

    const services = await device.services();
    for (const service of services) {
      const characteristics = await service.characteristics();
      for (const characteristic of characteristics) {
        const matchesCharacteristic =
          characteristic.uuid?.toLowerCase() === BLE_CONFIG.PROVISIONING_CHARACTERISTIC_UUID.toLowerCase();

        if (!matchesCharacteristic) continue;

        console.log('🔥 [BLE Provisioning] Matched provisioning characteristic via enumeration:', {
          serviceUuid: service.uuid,
          characteristicUuid: characteristic.uuid,
        });

        if (requiresResponse) {
          await characteristic.writeWithResponse(encodedPayload);
        } else {
          await characteristic.writeWithoutResponse(encodedPayload);
        }
        return;
      }
    }

    throw new Error('Provisioning characteristic not found on connected device');
  }

  private async ensureReadyDevice(deviceId: string): Promise<BleDevice> {
    return this.device?.id === deviceId ? this.device : this.connect(deviceId);
  }

  async connect(deviceId: string): Promise<BleDevice> {
    const device = await bluetoothService.connect(deviceId);
    this.device = device;
    return device;
  }

  async readDeviceInfo(deviceId: string): Promise<DeviceProvisioningDeviceInfo | null> {
    try {
      const device = await this.ensureReadyDevice(deviceId);
      await this.settleDevice(device, 600);
      const characteristic = await device.readCharacteristicForService(
        BLE_CONFIG.PROVISIONING_SERVICE_UUID,
        BLE_CONFIG.DEVICE_INFO_CHARACTERISTIC_UUID
      );

      const raw = characteristic?.value ? decodeBase64(characteristic.value) : null;
      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as DeviceProvisioningDeviceInfo;
    } catch (error) {
      console.warn('Provisioning device info read failed:', error);
      return null;
    }
  }

  async requestPairingToken(deviceId: string, firmwareVersion?: string, deviceType?: string) {
    const response = await apiService.requestDevicePairingToken({
      device_id: deviceId,
      firmware_version: firmwareVersion,
      device_type: deviceType,
    });

    if (!response.success || !response.data) {
      throw new Error(response.message || response.error || 'Failed to request pairing token');
    }

    return response.data;
  }

  async writeProvisioningPayload(
    deviceId: string,
    payload: DeviceProvisioningPayload
  ): Promise<void> {
    const device = await this.ensureReadyDevice(deviceId);
    const rawPayload = buildProvisioningWritePayload(payload);
    const messages = buildChunkedProvisioningMessages(rawPayload);

    console.log('📤 [BLE Provisioning] Writing payload to bracelet...', {
      deviceId,
      rawBytes: rawPayload.length,
      chunked: true,
      chunkCount: messages.length - 1,
    });

    try {
      await this.settleDevice(device, 1200);
      for (const [index, message] of messages.entries()) {
        await this.writeProvisioningPayloadWithFallback(
          device,
          message.payload,
          message.requiresResponse
        );
        if (index < messages.length - 1) {
          await this.settleDevice(device, PROVISIONING_CHUNK_DELAY_MS);
        }
      }
      console.log('✅ [BLE Provisioning] Chunked payload written successfully');
    } catch (error) {
      console.error('❌ [BLE Provisioning] Payload write failed:', error);
      throw new Error(
        describeBleError(
          error,
          'Connected to the bracelet, but sending Wi-Fi setup data over Bluetooth failed.'
        )
      );
    }
  }

  async monitorProvisioningStatus(
    deviceId: string,
    onStatus: (status: DeviceProvisioningStatus) => void
  ): Promise<() => void> {
    const device = await this.ensureReadyDevice(deviceId);

    this.statusSubscription?.remove?.();
    this.statusSubscription = device.monitorCharacteristicForService(
      BLE_CONFIG.PROVISIONING_SERVICE_UUID,
      BLE_CONFIG.STATUS_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error) {
          console.warn('Provisioning status monitor error:', error.message);
          return;
        }

        const raw = characteristic?.value ? decodeBase64(characteristic.value) : null;
        if (!raw) return;

        try {
          const status = JSON.parse(raw) as DeviceProvisioningStatus;
          onStatus(status);
        } catch (parseError) {
          console.warn('Provisioning status parse failed:', parseError);
        }
      }
    );

    return () => {
      this.statusSubscription?.remove?.();
      this.statusSubscription = null;
    };
  }

  private async waitForProvisioningCompletion(
    deviceId: string,
    onStatus?: (status: DeviceProvisioningStatus) => void
  ): Promise<DeviceProvisioningStatus> {
    return new Promise<DeviceProvisioningStatus>(async (resolve, reject) => {
      let settled = false;
      let cleanup: () => void = () => undefined;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const timeout = setTimeout(() => {
        finish(() => {
          reject(
            new Error(
              'Timed out while waiting for the bracelet to finish Wi-Fi/MQTT setup. Check the bracelet serial monitor.'
            )
          );
        });
      }, this.provisioningTimeoutMs);

      try {
        cleanup = await this.monitorProvisioningStatus(deviceId, (status) => {
          onStatus?.(status);

          const isFailure =
            status.success === false ||
            status.stage === 'wifi_failed' ||
            status.stage === 'mqtt_failed';
          const isSuccess =
            status.success === true &&
            (status.stage === 'mqtt_connected' || status.stage === 'streaming');

          if (isFailure) {
            clearTimeout(timeout);
            finish(() => {
              reject(new Error(status.message || `Provisioning failed at stage: ${status.stage}`));
            });
            return;
          }

          if (isSuccess) {
            clearTimeout(timeout);
            finish(() => resolve(status));
          }
        });
      } catch (error) {
        clearTimeout(timeout);
        finish(() => reject(error instanceof Error ? error : new Error('Failed to monitor provisioning status')));
      }
    });
  }

  async provisionDevice(params: {
    deviceId: string;
    ssid: string;
    password: string;
    onStatus?: (status: DeviceProvisioningStatus) => void;
  }): Promise<{
    deviceInfo: DeviceProvisioningDeviceInfo | null;
    pairing: DevicePairingTokenResponse;
    payload: DeviceProvisioningPayload;
    finalStatus: DeviceProvisioningStatus;
  }> {
    // Request secure pairing info first so we do not hold a BLE connection open if the user session expired.
    const deviceInfo: DeviceProvisioningDeviceInfo | null = null;
    const pairing = await this.requestPairingToken(params.deviceId);

    const payload: DeviceProvisioningPayload = {
      device_id: pairing.device_id,
      user_id: pairing.user_id,
      pairing_token: pairing.pairing_token,
      wifi: {
        ssid: params.ssid,
        password: params.password,
      },
      mqtt: pairing.mqtt,
      api: pairing.api,
    };

    params.onStatus?.({
      device_id: pairing.device_id,
      stage: 'ready_for_provisioning',
      success: true,
      message: 'Connecting to the bracelet over Bluetooth...',
    });

    await this.connect(params.deviceId);
    await this.writeProvisioningPayload(params.deviceId, payload);

    let finalStatus: DeviceProvisioningStatus = {
      device_id: pairing.device_id,
      stage: 'provisioning_received',
      success: true,
      message: 'Provisioning data sent to the bracelet.',
    };

    params.onStatus?.(finalStatus);

    try {
      finalStatus = await this.waitForProvisioningCompletion(params.deviceId, params.onStatus);
    } catch (error) {
      console.warn('⚠️ [BLE Provisioning] Status monitoring failed after successful write, continuing:', error);
    }

    return {
      deviceInfo,
      pairing,
      payload,
      finalStatus,
    };
  }

  async disconnect(): Promise<void> {
    try {
      this.statusSubscription?.remove?.();
      this.statusSubscription = null;

      if (this.device) {
        await this.device.cancelConnection();
        this.device = null;
      }
    } catch (error) {
      console.warn('Provisioning disconnect failed:', error);
    }
  }
}

export const deviceProvisioningService = new DeviceProvisioningService();
