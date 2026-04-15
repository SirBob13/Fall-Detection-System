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
  compact?: boolean;
}

export const StatusCard: React.FC<StatusCardProps> = ({ 
  device, 
  lastPrediction, 
  onRefresh,
  onConnect,
  isConnecting = false,
  compact = false,
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

  const sectionSpacing = compact ? 18 : 24;
  const cardPadding = compact ? 18 : 20;
  const refreshSize = compact ? 18 : 20;
  const deviceIconSize = compact ? 18 : 20;
  const predictionPadding = compact ? 14 : 12;

  return (
    <View
      className="bg-white dark:bg-darkTheme-surface rounded-2xl shadow-lg border border-lightGray dark:border-darkTheme-border"
      style={{ padding: cardPadding }}
    >
      {/* Header */}
      <View className="flex-row justify-between items-center mb-4">
        <Text
          className="font-bold text-dark dark:text-darkTheme-text"
          style={{ fontSize: compact ? 18 : 20 }}
        >
          {t('home.systemStatus')}
        </Text>
        <TouchableOpacity 
          onPress={onRefresh}
          className="rounded-full bg-blue-50 active:opacity-70"
          style={{ padding: compact ? 10 : 8 }}
        >
          <MaterialCommunityIcons name="refresh" size={refreshSize} color="#2196F3" />
        </TouchableOpacity>
      </View>

      {/* Status Indicator */}
      <View className="flex-row items-center" style={{ marginBottom: sectionSpacing }}>
        <View className={`w-4 h-4 rounded-full mr-3 ${getStatusColor()}`} />
        <Text className="text-base font-semibold text-dark dark:text-darkTheme-text">{getStatusText()}</Text>
        <Text className="text-sm text-gray dark:text-darkTheme-muted ml-2">
          • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Device Info */}
      {device && (
        <View style={{ marginBottom: sectionSpacing }}>
          <View className="flex-row items-center mb-3">
            <MaterialCommunityIcons name="watch" size={deviceIconSize} color="#757575" />
            <Text className="text-base text-dark dark:text-darkTheme-text ml-2">{device.device_id || 'Smart Device'}</Text>
            <View className="flex-1 items-end">
              <Text className="text-xs text-gray dark:text-darkTheme-muted">{device.device_id}</Text>
            </View>
          </View>

          <View
            className="flex-row justify-between bg-light dark:bg-darkTheme-background rounded-xl"
            style={{ paddingHorizontal: compact ? 10 : 12, paddingVertical: compact ? 12 : 12 }}
          >
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
        <View className="bg-blue-50 rounded-xl" style={{ padding: predictionPadding }}>
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
        <View className="items-center" style={{ paddingVertical: compact ? 14 : 16 }}>
          <MaterialCommunityIcons name="devices" size={compact ? 34 : 40} color="#BDBDBD" />
          <Text className="text-base text-gray dark:text-darkTheme-muted mt-3">{t('system.noDevice')}</Text>
          <Text className="text-sm text-lightGray dark:text-darkTheme-muted mt-1">{t('system.connectDevice')}</Text>
          {onConnect && (
            <TouchableOpacity
              onPress={onConnect}
              className="mt-4 px-4 bg-primary rounded-full"
              style={{ minWidth: compact ? 146 : 156, paddingVertical: compact ? 10 : 8 }}
              activeOpacity={0.8}
              disabled={isConnecting}
            >
              <Text className="text-white text-sm font-semibold text-center">
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
            className="px-4 bg-warning rounded-full"
            style={{ minWidth: compact ? 146 : 156, paddingVertical: compact ? 10 : 8 }}
            activeOpacity={0.8}
            disabled={isConnecting}
          >
            <Text className="text-white text-sm font-semibold text-center">
              {isConnecting ? t('system.connecting') : t('system.reconnect')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};
