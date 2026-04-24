import React, { useEffect, useRef, useState } from 'react';
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
import { apiService } from '../services/api';
import { deviceService } from '../services/device.service';
import { deviceProvisioningService } from '../services/deviceProvisioning.service';
import { Device, User } from '../types';
import { realtimeService } from '../services/realtime.service';
import { isDeviceOnline } from '../utils/deviceStatus';
import { BLE_CONFIG, BLE_KNOWN_DEVICE_NAME_PATTERN, BLE_SCAN_TIMEOUT_MS } from '../utils/constants';

export const DeviceManagementScreen: React.FC = () => {
  const { t } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanResults, setScanResults] = useState<ScannedDevice[]>([]);
  const [selectedBleDeviceId, setSelectedBleDeviceId] = useState<string | null>(null);
  const [manualDeviceId, setManualDeviceId] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [provisioningMessage, setProvisioningMessage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [defaultDeviceId, setDefaultDeviceId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedDevices, setArchivedDevices] = useState<Device[]>([]);
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const verificationRunIdRef = useRef(0);

  const cancelCandidateVerification = () => {
    verificationRunIdRef.current += 1;
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    return () => {
      cancelCandidateVerification();
      void deviceProvisioningService.disconnect();
      bluetoothService.stopScan();
    };
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

    const settings = await storageService.getSettings();
    setDefaultDeviceId(settings?.defaultDeviceId ?? null);

    const storedDevice = await storageService.getDevice();
    setDevices(storedDevice ? [storedDevice] : []);

    if (storedUser) {
      await refreshDevices(storedUser.id, storedDevice, settings?.defaultDeviceId);
    }
  };

  useEffect(() => {
    const unsubscribe = realtimeService.subscribe('devices', (event) => {
      if (!user?.id) return;
      if (event.user_id && event.user_id !== user.id) return;
      if (!event.payload) return;

      const payload = event.payload as Device;
      if (payload.is_archived) {
        setDevices((prev) => prev.filter((item) => item.device_id !== payload.device_id));
        setArchivedDevices((prev) => {
          const exists = prev.find((item) => item.device_id === payload.device_id);
          const next = exists
            ? prev.map((item) => (item.device_id === payload.device_id ? { ...item, ...payload } : item))
            : [payload, ...prev];
          return next;
        });
      } else {
        setArchivedDevices((prev) => prev.filter((item) => item.device_id !== payload.device_id));
        setDevices((prev) => {
          const exists = prev.find((item) => item.device_id === payload.device_id);
          const next = exists
            ? prev.map((item) => (item.device_id === payload.device_id ? { ...item, ...payload } : item))
            : [payload, ...prev];
          return next;
        });
      }
    });

    return unsubscribe;
  }, [user?.id]);

  const refreshDevices = async (
    userId: number,
    fallback?: Device | null,
    preferredDefaultId?: string | null
  ) => {
    setIsLoadingDevices(true);
    try {
      const refreshed = await deviceService.refreshUserDevices(userId);
      const nextDevices = refreshed.length > 0 ? refreshed : fallback ? [fallback] : [];
      setDevices(nextDevices);
      await syncDefaultDevice(nextDevices, preferredDefaultId);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const loadArchivedDevices = async (userId: number) => {
    setIsLoadingArchived(true);
    try {
      const response = await apiService.getArchivedDevices(userId);
      if (response.success && Array.isArray(response.data)) {
        setArchivedDevices(response.data);
      } else {
        setArchivedDevices([]);
      }
    } finally {
      setIsLoadingArchived(false);
    }
  };

  const syncDefaultDevice = async (availableDevices: Device[], preferredDefaultId?: string | null) => {
    const settings = await storageService.getSettings();
    const currentDefault = preferredDefaultId ?? settings?.defaultDeviceId ?? null;
    const exists = currentDefault
      ? availableDevices.find((item) => item.device_id === currentDefault)
      : null;
    const nextDefault = exists ? exists.device_id : availableDevices[0]?.device_id ?? null;

    if (nextDefault !== currentDefault) {
      await storageService.saveSettings({
        ...(settings || {}),
        defaultDeviceId: nextDefault,
      });
    }

    if (nextDefault) {
      const selected = availableDevices.find((item) => item.device_id === nextDefault);
      if (selected) {
        await storageService.saveDevice(selected);
      }
    }

    setDefaultDeviceId(nextDefault);
  };

  const isValidDeviceId = (value: string): boolean => {
    const macPattern = /^([0-9A-F]{2}([-:])){5}[0-9A-F]{2}$/i;
    const fallbackPattern = /^[A-Za-z0-9_-]{4,50}$/;
    return macPattern.test(value) || fallbackPattern.test(value);
  };

  const sortProvisioningCandidates = (candidates: ScannedDevice[]): ScannedDevice[] =>
    [...candidates].sort((left, right) => {
      const leftKnown = BLE_KNOWN_DEVICE_NAME_PATTERN.test(left.name) ? 1 : 0;
      const rightKnown = BLE_KNOWN_DEVICE_NAME_PATTERN.test(right.name) ? 1 : 0;

      if (leftKnown !== rightKnown) {
        return rightKnown - leftKnown;
      }

      const leftRssi = typeof left.rssi === 'number' ? left.rssi : -999;
      const rightRssi = typeof right.rssi === 'number' ? right.rssi : -999;
      return rightRssi - leftRssi;
    });

  const handleScan = async () => {
    console.log('🟦 [BLE UI] Scan button pressed');
    if (!isBluetoothSupported()) {
      Alert.alert(t('common.error'), t('system.bluetoothRequiresDevBuild'));
      return;
    }
    setIsScanning(true);
    setHasScanned(true);
    cancelCandidateVerification();
    try {
      let devices = await bluetoothService.scan(BLE_SCAN_TIMEOUT_MS, [BLE_CONFIG.PROVISIONING_SERVICE_UUID]);
      console.log('🟦 [BLE UI] UUID scan results:', devices);
      if (devices.length === 0) {
        const broad = await bluetoothService.scan(BLE_SCAN_TIMEOUT_MS, null);
        console.log('🟦 [BLE UI] Broad scan results:', broad);
        const namedMatches = broad.filter((d) => BLE_KNOWN_DEVICE_NAME_PATTERN.test(d.name));
        devices = namedMatches.length > 0 ? namedMatches : broad;
      }

      setScanResults(devices);
      setSelectedBleDeviceId((current) =>
        current && devices.some((device) => device.id === current) ? current : null
      );
      console.log('🟦 [BLE UI] Initial devices to render:', devices);

      if (devices.length === 0) {
        Alert.alert(t('system.noDevicesFound'), t('system.tryManual'));
      } else if (!devices.some((d) => BLE_KNOWN_DEVICE_NAME_PATTERN.test(d.name))) {
        setProvisioningMessage('Nearby BLE devices found. If the bracelet name is missing, try the top result.');
      }

      const sortedDevices = sortProvisioningCandidates(devices);
      console.log('🟦 [BLE UI] Final devices to render:', sortedDevices);
      setScanResults(sortedDevices);
      setSelectedBleDeviceId((current) =>
        current && sortedDevices.some((device) => device.id === current) ? current : current
      );

      if (sortedDevices.some((d) => BLE_KNOWN_DEVICE_NAME_PATTERN.test(d.name))) {
        setProvisioningMessage('Choose the bracelet from the Bluetooth list, then continue with Wi-Fi setup.');
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
    if (!isValidDeviceId(deviceId)) {
      Alert.alert(t('common.error'), t('system.deviceIdInvalid'));
      return;
    }

    setIsConnecting(true);
    setProvisioningMessage(null);
    cancelCandidateVerification();
    bluetoothService.stopScan();
    await deviceProvisioningService.disconnect();
    try {
      const connected = await deviceService.connectDeviceToUser({
        userId: user.id,
        deviceId,
        connectBle: true,
        wifiSsid: wifiSsid.trim() || undefined,
        wifiPassword: wifiPassword.trim() || undefined,
        onProvisioningStatus: (status) => {
          setProvisioningMessage(status.message || status.stage);
        },
      });

        if (connected) {
          await refreshDevices(user.id, connected, connected.device_id);
          if (showArchived) {
            await loadArchivedDevices(user.id);
          }
          setManualDeviceId('');
          setScanResults([]);
          setSelectedBleDeviceId(null);
          setWifiPassword('');
          setWifiSsid('');
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

  const handleDisconnect = async (deviceId: string) => {
    if (!deviceId || !user?.id) return;

    setDisconnectingId(deviceId);
    try {
      const updated = await deviceService.disconnectDevice(deviceId);
      if (updated) {
        await refreshDevices(user.id, updated, defaultDeviceId);
        Alert.alert(t('success.updated'), t('system.disconnected'));
      } else {
        Alert.alert(t('common.error'), t('errors.unknown'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || t('errors.unknown'));
    } finally {
      setDisconnectingId(null);
    }
  };

  const handleRemove = (deviceId: string) => {
    if (!user?.id || !deviceId) return;

    Alert.alert(
      t('system.removeDeviceTitle'),
      t('system.removeDeviceBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            setRemovingId(deviceId);
            try {
              const removed = await deviceService.removeDevice(deviceId, user.id);
              if (removed) {
                await refreshDevices(user.id);
                if (showArchived) {
                  await loadArchivedDevices(user.id);
                }
                Alert.alert(t('success.deleted'), t('system.deviceRemoved'));
              } else {
                Alert.alert(t('common.error'), t('errors.unknown'));
              }
            } catch (error: any) {
              Alert.alert(t('common.error'), error?.message || t('errors.unknown'));
            } finally {
              setRemovingId(null);
            }
          }
        }
      ]
    );
  };

  const formatLastSeen = (value?: string) => {
    if (!value) return '--';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <ScrollView className="flex-1 bg-light" showsVerticalScrollIndicator={false}>
      <View className="mx-4 mt-4">
        <Text className="text-lg font-bold text-dark">
          {t('settings.deviceManagement')}
        </Text>
        <Text className="text-xs text-gray mt-1">{t('settings.deviceManagementDesc')}</Text>
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('settings.deviceInfo')}</Text>
        {isLoadingDevices ? (
          <ActivityIndicator size="small" color="#2196F3" />
        ) : devices.length > 0 ? (
          devices.map((item) => (
            <View key={item.device_id} className="border border-lightGray rounded-xl p-3 mb-3">
              {(() => {
                const deviceOnline = isDeviceOnline(item);
                return (
                  <>
              <View className="flex-row items-center mb-2">
                <MaterialCommunityIcons name="devices" size={18} color="#4CAF50" />
                <Text className="text-sm font-semibold text-dark ml-2">{item.device_id}</Text>
                <View className="flex-1 items-end">
                  <View className={`w-3 h-3 rounded-full ${deviceOnline ? 'bg-success' : 'bg-danger'}`} />
                </View>
              </View>
              {defaultDeviceId === item.device_id ? (
                <View className="self-start mb-2 px-2 py-1 rounded-full bg-blue-50">
                  <Text className="text-xs text-primary font-semibold">{t('system.defaultDevice')}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  className="self-start mb-2 px-2 py-1 rounded-full border border-primary"
                  onPress={async () => {
                    const settings = await storageService.getSettings();
                    await storageService.saveSettings({
                      ...(settings || {}),
                      defaultDeviceId: item.device_id,
                    });
                    await storageService.saveDevice(item);
                    setDefaultDeviceId(item.device_id);
                    Alert.alert(t('success.updated'), t('system.defaultDeviceSet'));
                  }}
                >
                  <Text className="text-xs text-primary font-semibold">{t('system.setDefault')}</Text>
                </TouchableOpacity>
              )}
              <View className="flex-row justify-between">
                <Text className="text-xs text-gray">
                  {t('system.battery')}
                </Text>
                <Text className="text-xs text-gray">
                  {item.battery_level?.toFixed(0) || '--'}%
                </Text>
              </View>
              <View className="flex-row justify-between mt-1">
                <Text className="text-xs text-gray">
                  {t('system.lastSeen')}
                </Text>
                <Text className="text-xs text-gray">
                  {formatLastSeen(item.last_seen)}
                </Text>
              </View>

              <View className="flex-row items-center mt-3">
                {deviceOnline ? (
                  <TouchableOpacity
                    className="flex-1 bg-danger rounded-xl py-2 items-center"
                    onPress={() => handleDisconnect(item.device_id)}
                    disabled={disconnectingId === item.device_id}
                  >
                    <Text className="text-white text-xs font-semibold">
                      {disconnectingId === item.device_id
                        ? t('system.connecting')
                        : t('system.disconnectAction')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View className="flex-1">
                    <Text className="text-xs text-gray">
                      {t('system.notDefaultDevice')}
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  className="ml-2 px-4 py-2 border border-danger rounded-xl"
                  onPress={() => handleRemove(item.device_id)}
                  disabled={removingId === item.device_id}
                >
                  <Text className="text-danger text-xs font-semibold">
                    {t('common.delete')}
                  </Text>
                </TouchableOpacity>
              </View>
                  </>
                );
              })()}
            </View>
          ))
        ) : (
          <Text className="text-xs text-gray">
            {t('system.noDevicesFound')}
          </Text>
        )}
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-semibold text-dark">
            {t('system.archivedDevices')}
          </Text>
          <TouchableOpacity
            className="px-3 py-2 rounded-full border border-primary"
            onPress={async () => {
              const next = !showArchived;
              setShowArchived(next);
              if (next && user?.id) {
                await loadArchivedDevices(user.id);
              }
            }}
          >
            <Text className="text-xs text-primary font-semibold">
              {showArchived ? t('common.hide') : t('common.show')}
            </Text>
          </TouchableOpacity>
        </View>

        {showArchived ? (
          isLoadingArchived ? (
            <ActivityIndicator size="small" color="#2196F3" className="mt-3" />
          ) : archivedDevices.length > 0 ? (
            <View className="mt-3">
              {archivedDevices.map((item) => (
                <View key={item.device_id} className="border border-lightGray rounded-xl p-3 mb-3">
                  <View className="flex-row items-center mb-2">
                    <MaterialCommunityIcons name="archive" size={18} color="#9E9E9E" />
                    <Text className="text-sm font-semibold text-dark ml-2">{item.device_id}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-gray">{t('system.archivedAt')}</Text>
                    <Text className="text-xs text-gray">
                      {formatLastSeen(item.updated_at || item.last_seen)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    className="mt-3 bg-primary rounded-xl py-2 items-center"
                    onPress={async () => {
                      if (!user?.id) return;
                      setRestoringId(item.device_id);
                      try {
                        const restored = await apiService.restoreDevice(item.device_id, user.id);
                        if (restored.success) {
                          await refreshDevices(user.id);
                          await loadArchivedDevices(user.id);
                          Alert.alert(t('success.updated'), t('system.deviceRestored'));
                        } else {
                          Alert.alert(t('common.error'), t('errors.unknown'));
                        }
                      } finally {
                        setRestoringId(null);
                      }
                    }}
                    disabled={restoringId === item.device_id}
                  >
                    <Text className="text-white text-xs font-semibold">
                      {restoringId === item.device_id ? t('system.connecting') : t('system.restoreDevice')}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-xs text-gray mt-3">{t('system.noArchivedDevices')}</Text>
          )
        ) : (
          <Text className="text-xs text-gray mt-2">{t('system.archivedDevicesHint')}</Text>
        )}
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('system.scanBluetooth')}</Text>
        {!isBluetoothSupported() && (
          <View className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3">
            <Text className="text-xs text-dark">
              {t('system.bluetoothUnsupported')}
            </Text>
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

        {hasScanned && (
          <View className="mt-3 bg-gray-50 border border-lightGray rounded-xl p-3">
            <Text className="text-xs text-dark font-semibold">
              Nearby devices: {scanResults.length}
            </Text>
            <Text className="text-xs text-gray mt-1">
              If nothing looks familiar, pick the top item after we verify the bracelet.
            </Text>
          </View>
        )}

        {scanResults.length > 0 && (
          <View className="mt-3">
            {scanResults.map((item) => (
              <TouchableOpacity
                key={item.id}
                className={`border rounded-xl p-3 mb-2 ${
                  selectedBleDeviceId === item.id ? 'border-primary bg-blue-50' : 'border-lightGray'
                }`}
                onPress={() => setSelectedBleDeviceId(item.id)}
                disabled={isConnecting}
              >
                <Text className="text-sm font-semibold text-dark">
                  {item.name || t('system.unnamedDevice')}
                </Text>
                <Text className="text-xs text-gray mt-1">{item.id}</Text>
                {selectedBleDeviceId === item.id ? (
                  <Text className="text-xs text-primary mt-2 font-semibold">Selected</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View className="mt-4 border-t border-lightGray pt-3">
          <Text className="text-sm font-semibold text-dark mb-2">Step 2: Wi-Fi</Text>
          <Text className="text-xs text-gray mb-2">
            {selectedBleDeviceId
              ? `Selected bracelet: ${selectedBleDeviceId}`
              : 'Step 1: choose the bracelet from the Bluetooth list above.'}
          </Text>
          <Text className="text-sm font-semibold text-dark mb-2">{t('system.wifiSetupTitle')}</Text>
          <Text className="text-xs text-gray mb-3">{t('system.provisioningHint')}</Text>
          <TextInput
            className="input-field mb-3"
            value={wifiSsid}
            onChangeText={setWifiSsid}
            placeholder={t('system.wifiName')}
            placeholderTextColor="#BDBDBD"
            autoCapitalize="none"
          />
          <TextInput
            className="input-field"
            value={wifiPassword}
            onChangeText={setWifiPassword}
            placeholder={t('system.wifiPassword')}
            placeholderTextColor="#BDBDBD"
            secureTextEntry
            autoCapitalize="none"
          />
          {provisioningMessage ? (
            <Text className="text-xs text-primary mt-3">{provisioningMessage}</Text>
          ) : null}
          <TouchableOpacity
            className={`mt-3 rounded-xl py-3 items-center ${
              selectedBleDeviceId && wifiSsid.trim() && wifiPassword.trim() && !isConnecting
                ? 'bg-primary'
                : 'bg-gray-300'
            }`}
            onPress={() => selectedBleDeviceId && handleConnect(selectedBleDeviceId)}
            disabled={!selectedBleDeviceId || !wifiSsid.trim() || !wifiPassword.trim() || isConnecting}
          >
            <Text className="text-white font-semibold">
              {isConnecting ? t('system.connecting') : 'Step 3: Connect'}
            </Text>
          </TouchableOpacity>
        </View>
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

      <View className="h-20" />
    </ScrollView>
  );
};
