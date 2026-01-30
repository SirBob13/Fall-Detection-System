import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../utils/constants';
import { Device, Prediction } from '../types';
import { useLanguage } from './LanguageProvider';

interface StatusCardProps {
  device: Device | null;
  lastPrediction: Prediction | null;
  onRefresh?: () => void;
}

export const StatusCard: React.FC<StatusCardProps> = ({
  device,
  lastPrediction,
  onRefresh,
}) => {
  const { t } = useLanguage();
  
  const getConnectionStatus = () => {
    if (!device) return { text: t('system.disconnected'), color: COLORS.danger, icon: 'wifi-off' };
    if (!device.is_connected) return { text: t('system.disconnected'), color: COLORS.danger, icon: 'wifi-off' };
    return { text: t('system.connected'), color: COLORS.success, icon: 'wifi' };
  };

  const getBatteryStatus = () => {
    if (!device || !device.battery_level) return { text: t('common.unknown'), color: COLORS.gray };
    if (device.battery_level < 20) return { text: t('system.low'), color: COLORS.danger };
    if (device.battery_level < 50) return { text: t('system.medium'), color: COLORS.warning };
    return { text: t('system.good'), color: COLORS.success };
  };

  const getFallRisk = () => {
    if (!lastPrediction) return { text: t('common.unknown'), color: COLORS.gray, icon: 'help' };
    
    if (lastPrediction.fall_now_prediction) {
      return { text: t('system.highRisk'), color: COLORS.danger, icon: 'dangerous' };
    }
    
    if (lastPrediction.fall_soon_prediction) {
      const riskLevel = lastPrediction.fall_soon_probability * 100;
      if (riskLevel > 70) return { text: t('system.mediumRisk'), color: COLORS.warning, icon: 'warning' };
      if (riskLevel > 30) return { text: t('system.lowRisk'), color: COLORS.info, icon: 'info' };
    }
    
    return { text: t('system.safe'), color: COLORS.success, icon: 'verified-user' };
  };

  const connectionStatus = getConnectionStatus();
  const batteryStatus = getBatteryStatus();
  const fallRisk = getFallRisk();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('home.status')}</Text>
        {onRefresh && (
          <TouchableOpacity onPress={onRefresh} style={styles.refreshButton}>
            <MaterialIcons name="refresh" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        )}
      </View>
      
      <View style={styles.grid}>
        {/* اتصال الجهاز */}
        <View style={styles.statusItem}>
          <View style={[styles.iconContainer, { backgroundColor: connectionStatus.color + '20' }]}>
            <MaterialIcons name={connectionStatus.icon} size={24} color={connectionStatus.color} />
          </View>
          <Text style={styles.statusLabel}>{t('home.deviceConnected').split(' ')[0]}</Text>
          <Text style={[styles.statusValue, { color: connectionStatus.color }]}>
            {connectionStatus.text}
          </Text>
          {device && (
            <Text style={styles.statusSubtext}>
              {device.device_id}
            </Text>
          )}
        </View>
        
        {/* حالة البطارية */}
        <View style={styles.statusItem}>
          <View style={[styles.iconContainer, { backgroundColor: batteryStatus.color + '20' }]}>
            <MaterialIcons name="battery-full" size={24} color={batteryStatus.color} />
          </View>
          <Text style={styles.statusLabel}>{t('home.battery')}</Text>
          <Text style={[styles.statusValue, { color: batteryStatus.color }]}>
            {batteryStatus.text}
          </Text>
          {device?.battery_level && (
            <Text style={styles.statusSubtext}>
              {device.battery_level.toFixed(0)}%
            </Text>
          )}
        </View>
        
        {/* خطر السقوط */}
        <View style={styles.statusItem}>
          <View style={[styles.iconContainer, { backgroundColor: fallRisk.color + '20' }]}>
            <MaterialIcons name={fallRisk.icon} size={24} color={fallRisk.color} />
          </View>
          <Text style={styles.statusLabel}>{t('home.fallRisk')}</Text>
          <Text style={[styles.statusValue, { color: fallRisk.color }]}>
            {fallRisk.text}
          </Text>
          {lastPrediction?.fall_soon_probability && (
            <Text style={styles.statusSubtext}>
              {lastPrediction.fall_soon_probability.toFixed(1)}%
            </Text>
          )}
        </View>
      </View>
      
      {lastPrediction?.fall_now_prediction && (
        <View style={[styles.alertBanner, { backgroundColor: COLORS.danger + '20' }]}>
          <MaterialIcons name="warning" size={20} color={COLORS.danger} />
          <Text style={[styles.alertText, { color: COLORS.danger }]}>
            {t('alerts.fallDetected')} {new Date(lastPrediction.timestamp).toLocaleTimeString('ar-EG')}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    margin: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  refreshButton: {
    padding: 8,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusItem: {
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 12,
    color: COLORS.gray,
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  statusSubtext: {
    fontSize: 12,
    color: COLORS.gray,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  alertText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
});