// src/utils/permissions.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ESSENTIAL_PERMISSIONS_REQUESTED_KEY = '@essential_permissions_requested_v1';

export type EssentialPermissionSummary = {
  notifications: boolean;
  location: boolean;
  contacts: boolean;
  bluetooth: boolean;
};

export const requestEssentialPermissions = async (): Promise<EssentialPermissionSummary> => {
  const [location, contacts, notifications] = await Promise.all([
    Location.requestForegroundPermissionsAsync(),
    Contacts.requestPermissionsAsync(),
    Notifications.requestPermissionsAsync(),
  ]);

  let bluetooth = true;
  if (Platform.OS === 'android') {
    try {
      const { bluetoothService } = await import('../services/bluetooth.service');
      bluetooth = await bluetoothService.requestPermissions();
    } catch (error) {
      console.warn('Bluetooth permission request skipped:', error);
      bluetooth = false;
    }
  }

  return {
    notifications: notifications.status === 'granted',
    location: location.status === 'granted',
    contacts: contacts.status === 'granted' || (contacts as any).status === 'limited',
    bluetooth,
  };
};

export const checkPermissions = async () => {
  const result = await requestEssentialPermissions();
  return Object.values(result).every(Boolean);
};

export const requestEssentialPermissionsOnce = async (): Promise<EssentialPermissionSummary | null> => {
  try {
    const alreadyRequested = await AsyncStorage.getItem(ESSENTIAL_PERMISSIONS_REQUESTED_KEY);
    if (alreadyRequested === 'true') {
      return null;
    }

    const result = await requestEssentialPermissions();
    await AsyncStorage.setItem(ESSENTIAL_PERMISSIONS_REQUESTED_KEY, 'true');
    return result;
  } catch (error) {
    console.warn('Error requesting essential permissions:', error);
    return null;
  }
};
