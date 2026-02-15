import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { useLanguage } from '../components/LanguageProvider';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { StatusCard } from '../components/StatusCard';
import { EmergencyButton } from '../components/EmergencyButton';
import { AlertCard } from '../components/AlertCard';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { notificationService } from '../services/notifications';
import { authService } from '../services/auth.service';
import { bluetoothService, ScannedDevice, isBluetoothSupported } from '../services/bluetooth.service';
import { deviceService } from '../services/device.service';
import { User, Device, Alert as AlertType, Prediction, VitalData } from '../types';
import { useNavigation } from '@react-navigation/native';


export const HomeScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [lastPrediction, setLastPrediction] = useState<Prediction | null>(null);
  const [latestVitals, setLatestVitals] = useState<VitalData | null>(null);
  const [monitoredUser, setMonitoredUser] = useState<User | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [pairModalVisible, setPairModalVisible] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<ScannedDevice[]>([]);
  const [manualDeviceId, setManualDeviceId] = useState('');
  const [isConnectingDevice, setIsConnectingDevice] = useState(false);
  
  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      checkForNewAlerts();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

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
      const storedMonitoredUser = await storageService.getMonitoredUser();

      setUser(storedUser);
      setMonitoredUser(storedMonitoredUser);
      if (normalizedSessionUser) {
        await storageService.saveUser(normalizedSessionUser);
      }
      setDevice(storedDevice);
      
      // If there is a user, try to load data
      const activeUser = storedMonitoredUser || storedUser;
      if (activeUser) {
        try {
          const alertsResponse = await apiService.getUserAlerts(activeUser.id, 5);
          if (alertsResponse.success) {
            setAlerts(alertsResponse.data || []);
            setConnectionError(false);
          } else {
            setConnectionError(true);
          }

          const deviceResponse = await apiService.getUserDevice(activeUser.id);
          if (deviceResponse.success && deviceResponse.data) {
            setDevice(deviceResponse.data);
            await storageService.saveDevice(deviceResponse.data);
          }

          const predictionResponse = await apiService.getUserPredictions(activeUser.id, 1);
          if (predictionResponse.success && predictionResponse.data && predictionResponse.data.length > 0) {
            setLastPrediction(predictionResponse.data[0]);
          }

          const vitalsResponse = await apiService.getUserVitals(activeUser.id, 1);
          if (vitalsResponse.success && vitalsResponse.data && vitalsResponse.data.length > 0) {
            setLatestVitals(vitalsResponse.data[0]);
          } else {
            setLatestVitals(null);
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

  const checkForNewAlerts = async () => {
    const activeUser = monitoredUser || user;
    if (!activeUser) return;

    try {
      const alertsResponse = await apiService.getUserAlerts(activeUser.id, 5);
      if (alertsResponse.success && alertsResponse.data) {
        const newAlerts = alertsResponse.data.filter(
          (newAlert) => !alerts.some((existingAlert) => existingAlert.id === newAlert.id)
        );

        newAlerts.forEach((alert) => {
          if (alert.status === 'pending' || alert.status === 'sent') {
            notificationService.sendFallAlert(alert);
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

  const handleEmergencyPress = async () => {
    if (!user) {
      RNAlert.alert(t('common.error'), `${t('auth.login.title')} ${t('common.required')}`);
      return;
    }

    try {
      RNAlert.alert(
        t('emergency.sosButton'),
        `${t('emergency.sosSending')}?`,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.send'),
            onPress: () => {
              RNAlert.alert(
                t('success.sent'),
                `${t('emergency.sosSending')} ${t('success.sent')}`,
                [{ text: t('common.ok') }]
              );
              
              Vibration.vibrate([500, 500, 500]);
              loadData();
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

  const handleViewAllAlerts = () => {
    // Navigate to alerts screen
    // navigation.navigate('Alerts');
  };

  const handleOpenDeviceManagement = () => {
    navigation.navigate('Settings', { screen: 'DeviceManagement' });
  };

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
      const devices = await bluetoothService.scan(8000);
      setScanResults(devices);
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
    try {
      const connected = await deviceService.connectDeviceToUser({
        userId: user.id,
        deviceId,
        connectBle: true,
      });

      if (connected) {
        setDevice(connected);
        setPairModalVisible(false);
        setManualDeviceId('');
        setScanResults([]);
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

  return (
    <ScreenWrapper>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 8 }}
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
        {/* Connection Error Banner */}
        {connectionError && (
          <View className="mx-4 my-3 bg-red-50 border border-danger rounded-xl p-3">
            <View className="flex-row items-center">
              <View className="w-3 h-3 rounded-full bg-danger mr-2" />
              <Text className="text-sm font-medium text-dark flex-1">
                {t('errors.connection')}
              </Text>
            </View>
            <Text className="text-xs text-gray mt-1">
              {t('errors.connectionDesc')}
            </Text>
          </View>
        )}

        {/* Monitoring Context */}
        {monitoredUser && user && monitoredUser.id !== user.id && (
          <View className="mx-4 mt-2 mb-2 bg-purple-50 border border-purple-100 rounded-xl p-3">
            <Text className="text-xs text-gray">{t('care.monitoring')}</Text>
            <Text className="text-sm font-semibold text-dark mt-1">{monitoredUser.name}</Text>
          </View>
        )}

        {/* System Status Card */}
        <View className="mx-4">
          <StatusCard
            device={device}
            lastPrediction={lastPrediction}
            onRefresh={loadData}
            onConnect={openPairModal}
            isConnecting={isConnectingDevice}
          />
          <TouchableOpacity
            onPress={handleOpenDeviceManagement}
            className="mt-3 bg-blue-50 border border-blue-100 rounded-xl py-3 items-center"
            activeOpacity={0.8}
          >
            <Text className="text-primary font-semibold text-sm">
              {t('settings.deviceManagement')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Vital Signs */}
        <View className="mx-4 mt-6">
          <Text className="text-lg font-bold text-dark mb-3">{t('vitals.title')}</Text>
          <View className="bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            {latestVitals ? (
              <>
                <View className="flex-row justify-between mb-3">
                  <Text className="text-sm text-gray">{t('vitals.heartRate')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {latestVitals.heart_rate ?? '--'} {t('vitals.bpm')}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-3">
                  <Text className="text-sm text-gray">{t('vitals.bloodPressure')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {latestVitals.blood_pressure_systolic && latestVitals.blood_pressure_diastolic
                      ? `${latestVitals.blood_pressure_systolic}/${latestVitals.blood_pressure_diastolic}`
                      : '--'}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-3">
                  <Text className="text-sm text-gray">{t('vitals.oxygen')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {latestVitals.oxygen_saturation !== undefined && latestVitals.oxygen_saturation !== null
                      ? `${latestVitals.oxygen_saturation} ${t('vitals.percent')}`
                      : '--'}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-gray">{t('vitals.temperature')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {latestVitals.body_temperature !== undefined && latestVitals.body_temperature !== null
                      ? `${latestVitals.body_temperature} ${t('vitals.celsius')}`
                      : '--'}
                  </Text>
                </View>
              </>
            ) : (
              <Text className="text-sm text-gray">{t('vitals.noData')}</Text>
            )}
          </View>
        </View>

        {/* Emergency Button */}
        <View className="my-6 items-center">
          <EmergencyButton
            onPress={handleEmergencyPress}
            onLongPress={handleEmergencyLongPress}
            disabled={!user}
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
                  />
                </View>
              ))}
            </View>
          ) : (
            <View className="items-center py-10">
              <View className="w-16 h-16 rounded-full bg-green-50 justify-center items-center mb-3">
                <Text className="text-3xl">✅</Text>
              </View>
              <Text className="text-lg text-gray mb-2">
                {t('alerts.noAlerts')}
              </Text>
              <Text className="text-sm text-lightGray">
                {t('home.everythingOk')}
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
          
          <View className="flex-row justify-between">
            <View className="bg-white rounded-xl p-4 flex-1 mr-2 shadow-sm border border-lightGray">
              <Text className="text-xs text-gray mb-1">{t('home.todayAlerts')}</Text>
              <Text className="text-2xl font-bold text-dark">{alerts.length}</Text>
              <View className="flex-row items-center mt-1">
                <Text className="text-xs text-success">↓ 20%</Text>
                <Text className="text-xs text-gray ml-1">{t('home.fromYesterday')}</Text>
              </View>
            </View>
            
            <View className="bg-white rounded-xl p-4 flex-1 ml-2 shadow-sm border border-lightGray">
              <Text className="text-xs text-gray mb-1">{t('home.responseTime')}</Text>
              <Text className="text-2xl font-bold text-dark">45s</Text>
              <View className="flex-row items-center mt-1">
                <Text className="text-xs text-success">↑ 15%</Text>
                <Text className="text-xs text-gray ml-1">{t('home.faster')}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Bottom Spacing */}
        <View className="h-20" />
      </ScrollView>

      {/* Pair Device Modal */}
      <Modal
        visible={pairModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPairModalVisible(false)}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-3xl p-5">
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-lg font-bold text-dark">{t('system.connectDevice')}</Text>
              <TouchableOpacity onPress={() => setPairModalVisible(false)}>
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
                    className="border border-lightGray rounded-xl p-3 mb-2"
                    onPress={() => linkDeviceToUser(item.id)}
                    disabled={isConnectingDevice}
                  >
                    <Text className="text-sm font-semibold text-dark">{item.name}</Text>
                    <Text className="text-xs text-gray mt-1">{item.id}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

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
                className="mt-3 bg-primary rounded-xl py-3 items-center"
                onPress={() => linkDeviceToUser(manualDeviceId.trim())}
                disabled={isConnectingDevice}
              >
                <Text className="text-white font-semibold">
                  {isConnectingDevice ? t('system.connecting') : t('system.connectAction')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenWrapper>
  );
};
