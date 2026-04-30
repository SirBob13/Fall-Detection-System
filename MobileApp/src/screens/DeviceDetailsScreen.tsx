import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ScreenHeader';
import { useLanguage } from '../components/LanguageProvider';
import { deviceService } from '../services/device.service';
import { apiService } from '../services/api';
import { Device } from '../types';
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

  useEffect(() => {
    loadLatestDevice();
  }, [route.params.device.device_id]);

  const loadLatestDevice = async () => {
    setLoading(true);
    try {
      const response = await apiService.getDevice(device.device_id);
      if (response.success && response.data) {
        setDevice(response.data);
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
    if (device.data_state === 'streaming') return t('system.dataStreaming');
    if (device.data_state === 'stale') return t('system.dataStale');
    return t('system.dataUnavailable');
  };

  const getDataStateDescription = () => {
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
                <Text className="text-lg font-bold text-gray-900">{device.device_id}</Text>
                <Text className="text-xs text-gray-500 mt-1">{t('system.deviceIdLabel')}</Text>
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
