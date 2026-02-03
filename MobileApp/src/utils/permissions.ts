// src/utils/permissions.ts
import { Platform } from 'react-native';
import * as Permissions from 'expo-permissions';

export const checkPermissions = async () => {
  const requiredPermissions = [
    'CAMERA',
    'LOCATION',
    'CONTACTS',
    'NOTIFICATIONS',
  ];

  const results = await Promise.all(
    requiredPermissions.map(perm => Permissions.askAsync(perm as any))
  );

  return results.every(result => result.status === 'granted');
};