import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert as RNAlert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../utils/constants';
import { getSeverityColor, formatDate } from '../utils/helpers';
import { Alert } from '../types';

interface AlertCardProps {
  alert: Alert;
  onAcknowledge?: () => void;
  onResolve?: () => void;
}

export const AlertCard: React.FC<AlertCardProps> = ({
  alert,
  onAcknowledge,
  onResolve,
}) => {
  const severityColor = getSeverityColor(alert.severity);
  
  // الحصول على الأيقونة المناسبة
  const getAlertIcon = (alertType: Alert['alert_type']): string => {
    switch (alertType) {
      case 'fall':
        return 'alert-octagon';
      case 'vital_abnormal':
        return 'heart-pulse';
      case 'device_offline':
        return 'wifi-off';
      default:
        return 'alert-circle';
    }
  };

  const iconName = getAlertIcon(alert.alert_type);

  return (
    <TouchableOpacity
      style={[styles.container, { borderLeftColor: severityColor }]}
      onPress={() => {
        RNAlert.alert(
          alert.alert_type === 'fall' ? 'تفاصيل السقوط' : 'تفاصيل الإنذار',
          alert.message,
          [
            { text: 'تم', style: 'default' },
            alert.status === 'pending' && {
              text: 'تأكيد الاستلام',
              onPress: onAcknowledge,
              style: 'default',
            },
            alert.status === 'acknowledged' && {
              text: 'تم الحل',
              onPress: onResolve,
              style: 'default',
            },
          ].filter(Boolean)
        );
      }}
    >
      <View style={styles.iconContainer}>
        <MaterialCommunityIcons 
          name={iconName} 
          size={24} 
          color={severityColor} 
        />
      </View>
      
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>
            {alert.alert_type === 'fall' && 'سقوط '}
            {alert.alert_type === 'vital_abnormal' && 'مؤشرات حيوية '}
            {alert.alert_type === 'device_offline' && 'اتصال '}
            <Text style={[styles.severity, { color: severityColor }]}>
              ({alert.severity})
            </Text>
          </Text>
          <Text style={styles.time}>{formatDate(alert.timestamp)}</Text>
        </View>
        
        <Text style={styles.message} numberOfLines={2}>
          {alert.message}
        </Text>
        
        <View style={styles.footer}>
          <View style={[styles.statusBadge, { backgroundColor: severityColor }]}>
            <Text style={styles.statusText}>
              {alert.status === 'pending' && 'قيد الانتظار'}
              {alert.status === 'sent' && 'تم الإرسال'}
              {alert.status === 'acknowledged' && 'تم الاستلام'}
              {alert.status === 'resolved' && 'تم الحل'}
            </Text>
          </View>
          
          {alert.acknowledged_by && (
            <Text style={styles.acknowledgedBy}>
              بواسطة: {alert.acknowledged_by}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginVertical: 6,
    marginHorizontal: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderLeftWidth: 4,
  },
  iconContainer: {
    marginRight: 12,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
    flex: 1,
  },
  severity: {
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
    color: COLORS.gray,
  },
  message: {
    fontSize: 14,
    color: COLORS.dark,
    lineHeight: 20,
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: 'bold',
  },
  acknowledgedBy: {
    fontSize: 12,
    color: COLORS.gray,
  },
});