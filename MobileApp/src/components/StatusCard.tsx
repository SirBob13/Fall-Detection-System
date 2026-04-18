import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Device, Prediction } from '../types';
import { useLanguage } from '../components/LanguageProvider';
import { getDeviceConnectionState, isDeviceOnline } from '../utils/deviceStatus';

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
  const deviceOnline = isDeviceOnline(device);
  const connectionState = getDeviceConnectionState(device);

  const getStatusColor = () => {
    if (!device) return '#9E9E9E'; // Gray
    if (!deviceOnline) return '#F44336'; // Red
    if (device.battery_level && device.battery_level < 20) return '#FF9800'; // Orange
    return '#4CAF50'; // Green
  };

  const getStatusText = () => {
    if (!device) return t('system.offline');
    if (connectionState !== 'connected') return t('system.disconnected');
    if (device.battery_level && device.battery_level < 20) return t('system.lowBattery');
    return t('system.connected');
  };

  const sectionSpacing = compact ? 12 : 20;
  const cardPadding = compact ? 16 : 20;

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
              {device.device_id || 'Smart Device'}
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
                {device.last_seen
                  ? new Date(device.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '--'}
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
      {(!device || (!deviceOnline && onConnect)) && (
        <View className="items-center pt-2">
          {!device && (
            <>
              <MaterialCommunityIcons name="devices" size={40} color="#E0E0E0" />
              <Text className="text-sm font-medium text-gray-400 mt-2">{t('system.noDevice')}</Text>
            </>
          )}
          <TouchableOpacity
            onPress={onConnect}
            disabled={isConnecting}
            className={`mt-4 w-full py-3 rounded-xl items-center ${
              !device ? 'bg-blue-600' : 'bg-orange-500'
            }`}
          >
            <Text className="text-white font-bold">
              {isConnecting ? t('system.connecting') : device ? t('system.reconnect') : t('system.connectAction')}
            </Text>
          </TouchableOpacity>
        </View>
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