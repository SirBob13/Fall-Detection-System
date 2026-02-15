import Constants, { ExecutionEnvironment } from 'expo-constants';
import { PermissionsAndroid, Platform } from 'react-native';
import type { Device as BleDevice } from 'react-native-ble-plx';

export interface ScannedDevice {
  id: string;
  name: string;
  rssi?: number | null;
}

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const isBluetoothSupported = () => !isExpoGo;

class BluetoothService {
  private manager: any | null = null;
  private State: any | null = null;
  private isScanning = false;

  private async ensureBleManager(): Promise<boolean> {
    if (isExpoGo) {
      return false;
    }

    if (this.manager && this.State) {
      return true;
    }

    const ble = await import('react-native-ble-plx');
    this.manager = new ble.BleManager();
    this.State = ble.State;
    return true;
  }

  async requestPermissions(): Promise<boolean> {
    if (isExpoGo) return false;
    if (Platform.OS !== 'android') return true;

    try {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];

      const results = await PermissionsAndroid.requestMultiple(permissions);
      return permissions.every(permission => results[permission] === PermissionsAndroid.RESULTS.GRANTED);
    } catch (error) {
      console.warn('Bluetooth permission error:', error);
      return false;
    }
  }

  async ensurePoweredOn(): Promise<boolean> {
    const ready = await this.ensureBleManager();
    if (!ready || !this.manager || !this.State) return false;

    const state = await this.manager.state();
    if (state === this.State.PoweredOn) return true;

    return new Promise(resolve => {
      const subscription = this.manager.onStateChange((nextState) => {
        if (nextState === this.State.PoweredOn) {
          subscription.remove();
          resolve(true);
        }
      }, true);

      setTimeout(() => {
        subscription.remove();
        resolve(false);
      }, 5000);
    });
  }

  async scan(timeoutMs: number = 8000): Promise<ScannedDevice[]> {
    const ready = await this.ensureBleManager();
    if (!ready || !this.manager) {
      throw new Error('Bluetooth requires a development build (not Expo Go).');
    }

    if (this.isScanning) return [];

    const hasPermissions = await this.requestPermissions();
    if (!hasPermissions) {
      throw new Error('Bluetooth permissions not granted');
    }

    const isOn = await this.ensurePoweredOn();
    if (!isOn) {
      throw new Error('Bluetooth is turned off');
    }

    this.isScanning = true;
    const results: Record<string, ScannedDevice> = {};

    return new Promise((resolve) => {
      this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (error) {
          console.warn('BLE scan error:', error.message);
          return;
        }

        if (!device) return;
        const name = device.name || device.localName || 'Unknown device';

        if (!results[device.id]) {
          results[device.id] = {
            id: device.id,
            name,
            rssi: device.rssi,
          };
        }
      });

      setTimeout(() => {
        this.manager.stopDeviceScan();
        this.isScanning = false;
        resolve(Object.values(results));
      }, timeoutMs);
    });
  }

  async connect(deviceId: string): Promise<BleDevice> {
    const ready = await this.ensureBleManager();
    if (!ready || !this.manager) {
      throw new Error('Bluetooth requires a development build (not Expo Go).');
    }

    const device = await this.manager.connectToDevice(deviceId, { autoConnect: true });
    await device.discoverAllServicesAndCharacteristics();
    return device;
  }

  stopScan(): void {
    if (this.isScanning) {
      this.manager?.stopDeviceScan();
      this.isScanning = false;
    }
  }
}

export const bluetoothService = new BluetoothService();
