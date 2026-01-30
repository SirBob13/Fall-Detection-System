import * as Notifications from 'expo-notifications';
import { Platform, Vibration } from 'react-native';
import { Alert } from '../types';

// تكوين الإشعارات
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export class NotificationService {
  private static instance: NotificationService;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Error requesting notification permissions:', error);
      return false;
    }
  }

  async sendFallAlert(alert: Alert) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ اكتشاف سقوط!',
          body: alert.message,
          sound: true,
          data: { alertId: alert.id, type: alert.alert_type },
        },
        trigger: null, // إرسال فوري
      });

      // اهتزاز الجهاز
      if (Platform.OS !== 'web') {
        Vibration.vibrate([500, 500, 500]);
      }
      
    } catch (error) {
      console.error('Error sending fall alert:', error);
    }
  }

  async sendFallSoonWarning(probability: number) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ تنبيه!',
          body: `احتمالية سقوط قريب: ${(probability * 100).toFixed(1)}%`,
          sound: true,
          data: { type: 'fall_soon_warning' },
        },
        trigger: null,
      });

      if (Platform.OS !== 'web') {
        Vibration.vibrate([300, 300, 300]);
      }
    } catch (error) {
      console.error('Error sending fall soon warning:', error);
    }
  }

  async sendLowBatteryWarning(batteryLevel: number) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🔋 بطارية منخفضة',
          body: `بطارية الجهاز: ${batteryLevel.toFixed(0)}%`,
          sound: true,
        },
        trigger: null,
      });
    } catch (error) {
      console.error('Error sending low battery warning:', error);
    }
  }

  async cancelAllNotifications() {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      console.error('Error cancelling notifications:', error);
    }
  }

  async testNotification() {
    const testAlert: Alert = {
      id: 999,
      user_id: 1,
      timestamp: new Date().toISOString(),
      alert_type: 'fall',
      severity: 'critical',
      message: 'هذا إشعار تجريبي لاكتشاف السقوط',
      status: 'pending',
    };
    
    await this.sendFallAlert(testAlert);
  }
}

export const notificationService = NotificationService.getInstance();