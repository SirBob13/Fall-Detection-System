import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Device, Prediction } from '../types';
import { useLanguage } from '../components/LanguageProvider';
import { getDeviceOperationalStatus, getDeviceStatusLabel } from '../utils/deviceStatus';

interface StatusCardProps {
  device: Device | null;
  lastPrediction: Prediction | null;
  onRefresh: () => void;
  onConnect?: () => void;
  onRemoveDevice?: () => void;
  isRemovingDevice?: boolean;
  isConnecting?: boolean;
  compact?: boolean;
  canManageDevice?: boolean;
}

export const StatusCard: React.FC<StatusCardProps> = ({ 
  device, 
  lastPrediction, 
  onRefresh,
  onConnect,
  onRemoveDevice,
  isRemovingDevice = false,
  isConnecting = false,
  compact = false,
  canManageDevice = true,
}) => {
  const { t } = useLanguage();
  const deviceStatus = getDeviceOperationalStatus(device);
  const deviceStatusLabel = getDeviceStatusLabel(device);
  const deviceConnected = deviceStatus === 'active' || deviceStatus === 'connected_no_data';

  const formatRelativeTime = (dateString?: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return null;

    const diffMs = Date.now() - date.getTime();
    const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));

    if (diffSeconds < 60) return t('datetime.secondsAgo', { count: diffSeconds || 1 });

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return t('datetime.minutesAgo', { count: diffMinutes });

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return t('datetime.hoursAgo', { count: diffHours });

    return t('datetime.daysAgo', { count: Math.floor(diffHours / 24) });
  };

  const getStatusColor = () => {
    if (!device) return '#9E9E9E'; // Gray
    if (deviceStatus === 'active') return '#4CAF50'; // Green
    if (deviceStatus === 'connected_no_data') return '#FF9800'; // Orange
    if (deviceStatus === 'archived') return '#9E9E9E'; // Gray
    return '#F44336'; // Red
  };

  const getStatusDetail = () => {
    if (!device) return null;
    if (deviceStatus === 'active' && device.latest_data_at) {
      return `${t('dashboard.lastSync')}: ${formatRelativeTime(device.latest_data_at)}`;
    }
    if (deviceStatus === 'connected_no_data' && device.last_seen) {
      return `${t('system.lastSeen')}: ${formatRelativeTime(device.last_seen)}`;
    }
    return null;
  };

  const getStatusText = () => {
    if (!device) return t('system.offline');
    if (deviceStatus === 'archived') return t('common.inactive');
    if (deviceStatus === 'active' && device.battery_level && device.battery_level < 20) return t('system.lowBattery');
    return deviceStatusLabel;
  };

  const sectionSpacing = compact ? 12 : 20;
  const cardPadding = compact ? 16 : 20;
  const showCompactEmptyState = !device && !lastPrediction;

  return (
    <View
      style={[styles.card, { padding: cardPadding }]}
      className="bg-white rounded-3xl shadow-sm border border-gray-100"
    >
      {/* Header */}
      <View className="flex-row justify-between items-center mb-4">
        <Text
          className="font-bold text-gray-900"
          style={{ fontSize: compact ? 18 : 20 }}
        >
          {t('home.systemStatus')}
        </Text>
        <TouchableOpacity 
          onPress={onRefresh}
          className="rounded-full bg-blue-50 p-2 active:opacity-70"
        >
          <MaterialCommunityIcons name="refresh" size={compact ? 18 : 20} color="#2196F3" />
        </TouchableOpacity>
      </View>

      {/* Status Indicator */}
      <View className="flex-row items-center" style={{ marginBottom: sectionSpacing }}>
        <View 
          className="w-3.5 h-3.5 rounded-full mr-2" 
          style={{ backgroundColor: getStatusColor() }} 
        />
        <Text className="text-base font-bold text-gray-800">
          {getStatusText()}
        </Text>
        {getStatusDetail() ? (
          <Text className="text-xs text-gray-400 ml-2">{getStatusDetail()}</Text>
        ) : null}
        <Text className="text-xs text-gray-400 ml-2">
          • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Device Info */}
      {device && (
        <View style={{ marginBottom: sectionSpacing }}>
          <View className="flex-row items-center mb-3">
            <MaterialCommunityIcons name="watch" size={compact ? 18 : 20} color="#757575" />
            <Text
              className="text-sm font-medium text-gray-700 flex-1 ml-2"
              numberOfLines={1}
            >
              {device.device_id || t('system.defaultDevice')}
            </Text>
            {device.mac_address ? (
              <Text className="text-[10px] text-gray-400 uppercase tracking-tighter">
                {device.mac_address}
              </Text>
            ) : null}
          </View>

          {/* Device Stats Grid */}
          <View className="flex-row justify-between bg-gray-50 rounded-2xl border border-gray-100 p-3">
            <View className="items-center flex-1">
              <MaterialCommunityIcons name="battery" size={14} color="#757575" />
              <Text className="text-[10px] text-gray-500 mt-1 uppercase">{t('home.battery')}</Text>
              <Text className="text-sm font-bold text-gray-900">{device.battery_level?.toFixed(0) || '--'}%</Text>
            </View>

            <View className="items-center flex-1 border-x border-gray-200">
              <MaterialCommunityIcons name="chip" size={14} color="#757575" />
              <Text className="text-[10px] text-gray-500 mt-1 uppercase">{t('system.firmware')}</Text>
              <Text className="text-sm font-bold text-gray-900">{device.firmware_version || '--'}</Text>
            </View>

            <View className="items-center flex-1">
              <MaterialCommunityIcons name="update" size={14} color="#757575" />
              <Text className="text-[10px] text-gray-500 mt-1 uppercase">{t('system.lastSeen')}</Text>
              <Text className="text-sm font-bold text-gray-900">
                {formatRelativeTime(device.last_seen) || '--'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Last Prediction Section */}
      {lastPrediction && (
        <View className="bg-blue-50/50 rounded-2xl p-4 border border-blue-100">
          <View className="flex-row items-center mb-3">
            <MaterialCommunityIcons name="chart-bell-curve" size={18} color="#2196F3" />
            <Text className="text-sm font-bold text-blue-800 ml-2">
              {t('home.lastPrediction')}
            </Text>
          </View>
          
          <View className="space-y-2">
            <PredictionRow 
              label={t('home.fallNow')} 
              value={`${((lastPrediction.fall_now_probability || 0) * 100).toFixed(1)}%`} 
            />
            <PredictionRow 
              label={t('home.fallSoon')} 
              value={`${((lastPrediction.fall_soon_probability || 0) * 100).toFixed(1)}%`} 
            />
            <PredictionRow 
              label={t('home.confidence')} 
              value={`${((lastPrediction.confidence_score || 0) * 100).toFixed(1)}%`} 
              isLast
            />
          </View>
        </View>
      )}

      {/* Connection Actions */}
      {canManageDevice && (!device || (!deviceConnected && onConnect)) && (
        <View className={`items-center ${showCompactEmptyState ? 'pt-1' : 'pt-2'}`}>
          {!device && (
            <>
              <MaterialCommunityIcons
                name="devices"
                size={showCompactEmptyState ? 30 : 40}
                color="#D1D5DB"
              />
              <Text className="text-sm font-medium text-gray-500 mt-2">{t('system.noDevice')}</Text>
              <Text className="text-xs text-gray-400 mt-1 text-center px-6">
                {t('system.noDeviceHint')}
              </Text>
              <View className="mt-3 self-stretch px-6">
                <Text className="text-[11px] text-gray-400 text-center">{t('system.noDeviceStep1')}</Text>
                <Text className="text-[11px] text-gray-400 text-center mt-1">{t('system.noDeviceStep2')}</Text>
                <Text className="text-[11px] text-gray-400 text-center mt-1">{t('system.noDeviceStep3')}</Text>
              </View>
            </>
          )}
          <TouchableOpacity
            onPress={onConnect}
            disabled={isConnecting}
            className={`mt-4 w-full py-3 rounded-xl items-center ${
              !device ? 'bg-blue-600' : 'bg-orange-500'
            }`}
            style={{
              marginTop: showCompactEmptyState ? 14 : 16,
              paddingVertical: showCompactEmptyState ? 12 : 14,
            }}
          >
            <Text className="text-white font-bold">
              {isConnecting ? t('system.connecting') : device ? t('system.reconnect') : t('system.connectAction')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {canManageDevice && device && onConnect && deviceConnected && (
        <TouchableOpacity
          onPress={onConnect}
          disabled={isConnecting}
          className="mt-3 w-full py-3 rounded-xl items-center border border-blue-200 bg-blue-50"
        >
          <Text className="font-bold text-primary">
            {isConnecting ? t('system.connecting') : t('system.addDeviceAction')}
          </Text>
        </TouchableOpacity>
      )}

      {canManageDevice && device && onRemoveDevice && (
        <TouchableOpacity
          onPress={onRemoveDevice}
          disabled={isRemovingDevice}
          className="mt-3 w-full py-3 rounded-xl items-center border border-red-200 bg-red-50"
        >
          <Text className="font-bold text-red-600">
            {isRemovingDevice ? t('common.loading') : t('system.removeDeviceAction')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// مكون داخلي لتبسيط الصفوف
const PredictionRow = ({ label, value, isLast = false }: { label: string, value: string, isLast?: boolean }) => (
  <View className={`flex-row justify-between items-center ${isLast ? '' : 'mb-2'}`}>
    <Text className="text-xs text-gray-600 font-medium">{label}</Text>
    <Text className="text-xs font-bold text-gray-900">{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 2,
  }
});
