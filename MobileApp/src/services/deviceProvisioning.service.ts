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

  async connect(deviceId: string): Promise<BleDevice> {
    const device = await bluetoothService.connect(deviceId);
    this.device = device;
    return device;
  }

  async readDeviceInfo(deviceId: string): Promise<DeviceProvisioningDeviceInfo | null> {
    const device = this.device?.id === deviceId ? this.device : await this.connect(deviceId);
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
    const device = this.device?.id === deviceId ? this.device : await this.connect(deviceId);
    const encoded = encodeBase64(JSON.stringify(payload));

    await device.writeCharacteristicWithResponseForService(
      BLE_CONFIG.PROVISIONING_SERVICE_UUID,
      BLE_CONFIG.PROVISIONING_CHARACTERISTIC_UUID,
      encoded
    );
  }

  async monitorProvisioningStatus(
    deviceId: string,
    onStatus: (status: DeviceProvisioningStatus) => void
  ): Promise<void> {
    const device = this.device?.id === deviceId ? this.device : await this.connect(deviceId);

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
