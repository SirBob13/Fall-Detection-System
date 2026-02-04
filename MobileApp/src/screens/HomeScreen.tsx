import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Alert as RNAlert,
  Vibration,
  TouchableOpacity, 
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


export const HomeScreen: React.FC = () => {
  const { t } = useLanguage();
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [lastPrediction, setLastPrediction] = useState<Prediction | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  
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
      const storedDevice = await storageService.getDevice();

      setUser(storedUser);
      setDevice(storedDevice);
      
      // If there is a user, try to load data
      if (storedUser) {
        try {
          const alertsResponse = await apiService.getUserAlerts(storedUser.id, 5);
          if (alertsResponse.success) {
            setAlerts(alertsResponse.data || []);
            setConnectionError(false);
          } else {
            setConnectionError(true);
          }

          const deviceResponse = await apiService.getUserDevice(storedUser.id);
          if (deviceResponse.success && deviceResponse.data) {
            setDevice(deviceResponse.data);
            await storageService.saveDevice(deviceResponse.data);
          }

          const predictionResponse = await apiService.getUserPredictions(storedUser.id, 1);
          if (predictionResponse.success && predictionResponse.data && predictionResponse.data.length > 0) {
            setLastPrediction(predictionResponse.data[0]);
          }
        } catch (apiError) {
          console.warn('⚠️ (Background) Error loading data:', apiError);
          setConnectionError(true);
        }
      }
    } catch (error) {
      console.error('❌ (Background) General error:', error);
      setConnectionError(true);
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
      RNAlert.alert(t('common.error'), `${t('auth.login.title')} ${t('common.required')}`);
      return;
    }

    try {
      RNAlert.alert(
        t('emergency.sosButton'),
        `${t('emergency.sosSending')}?`,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.send'),
            onPress: () => {
              RNAlert.alert(
                t('success.sent'),
                `${t('emergency.sosSending')} ${t('success.sent')}`,
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
      `${t('emergency.settings.autoCall')}?`,
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

  const handleViewAllAlerts = () => {
    // Navigate to alerts screen
    // navigation.navigate('Alerts');
  };

  return (
    <ScreenWrapper>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 8 }}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            tintColor="#2196F3"
            colors={['#2196F3']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Connection Error Banner */}
        {connectionError && (
          <View className="mx-4 my-3 bg-red-50 border border-danger rounded-xl p-3">
            <View className="flex-row items-center">
              <View className="w-3 h-3 rounded-full bg-danger mr-2" />
              <Text className="text-sm font-medium text-dark flex-1">
                {t('errors.connection')}
              </Text>
            </View>
            <Text className="text-xs text-gray mt-1">
              {t('errors.connectionDesc')}
            </Text>
          </View>
        )}

        {/* System Status Card */}
        <View className="mx-4">
          <StatusCard
            device={device}
            lastPrediction={lastPrediction}
            onRefresh={loadData}
          />
        </View>

        {/* Emergency Button */}
        <View className="my-6 items-center">
          <EmergencyButton
            onPress={handleEmergencyPress}
            onLongPress={handleEmergencyLongPress}
            disabled={!user}
          />
          {!user && (
            <Text className="text-xs text-gray mt-2">
              {t('auth.login.title')} {t('common.required')}
            </Text>
          )}
        </View>

        {/* Recent Alerts Section */}
        <View className="mt-4">
          <View className="flex-row justify-between items-center mx-4 mb-3">
            <Text className="text-lg font-bold text-dark">
              {t('alerts.recentAlerts')}
            </Text>
            {alerts.length > 0 && (
              <TouchableOpacity 
                onPress={handleViewAllAlerts}
                className="px-3 py-1.5 bg-primary/10 rounded-full active:opacity-70"
              >
                <Text className="text-xs font-semibold text-primary">
                  {t('common.viewAll')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          
          {alerts.length > 0 ? (
            <View className="px-2">
              {alerts.slice(0, 3).map((alert) => (
                <View key={alert.id} className="mb-2">
                  <AlertCard
                    alert={alert}
                    onAcknowledge={() => {}}
                    onResolve={() => {}}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View className="items-center py-10">
              <View className="w-16 h-16 rounded-full bg-green-50 justify-center items-center mb-3">
                <Text className="text-3xl">✅</Text>
              </View>
              <Text className="text-lg text-gray mb-2">
                {t('alerts.noAlerts')}
              </Text>
              <Text className="text-sm text-lightGray">
                {t('home.everythingOk')}
              </Text>
            </View>
          )}
        </View>

        {/* Safety Tips Section */}
        <View className="mt-8 mx-4">
          <Text className="text-lg font-bold text-dark mb-4">
            {t('home.safetyTips')}
          </Text>
          
          <View className="bg-white rounded-2xl shadow-lg border border-lightGray p-5">
            <View className="flex-row items-start mb-3">
              <View className="w-8 h-8 rounded-full bg-blue-50 justify-center items-center mr-3">
                <Text className="text-primary font-bold">1</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-dark mb-1">
                  {t('home.tip1Title')}
                </Text>
                <Text className="text-sm text-gray">
                  {t('home.tip1')}
                </Text>
              </View>
            </View>
            
            <View className="flex-row items-start mb-3">
              <View className="w-8 h-8 rounded-full bg-blue-50 justify-center items-center mr-3">
                <Text className="text-primary font-bold">2</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-dark mb-1">
                  {t('home.tip2Title')}
                </Text>
                <Text className="text-sm text-gray">
                  {t('home.tip2')}
                </Text>
              </View>
            </View>
            
            <View className="flex-row items-start mb-3">
              <View className="w-8 h-8 rounded-full bg-blue-50 justify-center items-center mr-3">
                <Text className="text-primary font-bold">3</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-dark mb-1">
                  {t('home.tip3Title')}
                </Text>
                <Text className="text-sm text-gray">
                  {t('home.tip3')}
                </Text>
              </View>
            </View>
            
            <View className="flex-row items-start">
              <View className="w-8 h-8 rounded-full bg-blue-50 justify-center items-center mr-3">
                <Text className="text-primary font-bold">4</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-dark mb-1">
                  {t('home.tip4Title')}
                </Text>
                <Text className="text-sm text-gray">
                  {t('home.tip4')}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Quick Stats */}
        <View className="mt-8 mx-4">
          <Text className="text-lg font-bold text-dark mb-4">
            {t('home.quickStats')}
          </Text>
          
          <View className="flex-row justify-between">
            <View className="bg-white rounded-xl p-4 flex-1 mr-2 shadow-sm border border-lightGray">
              <Text className="text-xs text-gray mb-1">{t('home.todayAlerts')}</Text>
              <Text className="text-2xl font-bold text-dark">{alerts.length}</Text>
              <View className="flex-row items-center mt-1">
                <Text className="text-xs text-success">↓ 20%</Text>
                <Text className="text-xs text-gray ml-1">{t('home.fromYesterday')}</Text>
              </View>
            </View>
            
            <View className="bg-white rounded-xl p-4 flex-1 ml-2 shadow-sm border border-lightGray">
              <Text className="text-xs text-gray mb-1">{t('home.responseTime')}</Text>
              <Text className="text-2xl font-bold text-dark">45s</Text>
              <View className="flex-row items-center mt-1">
                <Text className="text-xs text-success">↑ 15%</Text>
                <Text className="text-xs text-gray ml-1">{t('home.faster')}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Bottom Spacing */}
        <View className="h-20" />
      </ScrollView>
    </ScreenWrapper>
  );
};
