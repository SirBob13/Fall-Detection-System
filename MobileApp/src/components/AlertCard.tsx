import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Alert } from '../types';
import { useLanguage } from '../components/LanguageProvider';

interface AlertCardProps {
  alert: Alert;
  onAcknowledge: () => void;
  onResolve: () => void;
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
      case 'fall': return 'run';
      case 'heart_rate': return 'heart-pulse';
      case 'blood_pressure': return 'heart-flash';
      case 'temperature': return 'thermometer';
      case 'battery': return 'battery-alert';
      default: return 'alert';
    }
  };

  const getAlertTypeLabel = () => {
    switch (alert.alert_type) {
      case 'fall': return t('alerts.types.fall');
      case 'heart_rate': return t('alerts.types.heartRate');
      case 'blood_pressure': return t('alerts.types.bloodPressure');
      case 'temperature': return t('alerts.types.temperature');
      case 'battery': return t('alerts.types.battery');
      default: return t('alerts.types.emergency');
    }
  };

  const getStatusLabel = () => {
    switch (alert.status) {
      case 'pending': return t('alerts.status.pending');
      case 'sent': return t('alerts.status.sent');
      case 'resolved': return t('alerts.status.resolved');
      case 'failed': return t('alerts.status.failed');
      default: return t('common.unknown');
    }
  };

  const getSeverityLabel = () => {
    switch (alert.severity) {
      case 'critical': return t('alerts.severity.critical');
      case 'high': return t('alerts.severity.high');
      case 'medium': return t('alerts.severity.medium');
      case 'low': return t('alerts.severity.low');
      default: return t('common.unknown');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return t('datetime.minutesAgo', { count: diffMins });
    } else if (diffHours < 24) {
      return t('datetime.hoursAgo', { count: diffHours });
    } else if (diffDays < 7) {
      return t('datetime.daysAgo', { count: diffDays });
    } else {
      return date.toLocaleDateString();
    }
  };

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  const isCritical = alert.severity === 'critical';
  const isPending = alert.status === 'pending' || alert.status === 'sent';

  return (
    <Animated.View 
      style={{ transform: [{ scale: scaleAnim }] }}
      className={`
        bg-white dark:bg-darkTheme-surface rounded-2xl p-4 border-l-4
        ${isCritical ? 'border-l-danger' : 
          alert.severity === 'high' ? 'border-l-warning' :
          'border-l-primary'}
        shadow-card
      `}
    >
      {/* Alert Header */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-row items-center flex-1">
          <View className={`
            w-12 h-12 rounded-full justify-center items-center mr-3
            ${isCritical ? 'bg-red-50' : 
              alert.severity === 'high' ? 'bg-orange-50' :
              'bg-blue-50'}
          `}>
            <MaterialCommunityIcons
              name={getAlertIcon()}
              size={24}
              color={getSeverityColor()}
            />
          </View>
          
          <View className="flex-1">
            <Text className="text-base font-semibold text-dark dark:text-darkTheme-text">
              {getAlertTypeLabel()}
            </Text>
            
            <View className="flex-row items-center mt-1">
              <View className={`w-2 h-2 rounded-full mr-2 ${isPending ? 'bg-warning' : 'bg-success'}`} />
              <Text className="text-xs text-gray dark:text-darkTheme-muted">
                {formatDate(alert.timestamp)} • 
                <Text className="font-medium" style={{ color: getStatusColor() }}>
                  {' '}{getStatusLabel()}
                </Text>
              </Text>
            </View>
          </View>
        </View>
        
        {/* Severity Badge */}
        <View className={`
          px-3 py-1 rounded-full
          ${isCritical ? 'bg-red-100' : 
            alert.severity === 'high' ? 'bg-orange-100' :
            alert.severity === 'medium' ? 'bg-yellow-100' :
            'bg-green-100'}
        `}>
          <Text className={`
            text-xs font-bold
            ${isCritical ? 'text-red-800' : 
              alert.severity === 'high' ? 'text-orange-800' :
              alert.severity === 'medium' ? 'text-yellow-800' :
              'text-green-800'}
          `}>
            {getSeverityLabel()}
          </Text>
        </View>
      </View>

      {/* Alert Message */}
      <Text className="text-sm text-dark dark:text-darkTheme-text mb-4 leading-5">
        {alert.message || t('alerts.defaultMessage')}
      </Text>

      {/* Alert Details */}
      <View className="flex-row justify-between mb-4 p-3 bg-lightGray/20 rounded-lg">
        <View className="items-center flex-1">
          <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('alerts.alertId')}</Text>
          <Text className="text-sm font-medium text-dark dark:text-darkTheme-text">
            #{alert.id.toString().slice(-6)}
          </Text>
        </View>
        
        <View className="items-center flex-1 border-x border-lightGray dark:border-darkTheme-border">
          <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('alerts.type')}</Text>
          <Text className="text-sm font-medium text-dark dark:text-darkTheme-text">
            {getAlertTypeLabel()}
          </Text>
        </View>
        
        <View className="items-center flex-1">
          <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('alerts.time')}</Text>
          <Text className="text-sm font-medium text-dark dark:text-darkTheme-text">
            {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>

      {/* Action Buttons */}
      {isPending && (
        <View>
          {onImFine && (
            <TouchableOpacity
              className="flex-row items-center justify-center py-3 bg-emerald-50 rounded-lg mb-2"
              onPress={onImFine}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="shield-check" size={18} color="#10B981" />
              <Text className="text-emerald-600 font-semibold ml-2">{t('alerts.imFine')}</Text>
            </TouchableOpacity>
          )}
          <View className="flex-row justify-between">
          <TouchableOpacity
            className="flex-row items-center justify-center flex-1 py-3 bg-blue-50 rounded-lg mr-2"
            onPress={onAcknowledge}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="check" size={18} color="#2196F3" />
            <Text className="text-primary font-semibold ml-2">{t('alerts.acknowledge')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            className="flex-row items-center justify-center flex-1 py-3 bg-green-50 rounded-lg ml-2"
            onPress={onResolve}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="check-circle" size={18} color="#4CAF50" />
            <Text className="text-success font-semibold ml-2">{t('alerts.resolve')}</Text>
          </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Resolved Message */}
      {!isPending && (
        <View className="flex-row items-center p-3 bg-green-50 rounded-lg">
          <MaterialCommunityIcons name="check-circle" size={20} color="#4CAF50" />
          <Text className="text-sm text-success ml-2 flex-1">
            {t('alerts.resolvedMessage', {
              status: alert.status === 'resolved'
                ? t('alerts.status.resolved')
                : t('alerts.status.acknowledged'),
            })}
          </Text>
        </View>
      )}
    </Animated.View>
  );
};
