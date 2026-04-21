import Constants, { ExecutionEnvironment } from 'expo-constants';
import { PermissionsAndroid, Platform } from 'react-native';
import type { BleError, Device as BleDevice, State } from 'react-native-ble-plx';
import { BLE_CONFIG, BLE_KNOWN_DEVICE_NAME_PATTERN } from '../utils/constants';

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

  private normalizeRssi(rssi?: number | null): number | null {
    if (typeof rssi !== 'number') return null;
    // Android occasionally reports 127 for "RSSI unavailable"; treat it as unknown.
    if (rssi >= 100) return null;
    return rssi;
  }

  isLikelyProvisioningDevice(device: Pick<ScannedDevice, 'name'>): boolean {
    return BLE_KNOWN_DEVICE_NAME_PATTERN.test(device.name || '');
  }

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
      console.log('🔐 [BLE] Requesting Android Bluetooth permissions...');
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];

      const results = await PermissionsAndroid.requestMultiple(permissions);
      console.log('🔐 [BLE] Permission results:', results);
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
    console.log('📡 [BLE] Current adapter state:', state);
    if (state === this.State.PoweredOn) return true;

    return new Promise(resolve => {
      const subscription = this.manager.onStateChange((nextState: State) => {
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

  async scan(timeoutMs: number = 8000, serviceUUIDs: string[] | null = null): Promise<ScannedDevice[]> {
    const ready = await this.ensureBleManager();
    if (!ready || !this.manager) {
      throw new Error('Bluetooth requires a development build (not Expo Go).');
    }

    if (this.isScanning) return [];

    console.log('🔍 [BLE] Starting scan...', { timeoutMs, serviceUUIDs });
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
      const normalizedUuids = Array.isArray(serviceUUIDs)
        ? serviceUUIDs.map(uuid => uuid?.trim()).filter(Boolean)
        : null;

      this.manager.startDeviceScan(
        normalizedUuids?.length ? normalizedUuids : null,
        {
          allowDuplicates: false,
          legacyScan: true,
          scanMode: 2,
        },
        (error: BleError | null, device: BleDevice | null) => {
        if (error) {
          console.warn('BLE scan error:', error.message);
          return;
        }

        if (!device) return;
        const name = device.name || device.localName || 'Unknown device';
        const rssi = this.normalizeRssi(device.rssi);
        console.log('📶 [BLE] Found device:', {
          id: device.id,
          name,
          localName: device.localName,
          rssi,
        });

          const existing = results[device.id];
          const nextName =
            !existing ||
            (existing.name === 'Unknown device' && name !== 'Unknown device') ||
            (this.isLikelyProvisioningDevice({ name }) && !this.isLikelyProvisioningDevice(existing))
              ? name
              : existing.name;

          const nextRssi =
            typeof rssi === 'number' &&
            (!existing || typeof existing.rssi !== 'number' || rssi > existing.rssi)
              ? rssi
              : existing?.rssi ?? null;

          results[device.id] = {
            id: device.id,
            name: nextName,
            rssi: nextRssi,
          };
        }
      );

      setTimeout(() => {
        this.manager.stopDeviceScan();
        this.isScanning = false;
        const devices = Object.values(results).sort((left, right) => {
          const leftRssi = typeof left.rssi === 'number' ? left.rssi : -999;
          const rightRssi = typeof right.rssi === 'number' ? right.rssi : -999;
          return rightRssi - leftRssi;
        });
        console.log('✅ [BLE] Scan finished. Devices found:', devices);
        resolve(devices);
      }, timeoutMs);
    });
  }

  async connect(deviceId: string): Promise<BleDevice> {
    const ready = await this.ensureBleManager();
    if (!ready || !this.manager) {
      throw new Error('Bluetooth requires a development build (not Expo Go).');
    }

    console.log('🔗 [BLE] Connecting to device:', deviceId);
    const device = await this.manager.connectToDevice(deviceId, {
      autoConnect: false,
      timeout: 12000,
    });
    console.log('✅ [BLE] Connected:', device.id);

    if (Platform.OS === 'android' && typeof device.requestMTU === 'function') {
      try {
        const mtuDevice = await device.requestMTU(185);
        console.log('📏 [BLE] Requested MTU:', mtuDevice?.mtu ?? 185);
      } catch (error) {
        console.warn('⚠️ [BLE] MTU request failed, continuing with default MTU:', error);
      }
    }

    await device.discoverAllServicesAndCharacteristics();
    console.log('📡 [BLE] Services discovered for device:', device.id);
    return device;
  }

  async scanProvisioningDevices(timeoutMs: number = 8000): Promise<ScannedDevice[]> {
    const devices = await this.scan(timeoutMs, [BLE_CONFIG.PROVISIONING_SERVICE_UUID]);
    return devices.filter(device => device.name !== 'Unknown device' || this.isLikelyProvisioningDevice(device));
  }

  stopScan(): void {
    if (this.isScanning) {
      this.manager?.stopDeviceScan();
      this.isScanning = false;
    }
  }
}

export const bluetoothService = new BluetoothService();
