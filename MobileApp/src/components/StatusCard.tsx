import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Device, Prediction } from '../types';
import { useLanguage } from '../components/LanguageProvider';

interface StatusCardProps {
  device: Device | null;
  lastPrediction: Prediction | null;
  onRefresh: () => void;
}

export const StatusCard: React.FC<StatusCardProps> = ({ 
  device, 
  lastPrediction, 
  onRefresh 
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
    <View className="bg-white rounded-2xl shadow-lg p-5 border border-lightGray">
      {/* Header */}
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-xl font-bold text-dark">{t('home.systemStatus')}</Text>
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
        <Text className="text-base font-semibold text-dark">{getStatusText()}</Text>
        <Text className="text-sm text-gray ml-2">
          • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Device Info */}
      {device && (
        <View className="mb-6">
          <View className="flex-row items-center mb-3">
            <MaterialCommunityIcons name="watch" size={20} color="#757575" />
            <Text className="text-base text-dark ml-2">{device.device_id || 'Smart Device'}</Text>
            <View className="flex-1 items-end">
              <Text className="text-xs text-gray">{device.device_id}</Text>
            </View>
          </View>

          <View className="flex-row justify-between bg-light rounded-xl p-3">
            <View className="items-center flex-1">
              <View className="flex-row items-center mb-1">
                <MaterialCommunityIcons name="battery" size={16} color="#757575" />
                <Text className="text-xs text-gray ml-1">{t('home.battery')}</Text>
              </View>
              <Text className="text-lg font-bold text-dark">
                {device.battery_level?.toFixed(0) || '--'}%
              </Text>
            </View>

            <View className="items-center flex-1 border-x border-lightGray">
              <View className="flex-row items-center mb-1">
                <MaterialCommunityIcons name="chip" size={16} color="#757575" />
                <Text className="text-xs text-gray ml-1">Firmware</Text>
              </View>
              <Text className="text-lg font-bold text-dark">
                {device.firmware_version || '--'}
              </Text>
            </View>

            <View className="items-center flex-1">
              <View className="flex-row items-center mb-1">
                <MaterialCommunityIcons name="update" size={16} color="#757575" />
                <Text className="text-xs text-gray ml-1">{t('system.lastSeen')}</Text>
              </View>
              <Text className="text-lg font-bold text-dark">
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
            <Text className="text-base font-semibold text-dark ml-2">
              {t('home.lastPrediction')}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray">Fall Now</Text>
            <Text className="text-sm font-semibold text-dark">
              {((lastPrediction.fall_now_probability || 0) * 100).toFixed(1)}%
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray">Fall Soon</Text>
            <Text className="text-sm font-semibold text-dark">
              {((lastPrediction.fall_soon_probability || 0) * 100).toFixed(1)}%
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray">{t('system.confidence')}</Text>
            <Text className="text-sm font-semibold text-dark">
              {((lastPrediction.confidence_score || 0) * 100).toFixed(1)}%
            </Text>
          </View>
        </View>
      )}

      {/* No Device Message */}
      {!device && (
        <View className="items-center py-4">
          <MaterialCommunityIcons name="devices" size={40} color="#BDBDBD" />
          <Text className="text-base text-gray mt-2">{t('system.noDevice')}</Text>
          <Text className="text-sm text-lightGray mt-1">{t('system.connectDevice')}</Text>
        </View>
      )}
    </View>
  );
};
