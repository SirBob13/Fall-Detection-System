import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Device, Prediction } from '../types';
import { useLanguage } from '../components/LanguageProvider';

interface StatusCardProps {
  device: Device | null;
  lastPrediction: Prediction | null;
  onRefresh: () => void;
  onConnect?: () => void;
  isConnecting?: boolean;
}

export const StatusCard: React.FC<StatusCardProps> = ({ 
  device, 
  lastPrediction, 
  onRefresh,
  onConnect,
  isConnecting = false
}) => {
  const { t } = useLanguage();

  const getStatusColor = () => {
    if (!device) return 'bg-gray';
    if (!device.is_connected) return 'bg-danger';
    if (device.battery_level && device.battery_level < 20) return 'bg-warning';
    return 'bg-success';
  };

  const getStatusText = () => {
    if (!device) return t('system.offline');
    if (!device.is_connected) return t('system.disconnected');
    if (device.battery_level && device.battery_level < 20) return t('system.lowBattery');
    return t('system.connected');
  };

  return (
    <View className="bg-white dark:bg-darkTheme-surface rounded-2xl shadow-lg p-5 border border-lightGray dark:border-darkTheme-border">
      {/* Header */}
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-xl font-bold text-dark dark:text-darkTheme-text">{t('home.systemStatus')}</Text>
        <TouchableOpacity 
          onPress={onRefresh}
          className="p-2 rounded-full bg-blue-50 active:opacity-70"
        >
          <MaterialCommunityIcons name="refresh" size={20} color="#2196F3" />
        </TouchableOpacity>
      </View>

      {/* Status Indicator */}
      <View className="flex-row items-center mb-6">
        <View className={`w-4 h-4 rounded-full mr-3 ${getStatusColor()}`} />
        <Text className="text-base font-semibold text-dark dark:text-darkTheme-text">{getStatusText()}</Text>
        <Text className="text-sm text-gray dark:text-darkTheme-muted ml-2">
          • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Device Info */}
      {device && (
        <View className="mb-6">
          <View className="flex-row items-center mb-3">
            <MaterialCommunityIcons name="watch" size={20} color="#757575" />
            <Text className="text-base text-dark dark:text-darkTheme-text ml-2">{device.device_id || 'Smart Device'}</Text>
            <View className="flex-1 items-end">
              <Text className="text-xs text-gray dark:text-darkTheme-muted">{device.device_id}</Text>
            </View>
          </View>

          <View className="flex-row justify-between bg-light dark:bg-darkTheme-background rounded-xl p-3">
            <View className="items-center flex-1">
              <View className="flex-row items-center mb-1">
                <MaterialCommunityIcons name="battery" size={16} color="#757575" />
                <Text className="text-xs text-gray dark:text-darkTheme-muted ml-1">{t('home.battery')}</Text>
              </View>
              <Text className="text-lg font-bold text-dark dark:text-darkTheme-text">
                {device.battery_level?.toFixed(0) || '--'}%
              </Text>
            </View>

            <View className="items-center flex-1 border-x border-lightGray dark:border-darkTheme-border">
              <View className="flex-row items-center mb-1">
                <MaterialCommunityIcons name="chip" size={16} color="#757575" />
                <Text className="text-xs text-gray dark:text-darkTheme-muted ml-1">{t('system.firmware')}</Text>
              </View>
              <Text className="text-lg font-bold text-dark dark:text-darkTheme-text">
                {device.firmware_version || '--'}
              </Text>
            </View>

            <View className="items-center flex-1">
              <View className="flex-row items-center mb-1">
                <MaterialCommunityIcons name="update" size={16} color="#757575" />
                <Text className="text-xs text-gray dark:text-darkTheme-muted ml-1">{t('system.lastSeen')}</Text>
              </View>
              <Text className="text-lg font-bold text-dark dark:text-darkTheme-text">
                {device.last_seen
                  ? new Date(device.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '--'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Last Prediction */}
      {lastPrediction && (
        <View className="bg-blue-50 rounded-xl p-3">
          <View className="flex-row items-center mb-2">
            <MaterialCommunityIcons name="chart-line" size={20} color="#2196F3" />
            <Text className="text-base font-semibold text-dark dark:text-darkTheme-text ml-2">
              {t('home.lastPrediction')}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray dark:text-darkTheme-muted">{t('home.fallNow')}</Text>
            <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text">
              {((lastPrediction.fall_now_probability || 0) * 100).toFixed(1)}%
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray dark:text-darkTheme-muted">{t('home.fallSoon')}</Text>
            <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text">
              {((lastPrediction.fall_soon_probability || 0) * 100).toFixed(1)}%
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray dark:text-darkTheme-muted">{t('system.confidence')}</Text>
            <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text">
              {((lastPrediction.confidence_score || 0) * 100).toFixed(1)}%
            </Text>
          </View>
        </View>
      )}

      {/* No Device Message */}
      {!device && (
        <View className="items-center py-4">
          <MaterialCommunityIcons name="devices" size={40} color="#BDBDBD" />
          <Text className="text-base text-gray dark:text-darkTheme-muted mt-2">{t('system.noDevice')}</Text>
          <Text className="text-sm text-lightGray dark:text-darkTheme-muted mt-1">{t('system.connectDevice')}</Text>
          {onConnect && (
            <TouchableOpacity
              onPress={onConnect}
              className="mt-3 px-4 py-2 bg-primary rounded-full"
              activeOpacity={0.8}
              disabled={isConnecting}
            >
              <Text className="text-white text-sm font-semibold">
                {isConnecting ? t('system.connecting') : t('system.connectAction')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Device disconnected */}
      {device && !device.is_connected && onConnect && (
        <View className="mt-2 items-center">
          <TouchableOpacity
            onPress={onConnect}
            className="px-4 py-2 bg-warning rounded-full"
            activeOpacity={0.8}
            disabled={isConnecting}
          >
            <Text className="text-white text-sm font-semibold">
              {isConnecting ? t('system.connecting') : t('system.reconnect')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};
