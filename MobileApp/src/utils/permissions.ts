// src/utils/permissions.ts
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Camera } from 'expo-camera';

export const checkPermissions = async () => {
  const [camera, location, contacts, notifications] = await Promise.all([
    Camera.requestCameraPermissionsAsync(),
    Location.requestForegroundPermissionsAsync(),
    Contacts.requestPermissionsAsync(),
    Notifications.requestPermissionsAsync(),
  ]);

  return [camera, location, contacts, notifications].every(
    (result) => result.status === 'granted'
  );
};
