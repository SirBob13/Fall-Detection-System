import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Alert } from '../types';
import { useLanguage } from '../components/LanguageProvider';
import { formatApiTime, parseApiDate } from '../utils/helpers';

interface AlertCardProps {
  alert: Alert;
  onAcknowledge?: () => void;
  onResolve?: () => void;
  onImFine?: () => void;
}

export const AlertCard: React.FC<AlertCardProps> = ({
  alert,
  onAcknowledge,
  onResolve,
  onImFine,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const { t } = useLanguage();

  // مصفوفات الألوان للتحكم الدقيق (Light Mode)
  const getSeverityColor = () => {
    switch (alert.severity) {
      case 'critical': return '#F44336';
      case 'high': return '#FF9800';
      case 'medium': return '#FFC107';
      case 'low': return '#4CAF50';
      default: return '#757575';
    }
  };

  const getStatusColor = () => {
    switch (alert.status) {
      case 'pending': return '#FF9800';
      case 'sent': return '#2196F3';
      case 'resolved': return '#4CAF50';
      case 'failed': return '#F44336';
      default: return '#757575';
    }
  };

  const getAlertIcon = () => {
    switch (alert.alert_type) {
      case 'fall':
      case 'fall_now': return 'run';
      case 'fall_risk': return 'alert-outline';
      case 'heart_rate': return 'heart-pulse';
      case 'blood_pressure': return 'heart-flash';
      case 'temperature': return 'thermometer';
      case 'battery': return 'battery-alert';
      default: return 'alert';
    }
  };

  const getAlertTypeLabel = () => {
    switch (alert.alert_type) {
      case 'fall':
      case 'fall_now': return t('alerts.types.fallNow');
      case 'fall_risk': return t('alerts.types.fallRisk');
      case 'heart_rate': return t('alerts.types.heartRate');
      case 'blood_pressure': return t('alerts.types.bloodPressure');
      case 'temperature': return t('alerts.types.temperature');
      case 'battery': return t('alerts.types.battery');
      default: return t('alerts.types.emergency');
    }
  };

  const formatDate = (dateString: string) => {
    const date = parseApiDate(dateString);
    if (!date) return '--';
    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - date.getTime());
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 60) return t('datetime.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('datetime.hoursAgo', { count: diffHours });
    return date.toLocaleDateString();
  };

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start();
  };

  const isCritical = alert.severity === 'critical';
  const isPending = alert.status === 'pending' || alert.status === 'sent';
  const canManageAlert = Boolean(onAcknowledge || onResolve || onImFine);
  const statusLabel = t(`alerts.status.${alert.status}`);

  return (
    <Animated.View 
      style={{ transform: [{ scale: scaleAnim }] }}
      className={`bg-white rounded-2xl p-4 border-l-4 mb-4 shadow-sm ${
        isCritical ? 'border-l-red-500' : 
        alert.severity === 'high' ? 'border-l-orange-500' : 'border-l-blue-500'
      }`}
    >
      {/* Header */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-row items-center flex-1">
          <View className={`w-12 h-12 rounded-full justify-center items-center mr-3 ${
            isCritical ? 'bg-red-50' : alert.severity === 'high' ? 'bg-orange-50' : 'bg-blue-50'
          }`}>
            <MaterialCommunityIcons name={getAlertIcon()} size={24} color={getSeverityColor()} />
          </View>
          
          <View className="flex-1">
            <Text className="text-base font-bold text-gray-900">
              {getAlertTypeLabel()}
            </Text>
            <View className="flex-row items-center mt-1">
              <View className={`w-2 h-2 rounded-full mr-2 ${isPending ? 'bg-orange-500' : 'bg-green-500'}`} />
              <Text className="text-xs text-gray-500">
                {formatDate(alert.timestamp)} • 
                <Text style={{ color: getStatusColor() }} className="font-medium">
                  {' '}{t(`alerts.status.${alert.status}`)}
                </Text>
              </Text>
            </View>
          </View>
        </View>
        
        {/* Severity Badge */}
        <View className={`px-2 py-1 rounded-md ${
          isCritical ? 'bg-red-100' : alert.severity === 'high' ? 'bg-orange-100' : 'bg-blue-100'
        }`}>
          <Text className={`text-xs font-bold ${
            isCritical ? 'text-red-700' : alert.severity === 'high' ? 'text-orange-700' : 'text-blue-700'
          }`}>
            {t(`alerts.severity.${alert.severity}`)}
          </Text>
        </View>
      </View>

      {/* Message */}
      <Text className="text-sm text-gray-700 mb-4 leading-5">
        {alert.message || t('alerts.defaultMessage')}
      </Text>

      {/* Details Row */}
      <View className="flex-row justify-between mb-4 p-3 bg-gray-50 rounded-lg">
        <View className="items-center flex-1">
          <Text className="text-xs text-gray-400 mb-1">{t('alerts.alertId')}</Text>
          <Text className="text-sm font-semibold text-gray-800">#{alert.id}</Text>
        </View>
        <View className="items-center flex-1">
          <Text className="text-xs text-gray-400 mb-1">{t('alerts.type')}</Text>
          <Text className="text-sm font-semibold text-gray-800">{getAlertTypeLabel()}</Text>
        </View>
        <View className="items-center flex-1 border-l border-gray-200">
          <Text className="text-xs text-gray-400 mb-1">{t('alerts.time')}</Text>
          <Text className="text-sm font-semibold text-gray-800">
            {formatApiTime(alert.timestamp)}
          </Text>
        </View>
      </View>

      {/* Actions */}
      {isPending && canManageAlert ? (
        <View>
          {onImFine && (
            <TouchableOpacity
              className="flex-row items-center justify-center py-3 bg-green-500 rounded-xl mb-2"
              onPress={onImFine}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
            >
              <MaterialCommunityIcons name="shield-check" size={20} color="white" />
              <Text className="text-white font-bold ml-2">{t('alerts.imFine')}</Text>
            </TouchableOpacity>
          )}
          <View className="flex-row">
            {onAcknowledge ? (
              <TouchableOpacity
                className="flex-1 flex-row items-center justify-center py-3 bg-blue-50 rounded-xl mr-2 border border-blue-100"
                onPress={onAcknowledge}
              >
                <Text className="text-blue-600 font-bold">{t('alerts.acknowledge')}</Text>
              </TouchableOpacity>
            ) : (
              <View className="flex-1 mr-2" />
            )}
            
            {onResolve ? (
              <TouchableOpacity
                className="flex-1 flex-row items-center justify-center py-3 bg-gray-800 rounded-xl ml-2"
                onPress={onResolve}
              >
                <Text className="text-white font-bold">{t('alerts.resolve')}</Text>
              </TouchableOpacity>
            ) : (
              <View className="flex-1 ml-2" />
            )}
          </View>
        </View>
      ) : isPending ? (
        <View className="flex-row items-center p-3 bg-orange-50 rounded-xl border border-orange-100">
          <MaterialCommunityIcons name="eye-outline" size={20} color="#F59E0B" />
          <Text className="text-sm text-orange-700 ml-2 font-medium">
            {t(`alerts.status.${alert.status}`)}
          </Text>
        </View>
      ) : (
        <View className="flex-row items-center p-3 bg-green-50 rounded-xl border border-green-100">
          <MaterialCommunityIcons name="check-circle" size={20} color="#10B981" />
          <Text className="text-sm text-green-700 ml-2 font-medium">
            {t('alerts.resolvedMessage', { status: statusLabel })}
          </Text>
        </View>
      )}
    </Animated.View>
  );
};
