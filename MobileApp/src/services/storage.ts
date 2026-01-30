import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/constants';
import { User, Device, Alert } from '../types';

class StorageService {
  // User Data
  async saveUser(user: User): Promise<boolean> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
      return true;
    } catch (error) {
      console.error('Error saving user:', error);
      return false;
    }
  }

  async getUser(): Promise<User | null> {
    try {
      const userString = await AsyncStorage.getItem(STORAGE_KEYS.USER_DATA);
      return userString ? JSON.parse(userString) : null;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  async clearUser(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.USER_DATA);
    } catch (error) {
      console.error('Error clearing user:', error);
    }
  }

  // Device Data
  async saveDevice(device: Device): Promise<boolean> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_DATA, JSON.stringify(device));
      return true;
    } catch (error) {
      console.error('Error saving device:', error);
      return false;
    }
  }

  async getDevice(): Promise<Device | null> {
    try {
      const deviceString = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_DATA);
      return deviceString ? JSON.parse(deviceString) : null;
    } catch (error) {
      console.error('Error getting device:', error);
      return null;
    }
  }

  // Alerts History
  async saveAlert(alert: Alert): Promise<boolean> {
    try {
      const alerts = await this.getAlerts();
      const updatedAlerts = [alert, ...(alerts || [])].slice(0, 100);
      await AsyncStorage.setItem(
        STORAGE_KEYS.ALERTS_HISTORY,
        JSON.stringify(updatedAlerts)
      );
      return true;
    } catch (error) {
      console.error('Error saving alert:', error);
      return false;
    }
  }

  async getAlerts(): Promise<Alert[] | null> {
    try {
      const alertsString = await AsyncStorage.getItem(STORAGE_KEYS.ALERTS_HISTORY);
      return alertsString ? JSON.parse(alertsString) : null;
    } catch (error) {
      console.error('Error getting alerts:', error);
      return null;
    }
  }

  async clearAlerts(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.ALERTS_HISTORY);
    } catch (error) {
      console.error('Error clearing alerts:', error);
    }
  }

  // Settings
  async saveSettings(settings: any): Promise<boolean> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      return true;
    } catch (error) {
      console.error('Error saving settings:', error);
      return false;
    }
  }

  async getSettings(): Promise<any | null> {
    try {
      const settingsString = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      return settingsString ? JSON.parse(settingsString) : null;
    } catch (error) {
      console.error('Error getting settings:', error);
      return null;
    }
  }

  // Clear All Data
  async clearAll(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.USER_DATA,
        STORAGE_KEYS.DEVICE_DATA,
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.ALERTS_HISTORY,
        STORAGE_KEYS.FALL_HISTORY,
      ]);
    } catch (error) {
      console.error('Error clearing all data:', error);
    }
  }
}

export const storageService = new StorageService();
