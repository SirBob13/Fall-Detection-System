import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Alert as RNAlert,
  Vibration,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../components/LanguageProvider';
import { useSettings } from '../components/SettingsProvider';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { StatusCard } from '../components/StatusCard';
import { EmergencyButton } from '../components/EmergencyButton';
import { AlertCard } from '../components/AlertCard';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { notificationService } from '../services/notifications';
import { authService } from '../services/auth.service';
import { offlineQueueService } from '../services/offlineQueue.service';
import { networkService, NetworkStatus } from '../services/network.service';
import { bluetoothService, ScannedDevice, isBluetoothSupported } from '../services/bluetooth.service';
import { bleGatewayService } from '../services/bleGateway.service';
import { deviceService } from '../services/device.service';
import { deviceProvisioningService } from '../services/deviceProvisioning.service';
import { emergencyService } from '../services/emergency.service';
import { voiceService } from '../services/voice.service';
import { User, Device, Alert as AlertType, Prediction, VitalData, VitalsStatus } from '../types';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import { ScreenHeader } from '../components/ScreenHeader';
import { realtimeService } from '../services/realtime.service';
import { BLE_CONFIG, BLE_KNOWN_DEVICE_NAME_PATTERN, BLE_SCAN_TIMEOUT_MS } from '../utils/constants';
import { getDeviceStatusLabel } from '../utils/deviceStatus';

const formatVitalsSignalStatus = (status?: string | null) => {
  switch (status) {
    case 'good':
      return 'Good signal';
    case 'weak_signal':
      return 'Weak signal';
    case 'place_finger':
      return 'Place finger properly';
    case 'keep_still':
      return 'Keep still';
    case 'sensor_not_ready':
      return 'Sensor not ready';
    case 'rest':
      return 'Sensor resting';
    default:
      return status || 'Measuring...';
  }
};

export const HomeScreen: React.FC = () => {
  const { t } = useLanguage();
  const { settings, refreshSettings } = useSettings();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const isAndroid = Platform.OS === 'android';
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [lastPrediction, setLastPrediction] = useState<Prediction | null>(null);
  const [latestVitals, setLatestVitals] = useState<VitalData | null>(null);
  const [vitalsStatus, setVitalsStatus] = useState<VitalsStatus | null>(null);
  const [lastValidVitals, setLastValidVitals] = useState<{ heartRate?: number; spo2?: number }>({});
  const [vitalsRequesting, setVitalsRequesting] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [pairModalVisible, setPairModalVisible] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<ScannedDevice[]>([]);
  const [selectedBleDeviceId, setSelectedBleDeviceId] = useState<string | null>(null);
  const [manualDeviceId, setManualDeviceId] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [provisioningMessage, setProvisioningMessage] = useState<string | null>(null);
  const [isConnectingDevice, setIsConnectingDevice] = useState(false);
  const [isRemovingDevice, setIsRemovingDevice] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);
  const [healthInsight, setHealthInsight] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [monitoringSummary, setMonitoringSummary] = useState({ people: 0, pending: 0, critical: 0 });
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const scrollRef = useRef<any>(null);

  useScrollToTop(scrollRef);

  const closePairModal = async () => {
    setPairModalVisible(false);
    bluetoothService.stopScan();
    await deviceProvisioningService.disconnect();
  };
  
  useEffect(() => {
    loadData();
    const unsubscribe = networkService.addListener((status) => setNetworkStatus(status));
    const queueInterval = setInterval(() => {
      setQueueSize(offlineQueueService.getQueueSize());
    }, 5000);
    const interval = setInterval(() => {
      checkForNewAlerts();
    }, 30000);

    return () => {
      clearInterval(interval);
      clearInterval(queueInterval);
      unsubscribe();
      bluetoothService.stopScan();
      void deviceProvisioningService.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!settings.voiceCommands) return;
    voiceService.initialize({
      onResult: handleVoiceResult,
      onError: (message) => console.warn('Voice error:', message),
      onStateChange: (value) => setListening(value),
    });

    return () => {
      voiceService.destroy().catch(() => undefined);
    };
  }, [settings.voiceCommands]);

  const loadData = async () => {
    try {
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
      const storedDevice = await storageService.getDevice();
      await refreshSettings();

      setUser(storedUser);
      if (normalizedSessionUser) {
        await storageService.saveUser(normalizedSessionUser);
      }
      setDevice(storedDevice);
      
      // Home is always the signed-in user's own page.
      const activeUser = storedUser;
      if (activeUser) {
        try {
          let apiReachable = false;

          const alertsResponse = await apiService.getUserAlerts(activeUser.id, 5);
          if (alertsResponse.success) {
            setAlerts(alertsResponse.data || []);
            apiReachable = true;
          }

          if (storedUser?.id) {
            const [careLinksResponse, careDashboardResponse] = await Promise.all([
              apiService.getCareLinks(storedUser.id),
              apiService.getCareDashboard(storedUser.id),
            ]);
            const people = careLinksResponse.success && careLinksResponse.data ? careLinksResponse.data.length : 0;
            const careItems = careDashboardResponse.success && careDashboardResponse.data ? careDashboardResponse.data : [];
            const pending = careItems.reduce((sum, item) => sum + (item.alerts?.pending ?? 0), 0);
            const critical = careItems.filter((item) => item.alerts?.last?.severity === 'critical').length;
            setMonitoringSummary({ people, pending, critical });
          } else {
            setMonitoringSummary({ people: 0, pending: 0, critical: 0 });
          }

          const deviceResponse = await apiService.getUserDevice(activeUser.id);
          if (deviceResponse.success && deviceResponse.data) {
            apiReachable = true;
            setDevice(deviceResponse.data);
            await storageService.saveDevice(deviceResponse.data);
          }

          const predictionResponse = await apiService.getUserPredictions(activeUser.id, 1);
          if (predictionResponse.success && predictionResponse.data && predictionResponse.data.length > 0) {
            apiReachable = true;
            setLastPrediction(predictionResponse.data[0]);
          }

          const vitalsResponse = await apiService.getUserVitals(activeUser.id, 1);
          if (vitalsResponse.success && vitalsResponse.data && vitalsResponse.data.length > 0) {
            apiReachable = true;
            setLatestVitals(vitalsResponse.data[0]);
            if (settings.automaticSOS && vitalsResponse.data[0].is_abnormal) {
              emergencyService.triggerEmergency('vital_abnormal', vitalsResponse.data[0]).catch(() => undefined);
            }
          } else {
            setLatestVitals(null);
          }

          if (settings.healthInsights) {
            const reportResponse = await apiService.getUserReport(activeUser.id, 7);
            if (reportResponse.success && reportResponse.data?.recommendations?.length) {
              apiReachable = true;
              setHealthInsight(reportResponse.data.recommendations[0]);
            } else {
              setHealthInsight(null);
            }
          } else {
            setHealthInsight(null);
          }

          setConnectionError(!apiReachable);
          if (apiReachable) {
            setLastRefreshedAt(new Date());
          }
        } catch (apiError) {
          console.warn('⚠️ (Background) Error loading data:', apiError);
          setConnectionError(true);
        }
      }
    } catch (error) {
      console.error('❌ (Background) General error:', error);
      setConnectionError(true);
    }
  };

  useEffect(() => {
    const unsubscribe = realtimeService.subscribe('all', (event) => {
      const activeUser = user;
      if (!activeUser) return;
      if (event.user_id && event.user_id !== activeUser.id) return;
      if (!event.payload) return;

      if (event.resource === 'alerts') {
        setAlerts((prev) => {
          const exists = prev.find((item) => item.id === event.payload.id);
          const next = exists
            ? prev.map((item) => (item.id === event.payload.id ? { ...item, ...event.payload } : item))
            : [event.payload, ...prev];

          if (
            !exists &&
            (event.payload.status === 'pending' || event.payload.status === 'sent') &&
            (event.payload.alert_type === 'fall' || event.payload.alert_type === 'fall_now')
          ) {
            notificationService.sendFallAlert(event.payload);
            if (settings.automaticSOS) {
              emergencyService.triggerEmergency('fall', event.payload).catch(() => undefined);
            }
          }

          return next.slice(0, 5);
        });
      }

      if (event.resource === 'devices') {
        setDevice((prev) => ({ ...(prev || {}), ...event.payload }));
      }

      if (event.resource === 'predictions') {
        setLastPrediction(event.payload);
      }

      if (event.resource === 'vitals') {
        setLatestVitals((prev) => {
          if (
            settings.automaticSOS &&
            event.payload?.is_abnormal &&
            prev?.id !== event.payload?.id
          ) {
            emergencyService.triggerEmergency('vital_abnormal', event.payload).catch(() => undefined);
          }
          return event.payload;
        });
      }

      if (event.resource === 'vitals_status') {
        const payload = event.payload as VitalsStatus;
        setVitalsStatus(payload);
        setVitalsRequesting(payload.state === 'requested' || payload.state === 'measuring');
        setLastValidVitals((current) => ({
          heartRate: payload.heart_rate_valid && payload.heart_rate ? payload.heart_rate : current.heartRate,
          spo2: payload.spo2_valid && payload.spo2 ? payload.spo2 : current.spo2,
        }));
      }

      if (event.resource === 'profile') {
        if (event.payload?.id === activeUser.id) {
          setUser((prev) => ({ ...(prev || {}), ...event.payload }));
        }
      }
    });

    return unsubscribe;
  }, [user, settings.automaticSOS]);

  const checkForNewAlerts = async () => {
    const activeUser = user;
    if (!activeUser) return;

    try {
      const alertsResponse = await apiService.getUserAlerts(activeUser.id, 5);
      if (alertsResponse.success && alertsResponse.data) {
        const newAlerts = alertsResponse.data.filter(
          (newAlert) => !alerts.some((existingAlert) => existingAlert.id === newAlert.id)
        );

        newAlerts.forEach((alert) => {
          if (
            (alert.status === 'pending' || alert.status === 'sent') &&
            (alert.alert_type === 'fall' || alert.alert_type === 'fall_now')
          ) {
            notificationService.sendFallAlert(alert);
          }

          if (
            settings.automaticSOS &&
            (alert.alert_type === 'fall' || alert.alert_type === 'fall_now')
          ) {
            emergencyService.triggerEmergency('fall', alert).catch(() => undefined);
          }
        });

        if (newAlerts.length > 0) {
          setAlerts(alertsResponse.data);
        }
      }
    } catch (error) {
      console.error('Error checking alerts:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleImFine = async (alertId: number) => {
    try {
      const response = await apiService.resolveAlert(alertId);
      if (response.success) {
        RNAlert.alert(t('common.success'), t('alerts.imFineConfirmed'));
        await loadData();
      } else {
        RNAlert.alert(t('common.error'), response.message || t('alerts.resolveFailed'));
      }
    } catch (error) {
      RNAlert.alert(t('common.error'), t('alerts.resolveFailed'));
    }
  };

  const handleEmergencyPress = async () => {
    if (!user) {
      RNAlert.alert(t('common.error'), `${t('auth.login.title')} ${t('common.required')}`);
      return;
    }

    try {
      const contacts = await emergencyService.getEmergencyContacts();
      const hasUsableContacts = contacts.some(
        (contact) => Boolean(contact.phone && contact.phone.trim().length > 0)
      );

      if (!hasUsableContacts) {
        RNAlert.alert(
          t('emergency.contacts.setupRequiredTitle'),
          t('emergency.contacts.setupRequiredMessage'),
          [
            {
              text: t('emergency.contacts.importNow'),
              onPress: () =>
                navigation.navigate('Emergency', {
                  screen: 'EmergencyContacts',
                  params: {
                    requiredSetup: true,
                    openImport: true,
                  },
                }),
            },
            {
              text: t('common.cancel'),
              style: 'cancel',
            },
          ]
        );
        return;
      }

      RNAlert.alert(
        t('emergency.sosButton'),
        `${t('emergency.sosSending')}?`,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.send'),
            onPress: async () => {
              try {
                RNAlert.alert(t('emergency.sosSending'), t('common.pleaseWait'));
                const success = await emergencyService.triggerEmergency('manual');
                if (success) {
                  RNAlert.alert(
                    t('success.sent'),
                    `${t('emergency.sosSending')} ${t('success.sent')}`,
                    [{ text: t('common.ok') }]
                  );
                  Vibration.vibrate([500, 500, 500]);
                  loadData();
                }
              } catch (error) {
                RNAlert.alert(t('common.error'), t('errors.unknown'));
              }
            },
            style: 'default',
          },
        ]
      );
    } catch (error) {
      console.error('Emergency error:', error);
      RNAlert.alert(t('common.error'), t('errors.unknown'));
    }
  };

  const handleEmergencyLongPress = () => {
    RNAlert.alert(
      t('emergency.title'),
      `${t('emergency.settings.autoCall')}?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('emergency.settings.autoCall'),
          onPress: () => {
            RNAlert.alert(
              t('emergency.title'),
              t('emergency.sosSending'),
              [{ text: t('common.ok') }]
            );
          },
          style: 'destructive',
        },
      ]
    );
  };

  const handleMeasureVitals = async () => {
    if (!device?.device_id) {
      RNAlert.alert(t('common.error'), t('system.noDevice'));
      return;
    }

    setVitalsRequesting(true);
    try {
      const response = await apiService.startDeviceVitals(device.device_id, 60000);
      if (!response.success || !response.data) {
        RNAlert.alert(t('common.error'), response.message || 'Device is offline or cannot start vitals measurement.');
        setVitalsRequesting(false);
        return;
      }
      setVitalsStatus(response.data);
    } finally {
      setVitalsRequesting(false);
    }
  };

  const handleVoiceResult = (text: string) => {
    const normalized = text.toLowerCase();
    setLastCommand(text);

    const isEmergency =
      normalized.includes('sos') ||
      normalized.includes('help') ||
      normalized.includes('emergency') ||
      normalized.includes('نجدة') ||
      normalized.includes('طوارئ');

    if (isEmergency) {
      emergencyService.triggerEmergency('manual').catch(() => undefined);
      return;
    }

    if (normalized.includes('alerts') || normalized.includes('تنبيهات')) {
      navigation.navigate('Alerts');
      return;
    }

    if (normalized.includes('settings') || normalized.includes('الإعدادات')) {
      navigation.navigate('Settings');
      return;
    }

    if (normalized.includes('device') || normalized.includes('جهاز')) {
      setPairModalVisible(true);
      return;
    }
  };

  const handleVoiceCommand = () => {
    if (!settings.voiceCommands) return;
    const locale = t('direction') === 'rtl' ? 'ar-EG' : 'en-US';
    voiceService.start(locale);
  };

  const handleViewAllAlerts = () => {
    navigation.navigate('Alerts', { monitoredPatient: undefined });
  };

  const handleOpenCareDashboard = () => {
    navigation.navigate('Settings', { screen: 'CareDashboard' });
  };

  const handleRemoveDevice = () => {
    if (!device?.device_id) {
      return;
    }

    RNAlert.alert(
      t('system.removeDeviceTitle'),
      t('system.removeDeviceBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsRemovingDevice(true);
              await bleGatewayService.stop();
              await deviceProvisioningService.disconnect();

              const activeUserId = user?.id;
              const removed = await deviceService.removeDevice(device.device_id, activeUserId);

              if (removed) {
                setDevice(null);
                setSelectedBleDeviceId(null);
                setManualDeviceId('');
                setScanResults([]);
                setWifiPassword('');
                setWifiSsid('');
                setProvisioningMessage(null);
                RNAlert.alert(t('success.deleted'), t('system.deviceRemoved'));
              } else {
                RNAlert.alert(t('common.error'), t('system.removeDeviceFailed'));
              }
            } catch (error: any) {
              RNAlert.alert(t('common.error'), error?.message || t('system.removeDeviceFailed'));
            } finally {
              setIsRemovingDevice(false);
            }
          },
        },
      ]
    );
  };

  const connectionBannerTitle =
    networkStatus?.isConnected && !networkStatus?.isInternetReachable
      ? t('errors.server')
      : t('errors.connection');

  const connectionBannerDescription =
    networkStatus?.isConnected && !networkStatus?.isInternetReachable
      ? t('errors.serverUnavailableDesc')
      : t('errors.connectionDesc');

  const openPairModal = () => {
    if (!user) {
      RNAlert.alert(t('common.error'), `${t('auth.login.title')} ${t('common.required')}`);
      return;
    }
    setPairModalVisible(true);
  };

  const handleScan = async () => {
    if (!isBluetoothSupported()) {
      RNAlert.alert(t('common.error'), t('system.bluetoothRequiresDevBuild'));
      return;
    }
    setScanLoading(true);
    try {
      let devices = await bluetoothService.scan(BLE_SCAN_TIMEOUT_MS, [BLE_CONFIG.PROVISIONING_SERVICE_UUID]);
      if (devices.length === 0) {
        const broad = await bluetoothService.scan(BLE_SCAN_TIMEOUT_MS, null);
        devices = broad.filter((d) => BLE_KNOWN_DEVICE_NAME_PATTERN.test(d.name));
      }
      setScanResults(devices);
      setSelectedBleDeviceId((current) =>
        current && devices.some((device) => device.id === current) ? current : null
      );
      if (devices.length === 0) {
        RNAlert.alert(t('system.noDevicesFound'), t('system.tryManual'));
      }
    } catch (error: any) {
      RNAlert.alert(t('common.error'), error?.message || t('errors.unknown'));
    } finally {
      setScanLoading(false);
    }
  };

  const linkDeviceToUser = async (deviceId: string) => {
    if (!user) return;
    if (!deviceId) {
      RNAlert.alert(t('common.error'), t('system.deviceIdRequired'));
      return;
    }

    setIsConnectingDevice(true);
    setProvisioningMessage(null);
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
        setDevice(connected);
        await closePairModal();
        setSelectedBleDeviceId(null);
        setManualDeviceId('');
        setScanResults([]);
        setWifiPassword('');
        setWifiSsid('');
        RNAlert.alert(t('success.connected'), t('system.deviceConnected'));
      } else {
        RNAlert.alert(t('common.error'), t('errors.unknown'));
      }
    } catch (error: any) {
      RNAlert.alert(t('common.error'), error?.message || t('errors.unknown'));
    } finally {
      setIsConnectingDevice(false);
    }
  };

  const isMeasuringVitals = vitalsStatus?.state === 'requested' || vitalsStatus?.state === 'measuring';
  const vitalsProgress = Math.max(0, Math.min(100, Math.round(vitalsStatus?.progress_percent ?? 0)));
  const displayHeartRate = vitalsStatus?.heart_rate_valid
    ? vitalsStatus.heart_rate
    : lastValidVitals.heartRate ?? latestVitals?.heart_rate;
  const displaySpo2 = vitalsStatus?.spo2_valid
    ? vitalsStatus.spo2
    : lastValidVitals.spo2 ?? latestVitals?.oxygen_saturation;
  const vitalsHint = isMeasuringVitals
    ? vitalsStatus?.finger_detected
      ? formatVitalsSignalStatus(vitalsStatus?.signal_status)
      : 'Place finger properly'
    : vitalsStatus?.state === 'complete'
    ? vitalsStatus?.heart_rate_valid || vitalsStatus?.spo2_valid
      ? 'Measurement complete'
      : formatVitalsSignalStatus(vitalsStatus?.signal_status)
    : 'Start a 60s reading from the bracelet';

  return (
    <ScreenWrapper>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 8,
          paddingTop: isAndroid ? 70 : 20,
          paddingBottom: Math.max(insets.bottom + (isAndroid ? 50 : 100), 88),
        }}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            tintColor="#2196F3"
            colors={['#2196F3']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title={t('home.title')} subtitle={t('app.tagline')} compact={isAndroid} />
        {/* Connection Error Banner */}
        {connectionError && (
          <View className="mx-4 my-3 bg-red-50 border border-danger rounded-xl p-3">
            <View className="flex-row items-center">
              <View className="w-3 h-3 rounded-full bg-danger mr-2" />
              <Text className="text-sm font-medium text-dark flex-1">
                {connectionBannerTitle}
              </Text>
            </View>
            <Text className="text-xs text-gray mt-1">
              {connectionBannerDescription}
            </Text>
          </View>
        )}

        {/* Offline Sync Banner */}
        {queueSize > 0 && (
          <View className="mx-4 my-3 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
            <Text className="text-xs text-gray">{t('system.offlineQueueTitle')}</Text>
            <Text className="text-sm font-semibold text-dark mt-1">
              {t('system.offlineQueueDesc', { count: queueSize })}
            </Text>
            {networkStatus && (
              <Text className="text-xs text-gray mt-1">
                {networkStatus.isInternetReachable ? t('common.syncing') : t('errors.connection')}
              </Text>
            )}
          </View>
        )}

        {/* Low Battery Banner */}
        {device?.battery_level !== undefined && device.battery_level !== null && device.battery_level <= 20 && (
          <View
            className="mx-4 my-3 rounded-xl p-3"
            style={{
                    backgroundColor: '#FFF4E5',
                    borderColor: '#FED7AA',
                    borderWidth: 1,
                  }
            }
          >
            <Text className="text-xs text-gray">{t('system.lowBatteryTitle')}</Text>
            <Text className="text-sm font-semibold text-dark mt-1">
              {t('system.lowBatteryDesc')}
            </Text>
          </View>
        )}

        <View className="mx-4 mt-3 mb-1">
          <Text className="text-lg font-bold text-dark mb-3">{t('dashboard.pages')}</Text>
          <View className="flex-row gap-3">
            <View className="flex-1 bg-primary rounded-2xl p-4 shadow-sm">
              <Text className="text-white text-xs opacity-90 mb-1">{t('dashboard.myData')}</Text>
              <Text className="text-white text-base font-bold">{t('home.title')}</Text>
              <Text className="text-white/80 text-xs mt-2">{t('home.quickStatsDeviceTitle')}</Text>
            </View>

            <TouchableOpacity
              className="flex-1 bg-white rounded-2xl p-4 border border-lightGray shadow-sm"
              activeOpacity={0.8}
              onPress={handleOpenCareDashboard}
            >
              <Text className="text-primary text-xs mb-1">{t('settings.careManagement')}</Text>
              <Text className="text-dark text-base font-bold">{t('dashboard.title')}</Text>
              <Text className="text-gray text-xs mt-2">{t('dashboard.shortDesc')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          className="mx-4 mt-4 bg-white rounded-2xl p-4 border border-primary/15 shadow-sm"
          activeOpacity={0.8}
          onPress={handleOpenCareDashboard}
        >
          <View className="flex-row items-center justify-between mb-3">
            <View>
              <Text className="text-sm text-gray">{t('settings.careManagement')}</Text>
              <Text className="text-base font-bold text-dark mt-1">{t('dashboard.summaryTitle')}</Text>
            </View>
            <View className="w-11 h-11 rounded-full bg-primary items-center justify-center">
              <MaterialCommunityIcons name="account-heart-outline" size={22} color="#FFFFFF" />
            </View>
          </View>
          <View className="flex-row justify-between">
            <View className="items-center flex-1 bg-blue-50 border border-primary/20 rounded-xl py-3 mx-1">
              <Text className="text-lg font-bold text-primary">{monitoringSummary.people}</Text>
              <Text className="text-[10px] text-primary">{t('dashboard.summaryPeople')}</Text>
            </View>
            <View className="items-center flex-1 bg-orange-50 border border-warning/20 rounded-xl py-3 mx-1">
              <Text className="text-lg font-bold text-warning">{monitoringSummary.pending}</Text>
              <Text className="text-[10px] text-warning">{t('dashboard.summaryPending')}</Text>
            </View>
            <View className="items-center flex-1 bg-red-50 border border-danger/20 rounded-xl py-3 mx-1">
              <Text className="text-lg font-bold text-danger">{monitoringSummary.critical}</Text>
              <Text className="text-[10px] text-danger">{t('dashboard.summaryCritical')}</Text>
            </View>
          </View>
          <View className="mt-3 flex-row items-center justify-between">
            <View>
              <Text className="text-xs text-gray">{t('dashboard.shortDesc')}</Text>
              {lastRefreshedAt ? (
                <Text className="text-[11px] text-lightGray mt-1">
                  {t('dashboard.updatedNow', {
                    time: lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  })}
                </Text>
              ) : null}
            </View>
            <MaterialCommunityIcons name="arrow-right-circle-outline" size={20} color="#2196F3" />
          </View>
        </TouchableOpacity>

        {/* System Status Card */}
        <View className="mx-4 mt-5">
          <StatusCard
            device={device}
            lastPrediction={lastPrediction}
            onRefresh={loadData}
            onConnect={openPairModal}
            onRemoveDevice={handleRemoveDevice}
            isRemovingDevice={isRemovingDevice}
            isConnecting={isConnectingDevice}
            compact={isAndroid}
            canManageDevice
          />
        </View>

        {/* Vital Signs */}
        <View className="mx-4 mt-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-lg font-bold text-dark">{t('vitals.title')}</Text>
            <TouchableOpacity
              className={`px-4 py-2 rounded-full ${isMeasuringVitals || vitalsRequesting ? 'bg-gray-200' : 'bg-primary'}`}
              onPress={handleMeasureVitals}
              disabled={isMeasuringVitals || vitalsRequesting}
            >
              {vitalsRequesting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className={`text-xs font-bold ${isMeasuringVitals ? 'text-gray' : 'text-white'}`}>
                  {isMeasuringVitals ? 'Measuring...' : 'Measure Vitals'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
          <View className="bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            {latestVitals || displayHeartRate || displaySpo2 ? (
              <>
                <View className="flex-row justify-between mb-3">
                  <Text className="text-sm text-gray">{t('vitals.heartRate')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {displayHeartRate ?? '--'} {t('vitals.bpm')}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-3">
                  <Text className="text-sm text-gray">{t('vitals.oxygenSaturation')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {displaySpo2 !== undefined && displaySpo2 !== null
                      ? `${displaySpo2} ${t('vitals.percent')}`
                      : '--'}
                  </Text>
                </View>
              </>
            ) : (
              <View className="items-center py-4">
                <View className="w-12 h-12 rounded-full bg-blue-50 items-center justify-center mb-3">
                  <MaterialCommunityIcons name="heart-pulse" size={24} color="#2196F3" />
                </View>
                <Text className="text-sm font-medium text-gray text-center">{t('vitals.noData')}</Text>
                <Text className="text-xs text-lightGray text-center mt-1 px-6">{t('vitals.noDataHint')}</Text>
              </View>
            )}
            {(isMeasuringVitals || vitalsStatus?.state === 'complete') && (
              <View className="mt-4 pt-4 border-t border-lightGray">
                <View className="h-2 rounded-full bg-blue-50 overflow-hidden">
                  <View className="h-2 rounded-full bg-primary" style={{ width: `${vitalsProgress}%` }} />
                </View>
                <Text className="text-xs text-gray mt-2">
                  {vitalsHint} {isMeasuringVitals ? `· ${vitalsProgress}%` : ''}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Emergency Button */}
        <View
          className="mx-4 my-6 bg-white rounded-3xl border border-lightGray items-center"
          style={{ paddingVertical: isAndroid ? 22 : 24, paddingHorizontal: 16 }}
        >
          <EmergencyButton
            onPress={handleEmergencyPress}
            onLongPress={handleEmergencyLongPress}
            disabled={!user}
            large={false}
            compact={isAndroid}
          />
          {!user && (
            <Text className="text-xs text-gray mt-2">
              {t('auth.login.title')} {t('common.required')}
            </Text>
          )}
        </View>

        {/* Recent Alerts Section */}
        <View className="mt-4">
          <View className="flex-row justify-between items-center mx-4 mb-3">
            <Text className="text-lg font-bold text-dark">
              {t('alerts.recentAlerts')}
            </Text>
            {alerts.length > 0 && (
              <TouchableOpacity 
                onPress={handleViewAllAlerts}
                className="px-3 py-1.5 bg-primary/10 rounded-full active:opacity-70"
              >
                <Text className="text-xs font-semibold text-primary">
                  {t('common.viewAll')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          
          {alerts.length > 0 ? (
            <View className="px-2">
              {alerts.slice(0, 3).map((alert) => (
                <View key={alert.id} className="mb-2">
                  <AlertCard
                    alert={alert}
                    onAcknowledge={() => {}}
                    onResolve={() => {}}
                    onImFine={() => handleImFine(alert.id)}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View className="items-center py-10">
              <View className="w-16 h-16 rounded-full bg-green-50 justify-center items-center mb-3">
                <Text className="text-3xl">✅</Text>
              </View>
              <Text className="text-lg text-gray mb-2 font-medium">
                {t('alerts.noAlerts')}
              </Text>
              <Text className="text-sm text-lightGray text-center px-6">
                {t('home.noAlertsHint')}
              </Text>
            </View>
          )}
        </View>

        {/* Safety Tips Section */}
        <View className="mt-8 mx-4">
          <Text className="text-lg font-bold text-dark mb-4">
            {t('home.safetyTips')}
          </Text>
          
          <View className="bg-white rounded-2xl shadow-lg border border-lightGray p-5">
            <View className="flex-row items-start mb-3">
              <View className="w-8 h-8 rounded-full bg-blue-50 justify-center items-center mr-3">
                <Text className="text-primary font-bold">1</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-dark mb-1">
                  {t('home.tip1Title')}
                </Text>
                <Text className="text-sm text-gray">
                  {t('home.tip1')}
                </Text>
              </View>
            </View>
            
            <View className="flex-row items-start mb-3">
              <View className="w-8 h-8 rounded-full bg-blue-50 justify-center items-center mr-3">
                <Text className="text-primary font-bold">2</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-dark mb-1">
                  {t('home.tip2Title')}
                </Text>
                <Text className="text-sm text-gray">
                  {t('home.tip2')}
                </Text>
              </View>
            </View>
            
            <View className="flex-row items-start mb-3">
              <View className="w-8 h-8 rounded-full bg-blue-50 justify-center items-center mr-3">
                <Text className="text-primary font-bold">3</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-dark mb-1">
                  {t('home.tip3Title')}
                </Text>
                <Text className="text-sm text-gray">
                  {t('home.tip3')}
                </Text>
              </View>
            </View>
            
            <View className="flex-row items-start">
              <View className="w-8 h-8 rounded-full bg-blue-50 justify-center items-center mr-3">
                <Text className="text-primary font-bold">4</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-dark mb-1">
                  {t('home.tip4Title')}
                </Text>
                <Text className="text-sm text-gray">
                  {t('home.tip4')}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Quick Stats */}
        <View className="mt-8 mx-4">
          <Text className="text-lg font-bold text-dark mb-4">
            {t('home.quickStats')}
          </Text>
          
          <View className="flex-row justify-between gap-2">
            <View className="bg-white rounded-xl p-4 flex-1 shadow-sm border border-lightGray">
              <Text className="text-xs text-gray mb-1">{t('alerts.recentAlerts')}</Text>
              <Text className="text-2xl font-bold text-dark">
                {alerts.length}
              </Text>
              <Text className="text-xs text-gray mt-1">{t('home.quickStatsAlertsHint')}</Text>
            </View>

            <View className="bg-white rounded-xl p-4 flex-1 shadow-sm border border-lightGray">
              <Text className="text-xs text-gray mb-1">{t('home.quickStatsDeviceTitle')}</Text>
              <Text className="text-lg font-bold text-dark">
                {device
                  ? getDeviceStatusLabel(device)
                  : t('system.noDevice')}
              </Text>
              <Text className="text-xs text-gray mt-1">
                {device?.device_id ? `${device.device_id.slice(0, 12)}${device.device_id.length > 12 ? '…' : ''}` : ''}
              </Text>
            </View>
          </View>
        </View>

        {settings.healthInsights && (
          <View className="mt-8 mx-4">
            <Text className="text-lg font-bold text-dark mb-4">
              {t('home.healthInsightsTitle')}
            </Text>
            <View className="bg-white rounded-2xl shadow-lg border border-lightGray p-5">
              <Text className="text-sm text-gray">
                {healthInsight || t('home.healthInsightsEmpty')}
              </Text>
            </View>
          </View>
        )}

        {settings.voiceCommands && (
          <View className="mt-8 mx-4">
            <Text className="text-lg font-bold text-dark mb-4">
              {t('home.voiceCommandsTitle')}
            </Text>
            <TouchableOpacity
              className="bg-white rounded-2xl shadow-lg border border-lightGray p-5 flex-row items-center justify-between"
              onPress={handleVoiceCommand}
              activeOpacity={0.7}
            >
              <View>
                <Text className="text-sm text-gray">{t('home.voicePrompt')}</Text>
                {lastCommand ? (
                  <Text className="text-xs text-gray mt-1">{t('home.voiceLast')}: {lastCommand}</Text>
                ) : null}
              </View>
              <Text className="text-primary font-semibold">
                {listening ? t('home.voiceListening') : t('common.start')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Spacing */}
        <View className="h-4" />
      </ScrollView>

      {/* Pair Device Modal */}
      <Modal
        visible={pairModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          void closePairModal();
        }}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View
            className="bg-white rounded-t-3xl p-5"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-lg font-bold text-dark">{t('system.connectAction')}</Text>
              <TouchableOpacity onPress={() => {
                void closePairModal();
              }}>
                <Text className="text-primary font-semibold">{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>

            {!isBluetoothSupported() && (
              <View className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3">
                <Text className="text-xs text-dark">{t('system.bluetoothRequiresDevBuild')}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleScan}
              className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3"
              disabled={scanLoading || !isBluetoothSupported()}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-primary font-semibold">
                  {t('system.scanBluetooth')}
                </Text>
                {scanLoading ? <ActivityIndicator size="small" color="#2196F3" /> : null}
              </View>
            </TouchableOpacity>

            {scanResults.length > 0 && (
              <View className="mb-4">
                {scanResults.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    className={`rounded-xl p-3 mb-2 border ${
                      selectedBleDeviceId === item.id ? 'border-primary bg-blue-50' : 'border-lightGray'
                    }`}
                    onPress={() => setSelectedBleDeviceId(item.id)}
                    disabled={isConnectingDevice}
                  >
                    <Text className="text-sm font-semibold text-dark">{item.name}</Text>
                    <Text className="text-xs text-gray mt-1">{item.id}</Text>
                    {selectedBleDeviceId === item.id ? (
                      <Text className="text-xs text-primary mt-2 font-semibold">Selected</Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View className="border-t border-lightGray pt-3">
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
                className="input-field mb-3"
                value={wifiPassword}
                onChangeText={setWifiPassword}
                placeholder={t('system.wifiPassword')}
                placeholderTextColor="#BDBDBD"
                secureTextEntry
                autoCapitalize="none"
              />
              {provisioningMessage ? (
                <Text className="text-xs text-primary mb-3">{provisioningMessage}</Text>
              ) : null}

              <View className="border-t border-lightGray pt-3">
                <Text className="text-sm text-dark mb-2">{t('system.enterDeviceId')}</Text>
                <TextInput
                  className="input-field"
                  value={manualDeviceId}
                  onChangeText={setManualDeviceId}
                  placeholder={t('system.deviceIdPlaceholder')}
                  placeholderTextColor="#BDBDBD"
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  className={`mt-3 rounded-xl py-3 items-center ${
                    selectedBleDeviceId && wifiSsid.trim() && wifiPassword.trim() && !isConnectingDevice
                      ? 'bg-primary'
                      : 'bg-gray-300'
                  }`}
                  onPress={() => linkDeviceToUser(selectedBleDeviceId || manualDeviceId.trim())}
                  disabled={
                    (!selectedBleDeviceId && !manualDeviceId.trim()) ||
                    !wifiSsid.trim() ||
                    !wifiPassword.trim() ||
                    isConnectingDevice
                  }
                >
                  <Text className="text-white font-semibold">
                    {isConnectingDevice ? t('system.connecting') : 'Step 3: Connect'}
                  </Text>
                </TouchableOpacity>

                {device?.device_id ? (
                  <TouchableOpacity
                    className="mt-3 rounded-xl py-3 items-center border border-red-200 bg-red-50"
                    onPress={handleRemoveDevice}
                    disabled={isRemovingDevice}
                  >
                    <Text className="font-semibold text-red-600">
                      {isRemovingDevice ? t('common.loading') : t('system.removeDeviceAction')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenWrapper>
  );
};
