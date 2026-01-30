import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert as RNAlert,
  Vibration,
} from 'react-native';
import { useLanguage } from '../components/LanguageProvider';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { StatusCard } from '../components/StatusCard';
import { EmergencyButton } from '../components/EmergencyButton';
import { AlertCard } from '../components/AlertCard';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { notificationService } from '../services/notifications';
import { User, Device, Alert as AlertType, Prediction } from '../types';
import { COLORS } from '../utils/constants';

export const HomeScreen: React.FC = () => {
  const { t } = useLanguage();
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [lastPrediction, setLastPrediction] = useState<Prediction | null>(null);
  
  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      checkForNewAlerts();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const storedUser = await storageService.getUser();
      setUser(storedUser);
      
      // If there is a user, try to load data
      if (storedUser) {
        try {
          const alertsResponse = await apiService.getUserAlerts(storedUser.id, 5);
          if (alertsResponse.success) {
            setAlerts(alertsResponse.data || []);
          }
        } catch (apiError) {
          console.warn('⚠️ (Background) Error loading data:', apiError);
        }
      }
    } catch (error) {
      console.error('❌ (Background) General error:', error);
    }
  };

  const checkForNewAlerts = async () => {
    if (!user) return;

    try {
      const alertsResponse = await apiService.getUserAlerts(user.id, 5);
      if (alertsResponse.success && alertsResponse.data) {
        const newAlerts = alertsResponse.data.filter(
          (newAlert) => !alerts.some((existingAlert) => existingAlert.id === newAlert.id)
        );

        newAlerts.forEach((alert) => {
          if (alert.status === 'pending' || alert.status === 'sent') {
            notificationService.sendFallAlert(alert);
          }
        });

        if (newAlerts.length > 0) {
          setAlerts(alertsResponse.data);
        }
      }
    } catch (error) {
      console.error('Error checking alerts:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleEmergencyPress = async () => {
    if (!user) {
      RNAlert.alert(t('common.error'), t('auth.login.title') + ' ' + t('common.required'));
      return;
    }

    try {
      RNAlert.alert(
        t('emergency.sosButton'),
        t('emergency.sosSending') + '?',
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.send'),
            onPress: () => {
              RNAlert.alert(
                t('success.sent'),
                t('emergency.sosSending') + ' ' + t('success.sent'),
                [{ text: t('common.ok') }]
              );
              
              Vibration.vibrate([500, 500, 500]);
              loadData();
            },
            style: 'default',
          },
        ]
      );
    } catch (error) {
      console.error('Emergency error:', error);
      RNAlert.alert(t('common.error'), t('errors.unknown'));
    }
  };

  const handleEmergencyLongPress = () => {
    RNAlert.alert(
      t('emergency.title'),
      t('emergency.settings.autoCall') + '?',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('emergency.settings.autoCall'),
          onPress: () => {
            RNAlert.alert(
              t('emergency.title'),
              t('emergency.sosSending'),
              [{ text: t('common.ok') }]
            );
          },
          style: 'destructive',
        },
      ]
    );
  };

  return (
    <ScreenWrapper scrollable={false}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* System Status Card */}
        <StatusCard
          device={device}
          lastPrediction={lastPrediction}
          onRefresh={loadData}
        />

        <View style={styles.spacingMedium} />

        {/* Emergency Button */}
        <EmergencyButton
          onPress={handleEmergencyPress}
          onLongPress={handleEmergencyLongPress}
          disabled={!user}
        />

        {/* Recent Alerts */}
        {alerts.length > 0 && (
          <View style={styles.alertsSection}>
            <Text style={styles.sectionTitle}>
              {t('alerts.recentAlerts')}
            </Text>
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onAcknowledge={() => {}}
                onResolve={() => {}}
              />
            ))}
          </View>
        )}

        {/* No Alerts Message */}
        {alerts.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              {t('alerts.noAlerts')}
            </Text>
            <Text style={styles.emptyStateSubtext}>
              {t('home.everythingOk')}
            </Text>
          </View>
        )}

        {/* Safety Tips */}
        <View style={styles.tipsSection}>
          <Text style={styles.sectionTitle}>
            {t('home.safetyTips')}
          </Text>
          <View style={styles.tipCard}>
            <Text style={styles.tipText}>
              • {t('home.tip1')}
            </Text>
            <Text style={styles.tipText}>
              • {t('home.tip2')}
            </Text>
            <Text style={styles.tipText}>
              • {t('home.tip3')}
            </Text>
            <Text style={styles.tipText}>
              • {t('home.tip4')}
            </Text>
          </View>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 8,
  },
  spacingMedium: {
    height: 25,
  },
  bottomSpacing: {
    height: 100,
  },
  alertsSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    marginTop: 20,
  },
  emptyStateText: {
    fontSize: 18,
    color: COLORS.gray,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: COLORS.lightGray,
  },
  tipsSection: {
    marginVertical: 20,
  },
  tipCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
  },
  tipText: {
    fontSize: 15,
    color: COLORS.dark,
    marginVertical: 6,
  },
});