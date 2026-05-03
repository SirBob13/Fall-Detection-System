import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, Vibration } from 'react-native';
import { Alert } from '../types';
import { apiService } from './api';
import { API_CONFIG } from '../utils/constants';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
let notificationsModule: typeof import('expo-notifications') | null = null;
let notificationsInitialized = false;

const getNotificationsModule = async () => {
  if (isExpoGo && Platform.OS === 'android') {
    return null;
  }

  if (!notificationsModule) {
    notificationsModule = await import('expo-notifications');
  }

  if (!notificationsInitialized && notificationsModule) {
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
    notificationsInitialized = true;
  }

  return notificationsModule;
};

export class NotificationService {
  private static instance: NotificationService;
  private deviceCountCache = new Map<number, { count: number; cachedAt: number }>();

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) {
        return false;
      }
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.warn('Notification permissions not available:', error);
      return false;
    }
  }

  private async getExpoPushToken(): Promise<string | null> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return null;

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        return null;
      }

      const projectId =
        Constants.easConfig?.projectId ||
        Constants.expoConfig?.extra?.eas?.projectId ||
        Constants.expoConfig?.extra?.projectId;

      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      return tokenResponse?.data ?? null;
    } catch (error) {
      console.warn('Error getting Expo push token:', error);
      return null;
    }
  }

  async registerPushToken(accessToken: string): Promise<boolean> {
    try {
      if (!accessToken) return false;
      const token = await this.getExpoPushToken();
      if (!token) return false;

      const payload = {
        token,
        platform: Platform.OS,
        device_id: Constants.deviceName || Constants.installationId || undefined,
      };

      const res = await fetch(`${API_CONFIG.BASE_URL}/notifications/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await res.text();
        console.warn('Push token registration failed:', msg);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Push token registration error:', error);
      return false;
    }
  }

  private formatDeviceSuffix(deviceId?: string | null): string {
    if (!deviceId) return '';
    const compactId = deviceId.length > 16 ? `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}` : deviceId;
    return `\nDevice: ${compactId}`;
  }

  private async shouldShowDeviceId(userId?: number, deviceId?: string | null): Promise<boolean> {
    if (!userId || !deviceId) return false;

    const cached = this.deviceCountCache.get(userId);
    const now = Date.now();
    if (cached && now - cached.cachedAt < 60_000) {
      return cached.count > 1;
    }

    try {
      const response = await apiService.getUserDevices(userId);
      const count = Array.isArray(response.data) ? response.data.length : 0;
      this.deviceCountCache.set(userId, { count, cachedAt: now });
      return count > 1;
    } catch (error) {
      console.warn('Error checking user device count for notification:', error);
      return false;
    }
  }

  async sendFallAlert(alert: Alert, monitoredPersonName?: string, monitoredUserId?: number) {
    try {
      const Notifications = await getNotificationsModule();
      const targetUserId = monitoredUserId ?? alert.user_id;
      const includeDeviceId = await this.shouldShowDeviceId(targetUserId, alert.device_id);
      const deviceSuffix = includeDeviceId ? this.formatDeviceSuffix(alert.device_id) : '';
      const title = monitoredPersonName ? `🚨 خطر: ${monitoredPersonName}` : '🚨 خطر: سقوط مؤكد';
      const body = monitoredPersonName
        ? `تم رصد سقوط مؤكد لـ ${monitoredPersonName}. ${alert.message}${deviceSuffix}`
        : `تم رصد سقوط مؤكد. ${alert.message}${deviceSuffix}`;
      if (!Notifications) {
        Vibration.vibrate([500, 500, 500]);
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          data: {
            alertId: alert.id,
            type: alert.alert_type,
            monitoredPersonName,
            monitoredUserId,
          },
        },
        trigger: null, // إرسال فوري
      });

      // اهتزاز الجهاز
      if (Platform.OS !== 'web') {
        Vibration.vibrate([500, 500, 500]);
      }
      
    } catch (error) {
      console.warn('Error sending fall alert:', error);
    }
  }

  async sendFallSoonWarning(probability: number) {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) {
        Vibration.vibrate([300, 300, 300]);
        return;
      }
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
      console.warn('Error sending fall soon warning:', error);
    }
  }

  async sendLowBatteryWarning(batteryLevel: number) {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) {
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🔋 بطارية منخفضة',
          body: `بطارية الجهاز: ${batteryLevel.toFixed(0)}%`,
          sound: true,
        },
        trigger: null,
      });
    } catch (error) {
      console.warn('Error sending low battery warning:', error);
    }
  }

  async cancelAllNotifications() {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) {
        return;
      }
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      console.warn('Error cancelling notifications:', error);
    }
  }

  addNotificationResponseListener(listener: (response: any) => void) {
    return getNotificationsModule().then((Notifications) => {
      if (!Notifications) return null;
      return Notifications.addNotificationResponseReceivedListener(listener);
    });
  }

  async getLastNotificationResponse() {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return null;
    return Notifications.getLastNotificationResponseAsync();
  }

  async setBadgeCount(count: number) {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;
      await Notifications.setBadgeCountAsync(Math.max(0, count));
    } catch (error) {
      console.warn('Error setting badge count:', error);
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
