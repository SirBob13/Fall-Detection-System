import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../components/LanguageProvider';
import { storageService } from '../services/storage';
import { authService } from '../services/auth.service';
import { bluetoothService, ScannedDevice, isBluetoothSupported } from '../services/bluetooth.service';
import { deviceService } from '../services/device.service';
import { Device, User } from '../types';

export const DeviceManagementScreen: React.FC = () => {
  const { t } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [scanResults, setScanResults] = useState<ScannedDevice[]>([]);
  const [manualDeviceId, setManualDeviceId] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const sessionUser = await authService.getCurrentUser();
    const normalizedSessionUser = sessionUser
      ? ({
          id: Number(sessionUser.id ?? 0),
          name: sessionUser.name || '',
          age: sessionUser.age ?? 0,
          gender: (sessionUser.gender as User['gender']) || 'other',
          weight: sessionUser.weight,
          height: sessionUser.height,
          medical_conditions: sessionUser.medical_conditions,
          emergency_contact: sessionUser.emergency_contact,
          is_active: sessionUser.is_active ?? true,
          created_at: sessionUser.created_at || new Date().toISOString(),
        } as User)
      : null;

    const storedUser = normalizedSessionUser || (await storageService.getUser());
    if (normalizedSessionUser) {
      await storageService.saveUser(normalizedSessionUser);
    }
    setUser(storedUser);

    const storedDevice = await storageService.getDevice();
    setDevice(storedDevice);

    if (storedUser) {
      const refreshed = await deviceService.refreshUserDevice(storedUser.id);
      if (refreshed) {
        setDevice(refreshed);
      }
    }
  };

  const handleScan = async () => {
    if (!isBluetoothSupported()) {
      Alert.alert(t('common.error'), t('system.bluetoothRequiresDevBuild'));
      return;
    }
    setIsScanning(true);
    try {
      const devices = await bluetoothService.scan(8000);
      setScanResults(devices);
      if (devices.length === 0) {
        Alert.alert(t('system.noDevicesFound'), t('system.tryManual'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || t('errors.unknown'));
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnect = async (deviceId: string) => {
    if (!user) {
      Alert.alert(t('common.error'), `${t('auth.login.title')} ${t('common.required')}`);
      return;
    }
    if (!deviceId) {
      Alert.alert(t('common.error'), t('system.deviceIdRequired'));
      return;
    }

    setIsConnecting(true);
    try {
      const connected = await deviceService.connectDeviceToUser({
        userId: user.id,
        deviceId,
        connectBle: true,
      });

      if (connected) {
        setDevice(connected);
        setManualDeviceId('');
        setScanResults([]);
        Alert.alert(t('success.connected'), t('system.deviceConnected'));
      } else {
        Alert.alert(t('common.error'), t('errors.unknown'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || t('errors.unknown'));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!device?.device_id) return;

    setIsDisconnecting(true);
    try {
      const updated = await deviceService.disconnectDevice(device.device_id);
      if (updated) {
        setDevice(updated);
        Alert.alert(t('success.updated'), t('system.disconnected'));
      } else {
        Alert.alert(t('common.error'), t('errors.unknown'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || t('errors.unknown'));
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-light" showsVerticalScrollIndicator={false}>
      <View className="mx-4 mt-4">
        <Text className="text-lg font-bold text-dark">{t('settings.deviceManagement')}</Text>
        <Text className="text-xs text-gray mt-1">{t('settings.deviceManagementDesc')}</Text>
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('settings.deviceInfo')}</Text>
        {device ? (
          <>
            <View className="flex-row items-center mb-3">
              <MaterialCommunityIcons name="devices" size={20} color="#4CAF50" />
              <Text className="text-base text-dark ml-2">{device.device_id}</Text>
              <View className="flex-1 items-end">
                <View className={`w-3 h-3 rounded-full ${device.is_connected ? 'bg-success' : 'bg-danger'}`} />
              </View>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-xs text-gray">{t('home.battery')}</Text>
              <Text className="text-xs text-gray">
                {device.battery_level?.toFixed(0) || '--'}%
              </Text>
            </View>
            <View className="flex-row justify-between mt-1">
              <Text className="text-xs text-gray">{t('system.lastSeen')}</Text>
              <Text className="text-xs text-gray">
                {device.last_seen ? new Date(device.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}
              </Text>
            </View>
          </>
        ) : (
          <Text className="text-xs text-gray">{t('system.noDevice')}</Text>
        )}
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('system.scanBluetooth')}</Text>
        {!isBluetoothSupported() && (
          <View className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3">
            <Text className="text-xs text-dark">{t('system.bluetoothRequiresDevBuild')}</Text>
          </View>
        )}
        <TouchableOpacity
          onPress={handleScan}
          className="bg-blue-50 border border-blue-100 rounded-xl p-3"
          disabled={isScanning || !isBluetoothSupported()}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-primary font-semibold">
              {isScanning ? t('system.connecting') : t('system.scanBluetooth')}
            </Text>
            {isScanning ? <ActivityIndicator size="small" color="#2196F3" /> : null}
          </View>
        </TouchableOpacity>

        {scanResults.length > 0 && (
          <View className="mt-3">
            {scanResults.map((item) => (
              <TouchableOpacity
                key={item.id}
                className="border border-lightGray rounded-xl p-3 mb-2"
                onPress={() => handleConnect(item.id)}
                disabled={isConnecting}
              >
                <Text className="text-sm font-semibold text-dark">{item.name}</Text>
                <Text className="text-xs text-gray mt-1">{item.id}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('system.enterDeviceId')}</Text>
        <TextInput
          className="input-field"
          value={manualDeviceId}
          onChangeText={setManualDeviceId}
          placeholder={t('system.deviceIdPlaceholder')}
          placeholderTextColor="#BDBDBD"
          autoCapitalize="none"
        />
        <TouchableOpacity
          className="mt-3 bg-primary rounded-xl py-3 items-center"
          onPress={() => handleConnect(manualDeviceId.trim())}
          disabled={isConnecting}
        >
          <Text className="text-white font-semibold">
            {isConnecting ? t('system.connecting') : t('system.connectAction')}
          </Text>
        </TouchableOpacity>
      </View>

      {device && (
        <View className="mx-4 mt-4">
          <TouchableOpacity
            className="bg-danger rounded-xl py-3 items-center"
            onPress={handleDisconnect}
            disabled={isDisconnecting}
          >
            <Text className="text-white font-semibold">
              {isDisconnecting ? t('system.connecting') : t('system.disconnectAction')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View className="h-20" />
    </ScrollView>
  );
};
