import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ScreenHeader';
import { useLanguage } from '../components/LanguageProvider';
import { deviceService } from '../services/device.service';
import { apiService } from '../services/api';
import { realtimeService } from '../services/realtime.service';
import { Device, VitalsStatus } from '../types';
import type { SettingsStackParamList } from '../navigation/AppNavigator';
import { getDeviceOperationalStatus, getDeviceStatusLabel } from '../utils/deviceStatus';

type DeviceDetailsRouteProp = RouteProp<SettingsStackParamList, 'DeviceDetails'>;

export const DeviceDetailsScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const route = useRoute<DeviceDetailsRouteProp>();
  const [device, setDevice] = useState<Device>(route.params.device);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [vitalsRequesting, setVitalsRequesting] = useState(false);
  const [vitalsStatus, setVitalsStatus] = useState<VitalsStatus | null>(null);
  const [lastValidVitals, setLastValidVitals] = useState<{ heartRate?: number; spo2?: number }>({});

  const formatDeviceId = (deviceId?: string | null) => {
    if (!deviceId) return '--';
    if (deviceId.length <= 16) return deviceId;
    return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
  };

  useEffect(() => {
    loadLatestDevice();
  }, [route.params.device.device_id]);

  useEffect(() => {
    return realtimeService.subscribe('vitals_status', (event) => {
      const payload = event.payload as VitalsStatus | undefined;
      if (!payload || payload.device_id !== device.device_id) return;

      setVitalsStatus(payload);
      setVitalsRequesting(payload.state === 'requested' || payload.state === 'measuring');
      setLastValidVitals((current) => ({
        heartRate: payload.heart_rate_valid && payload.heart_rate ? payload.heart_rate : current.heartRate,
        spo2: payload.spo2_valid && payload.spo2 ? payload.spo2 : current.spo2,
      }));
    });
  }, [device.device_id]);

  const loadLatestDevice = async () => {
    setLoading(true);
    try {
      const [response, vitalsResponse] = await Promise.all([
        apiService.getDevice(device.device_id),
        apiService.getLatestDeviceVitals(device.device_id),
      ]);
      if (response.success && response.data) {
        setDevice(response.data);
      }
      if (vitalsResponse.success && vitalsResponse.data) {
        const latest = vitalsResponse.data;
        setVitalsStatus(latest);
        setLastValidVitals((current) => ({
          heartRate: latest.heart_rate_valid && latest.heart_rate ? latest.heart_rate : current.heartRate,
          spo2: latest.spo2_valid && latest.spo2 ? latest.spo2 : current.spo2,
        }));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveDevice = () => {
    Alert.alert(t('system.removeDeviceTitle'), t('system.removeDeviceBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('system.removeDeviceAction'),
        style: 'destructive',
        onPress: async () => {
          setRemoving(true);
          try {
            const removed = await deviceService.removeDevice(device.device_id, device.user_id);
            if (!removed) {
              Alert.alert(t('common.error'), t('system.removeDeviceFailed'));
              return;
            }

            Alert.alert(t('common.success'), t('system.deviceRemoved'));
            navigation.goBack();
          } finally {
            setRemoving(false);
          }
        },
      },
    ]);
  };

  const handleMeasureVitals = async () => {
    setVitalsRequesting(true);
    try {
      const response = await apiService.startDeviceVitals(device.device_id, 60000);
      if (!response.success || !response.data) {
        Alert.alert(t('common.error'), response.message || 'Device is offline or cannot start vitals measurement.');
        setVitalsRequesting(false);
        return;
      }
      setVitalsStatus(response.data);
    } finally {
      setVitalsRequesting(false);
    }
  };

  const isMeasuringVitals = vitalsStatus?.state === 'requested' || vitalsStatus?.state === 'measuring';
  const vitalsProgress = Math.max(0, Math.min(100, Math.round(vitalsStatus?.progress_percent ?? 0)));
  const currentHeartRate = vitalsStatus?.heart_rate_valid ? vitalsStatus?.heart_rate : lastValidVitals.heartRate;
  const currentSpo2 = vitalsStatus?.spo2_valid ? vitalsStatus?.spo2 : lastValidVitals.spo2;
  const vitalsHint = vitalsStatus?.finger_detected
    ? vitalsStatus?.signal_status || 'Measuring...'
    : isMeasuringVitals
    ? 'Place finger properly'
    : vitalsStatus?.state === 'complete'
    ? 'Measurement complete'
    : 'Press Measure Vitals to start';

  const isOnlineLike = ['active', 'connected_no_data'].includes(getDeviceOperationalStatus(device));
  const formatRelativeTime = (dateString?: string | null) => {
    if (!dateString) return '--';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '--';

    const diffMs = Date.now() - date.getTime();
    const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSeconds < 60) return t('datetime.secondsAgo', { count: diffSeconds || 1 });

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return t('datetime.minutesAgo', { count: diffMinutes });

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return t('datetime.hoursAgo', { count: diffHours });

    return t('datetime.daysAgo', { count: Math.floor(diffHours / 24) });
  };

  const getDataStateLabel = () => {
    if (device.ai_warmup) return t('system.aiWarmup');
    if (device.data_state === 'streaming') return t('system.dataStreaming');
    if (device.data_state === 'stale') return t('system.dataStale');
    return t('system.dataUnavailable');
  };

  const getDataStateDescription = () => {
    if (device.ai_warmup) {
      const count = device.ai_samples_collected ?? 0;
      const min = device.ai_min_samples_for_alert ?? 0;
      return t('system.aiWarmupDesc', { count, min });
    }
    if (device.data_state === 'streaming') return t('system.dataStreamingDesc');
    if (device.data_state === 'stale') return t('system.dataStaleDesc');
    return t('system.dataUnavailableDesc');
  };

  return (
    <ScrollView className="flex-1 bg-gray-50" showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title={t('system.deviceDetails')}
        subtitle={t('system.deviceDetailsSubtitle')}
        showBack
      />

      <View className="px-5 mt-4">
        <View className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1 pr-3">
              <View className="w-12 h-12 rounded-full bg-blue-50 items-center justify-center">
                <MaterialCommunityIcons name="watch" size={24} color="#6B7280" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-lg font-bold text-gray-900">{formatDeviceId(device.device_id)}</Text>
                <Text className="text-xs text-gray-500 mt-1">
                  {t('system.deviceIdLabel')}: {device.device_id}
                </Text>
              </View>
            </View>
            <View className={`px-3 py-1 rounded-full ${isOnlineLike ? 'bg-green-100' : 'bg-red-100'}`}>
              <Text className={`text-[10px] font-bold ${isOnlineLike ? 'text-green-700' : 'text-red-700'}`}>
                {getDeviceStatusLabel(device)}
              </Text>
            </View>
          </View>

          <View className="mt-5 space-y-3">
            <DetailRow
              icon="battery"
              label={t('home.battery')}
              value={typeof device.battery_level === 'number' ? `${device.battery_level}%` : '--'}
            />
            <DetailRow
              icon="clock-outline"
              label={t('system.lastSeen')}
              value={device.last_seen ? new Date(device.last_seen).toLocaleString() : '--'}
            />
            <DetailRow
              icon="tag-outline"
              label={t('system.version')}
              value={device.firmware_version || '--'}
            />
            <DetailRow
              icon="access-point"
              label={t('system.statusLabel')}
              value={getDeviceStatusLabel(device)}
            />
            <DetailRow
              icon="database"
              label={t('system.dataStatus')}
              value={getDataStateLabel()}
              description={getDataStateDescription()}
            />
            <DetailRow
              icon="update"
              label={t('dashboard.lastSync')}
              value={formatRelativeTime(device.latest_data_at || device.last_seen)}
              description={device.latest_data_at ? new Date(device.latest_data_at).toLocaleString() : undefined}
            />
            <DetailRow
              icon="bluetooth"
              label={t('system.macAddress')}
              value={device.mac_address || '--'}
            />
          </View>

          <TouchableOpacity
            className="mt-5 rounded-2xl bg-blue-50 border border-primary/20 py-3 items-center"
            onPress={loadLatestDevice}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#2196F3" />
            ) : (
              <Text className="text-sm font-semibold text-primary">{t('settings.refreshData')}</Text>
            )}
          </TouchableOpacity>

          <View className="mt-3 rounded-3xl bg-slate-900 px-4 py-4">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-xs font-semibold text-blue-100 uppercase">Vitals</Text>
                <Text className="text-lg font-bold text-white mt-1">
                  {isMeasuringVitals ? 'Measuring...' : 'Measure Vitals'}
                </Text>
              </View>
              <View className="w-11 h-11 rounded-full bg-white/10 items-center justify-center">
                <MaterialCommunityIcons name="heart-pulse" size={24} color="#FFFFFF" />
              </View>
            </View>

            <View className="flex-row mt-4 gap-3">
              <VitalsMiniCard label="HR" value={currentHeartRate ? `${Math.round(currentHeartRate)} bpm` : '--'} />
              <VitalsMiniCard label="SpO2" value={currentSpo2 ? `${Math.round(currentSpo2)}%` : '--'} />
            </View>

            <View className="mt-4 h-2 rounded-full bg-white/15 overflow-hidden">
              <View className="h-2 rounded-full bg-emerald-400" style={{ width: `${vitalsProgress}%` }} />
            </View>
            <Text className="text-xs text-blue-100 mt-2">
              {vitalsHint} {isMeasuringVitals ? `· ${vitalsProgress}%` : ''}
            </Text>

            <TouchableOpacity
              className={`mt-4 rounded-2xl py-3 items-center ${isMeasuringVitals || vitalsRequesting ? 'bg-white/20' : 'bg-emerald-400'}`}
              onPress={handleMeasureVitals}
              disabled={isMeasuringVitals || vitalsRequesting}
            >
              {vitalsRequesting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className={`text-sm font-bold ${isMeasuringVitals ? 'text-white' : 'text-slate-900'}`}>
                  {isMeasuringVitals ? 'Measuring...' : 'Measure Vitals'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            className="mt-3 rounded-2xl bg-red-50 border border-danger/20 py-3 items-center"
            onPress={handleRemoveDevice}
            disabled={removing}
          >
            {removing ? (
              <ActivityIndicator color="#DC2626" />
            ) : (
              <Text className="text-sm font-semibold text-danger">{t('system.removeDeviceAction')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const DetailRow = ({
  icon,
  label,
  value,
  description,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string;
  description?: string;
}) => (
  <View className="flex-row items-center bg-gray-50 rounded-2xl px-4 py-4">
    <MaterialCommunityIcons name={icon} size={20} color="#6B7280" />
    <View className="ml-3 flex-1">
      <Text className="text-xs font-semibold text-gray-500 uppercase">{label}</Text>
      <Text className="text-sm font-semibold text-gray-900 mt-1">{value}</Text>
      {description ? <Text className="text-xs text-gray-500 mt-1">{description}</Text> : null}
    </View>
  </View>
);

const VitalsMiniCard = ({ label, value }: { label: string; value: string }) => (
  <View className="flex-1 rounded-2xl bg-white/10 px-3 py-3">
    <Text className="text-[10px] font-semibold text-blue-100 uppercase">{label}</Text>
    <Text className="text-base font-bold text-white mt-1">{value}</Text>
  </View>
);
