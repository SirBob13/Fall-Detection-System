import type { Device as BleDevice } from 'react-native-ble-plx';
import { bluetoothService } from './bluetooth.service';
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

class DeviceProvisioningService {
  private device: BleDevice | null = null;
  private statusSubscription: { remove?: () => void } | null = null;

  private async settleDevice(device: BleDevice, delayMs: number = 1000): Promise<void> {
    // Some ESP32 firmware builds need a small pause after discovery before reads/writes stabilize.
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private async writeProvisioningPayloadWithFallback(
    device: BleDevice,
    encodedPayload: string
  ): Promise<void> {
    try {
      await device.writeCharacteristicWithResponseForService(
        BLE_CONFIG.PROVISIONING_SERVICE_UUID,
        BLE_CONFIG.PROVISIONING_CHARACTERISTIC_UUID,
        encodedPayload
      );
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

        await characteristic.writeWithResponse(encodedPayload);
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

    try {
      return JSON.parse(raw) as DeviceProvisioningDeviceInfo;
    } catch (error) {
      console.warn('Provisioning device info parse failed:', error);
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
    const rawPayload = JSON.stringify(payload);
    const encoded = encodeBase64(rawPayload);

    console.log('📤 [BLE Provisioning] Writing payload to bracelet...', {
      deviceId,
      rawBytes: rawPayload.length,
      base64Bytes: encoded.length,
    });

    try {
      await this.settleDevice(device, 1200);
      await this.writeProvisioningPayloadWithFallback(device, encoded);
      console.log('✅ [BLE Provisioning] Payload written successfully');
    } catch (error) {
      console.error('❌ [BLE Provisioning] Payload write failed:', error);
      throw error;
    }
  }

  async monitorProvisioningStatus(
    deviceId: string,
    onStatus: (status: DeviceProvisioningStatus) => void
  ): Promise<void> {
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
  }

  async provisionDevice(params: {
    deviceId: string;
    ssid: string;
    password: string;
  }): Promise<{
    deviceInfo: DeviceProvisioningDeviceInfo | null;
    pairing: DevicePairingTokenResponse;
    payload: DeviceProvisioningPayload;
  }> {
    const deviceInfo = await this.readDeviceInfo(params.deviceId);
    const pairing = await this.requestPairingToken(
      deviceInfo?.device_id || params.deviceId,
      deviceInfo?.firmware_version,
      deviceInfo?.device_type
    );

    const payload: DeviceProvisioningPayload = {
      device_id: pairing.device_id,
      pairing_token: pairing.pairing_token,
      wifi: {
        ssid: params.ssid,
        password: params.password,
      },
      mqtt: pairing.mqtt,
      api: pairing.api,
    };

    await this.writeProvisioningPayload(params.deviceId, payload);

    return {
      deviceInfo,
      pairing,
      payload,
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
