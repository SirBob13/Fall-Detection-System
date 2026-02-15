import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Alert as RNAlert,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { AlertCard } from '../components/AlertCard';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { Alert as AlertType, User } from '../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../components/LanguageProvider';

export const AlertsScreen: React.FC = () => {
  const { t } = useLanguage();
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [monitoredUser, setMonitoredUser] = useState<User | null>(null);
  
  // Get safe area insets
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadAlerts();
  }, [filter]);

  const loadAlerts = async () => {
    try {
      setIsLoading(true);
      const user = await storageService.getUser();
      const monitoredUser = await storageService.getMonitoredUser();
      setMonitoredUser(monitoredUser || null);
      const activeUser = monitoredUser || user;

      if (!activeUser) {
        RNAlert.alert(t('common.error'), t('errors.loginRequired'));
        setIsLoading(false);
        return;
      }

      const response = await apiService.getUserAlerts(activeUser.id, 50);
      if (response.success && response.data) {
        let filteredAlerts = response.data;
        
        if (filter === 'pending') {
          filteredAlerts = filteredAlerts.filter(
            (alert) => alert.status === 'pending' || alert.status === 'sent'
          );
        } else if (filter === 'resolved') {
          filteredAlerts = filteredAlerts.filter(
            (alert) => alert.status === 'resolved'
          );
        }
        
        setAlerts(filteredAlerts);
      } else {
        RNAlert.alert(t('common.error'), response.message || t('alerts.loadFailed'));
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
      RNAlert.alert(t('common.error'), t('alerts.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAlerts();
    setRefreshing(false);
  };

  const getAlertStats = () => {
    const total = alerts.length;
    const pending = alerts.filter(
      (a) => a.status === 'pending' || a.status === 'sent'
    ).length;
    const resolved = alerts.filter((a) => a.status === 'resolved').length;
    const critical = alerts.filter((a) => a.severity === 'critical').length;

    return { total, pending, resolved, critical };
  };

  const handleClearAllAlerts = () => {
    RNAlert.alert(
      t('alerts.clearAllTitle'),
      t('alerts.clearAllConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alerts.clearAll'),
          style: 'destructive',
          onPress: async () => {
            // Implement clear logic here
            RNAlert.alert(t('common.success'), t('alerts.cleared'));
            setAlerts([]);
          },
        },
      ]
    );
  };

  const handleAcknowledge = async (alertId: number) => {
    try {
      const user = await storageService.getUser();
      const response = await apiService.acknowledgeAlert(alertId, user?.name || 'user');
      if (response.success) {
        RNAlert.alert(t('common.success'), t('alerts.acknowledged'));
        await loadAlerts();
      } else {
        RNAlert.alert(t('common.error'), response.message || t('alerts.acknowledgeFailed'));
      }
    } catch (error) {
      RNAlert.alert(t('common.error'), t('alerts.acknowledgeFailed'));
    }
  };

  const handleResolve = async (alertId: number) => {
    try {
      const response = await apiService.resolveAlert(alertId);
      if (response.success) {
        RNAlert.alert(t('common.success'), t('alerts.resolved'));
        await loadAlerts();
      } else {
        RNAlert.alert(t('common.error'), response.message || t('alerts.resolveFailed'));
      }
    } catch (error) {
      RNAlert.alert(t('common.error'), t('alerts.resolveFailed'));
    }
  };

  const stats = getAlertStats();

  return (
    <SafeAreaView className="flex-1 bg-light">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 8, paddingTop: insets.top }}
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
        {/* Header */}
        <View className="mx-4 mt-4 mb-6">
          <Text className="text-2xl font-bold text-dark">{t('alerts.historyTitle')}</Text>
          <Text className="text-sm text-gray mt-1">
            {t('alerts.historySubtitle')}
          </Text>
        </View>

        {monitoredUser && (
          <View className="mx-4 mb-4 bg-purple-50 border border-purple-100 rounded-xl p-3">
            <Text className="text-xs text-gray">{t('care.monitoring')}</Text>
            <Text className="text-sm font-semibold text-dark mt-1">{monitoredUser.name}</Text>
          </View>
        )}

        {/* Statistics Overview */}
        <View className="mx-4 mb-6">
          <View className="flex-row justify-between mb-3">
            <View className="items-center flex-1 p-4 bg-primary rounded-2xl mx-1 shadow-lg">
              <Text className="text-3xl font-bold text-white">{stats.total}</Text>
              <Text className="text-sm text-white/90 mt-1">{t('alerts.totalAlerts')}</Text>
            </View>
            
            <View className="items-center flex-1 p-4 bg-warning rounded-2xl mx-1 shadow-lg">
              <Text className="text-3xl font-bold text-white">{stats.pending}</Text>
              <Text className="text-sm text-white/90 mt-1">{t('alerts.pending')}</Text>
            </View>
          </View>
          
          <View className="flex-row justify-between">
            <View className="items-center flex-1 p-4 bg-success rounded-2xl mx-1 shadow-lg">
              <Text className="text-3xl font-bold text-white">{stats.resolved}</Text>
              <Text className="text-sm text-white/90 mt-1">{t('alerts.resolved')}</Text>
            </View>
            
            <View className="items-center flex-1 p-4 bg-danger rounded-2xl mx-1 shadow-lg">
              <Text className="text-3xl font-bold text-white">{stats.critical}</Text>
              <Text className="text-sm text-white/90 mt-1">{t('alerts.critical')}</Text>
            </View>
          </View>
          
          {/* Last Updated */}
          <View className="mt-4 items-center">
            <Text className="text-xs text-gray">
              {t('alerts.lastUpdated')}: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>

        {/* Filter Section */}
        <View className="card mx-4 mb-6">
          <Text className="section-title">{t('alerts.filterAlerts')}</Text>
          
          <View className="flex-row justify-between mb-4">
            {(['all', 'pending', 'resolved'] as const).map((filterType) => (
              <TouchableOpacity
                key={filterType}
                className={`px-4 py-3 rounded-full ${
                  filter === filterType
                    ? filterType === 'all'
                      ? 'bg-primary'
                      : filterType === 'pending'
                      ? 'bg-warning'
                      : 'bg-success'
                    : 'bg-lightGray'
                }`}
                onPress={() => setFilter(filterType)}
                activeOpacity={0.7}
              >
                <Text className={`font-semibold ${
                  filter === filterType ? 'text-white' : 'text-dark'
                }`}>
                  {filterType === 'all' && t('alerts.all')}
                  {filterType === 'pending' && t('alerts.pending')}
                  {filterType === 'resolved' && t('alerts.resolved')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          
          {/* Filter Summary */}
          <View className="flex-row items-center justify-between p-3 bg-blue-50 rounded-lg">
            <Text className="text-sm font-medium text-dark">
              {t('alerts.showing')}: <Text className="text-primary">{alerts.length}</Text> {t('alerts.alerts')}
            </Text>
            {alerts.length > 0 && (
              <TouchableOpacity
                onPress={handleClearAllAlerts}
                className="px-3 py-1.5 bg-red-50 rounded-lg"
                activeOpacity={0.7}
              >
                <Text className="text-sm font-medium text-danger">{t('alerts.clearAll')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Alerts List */}
        {isLoading ? (
          <View className="items-center py-20">
            <View className="w-16 h-16 rounded-full bg-blue-50 justify-center items-center mb-4">
              <Text className="text-primary text-2xl">⏳</Text>
            </View>
            <Text className="text-base text-gray">{t('alerts.loading')}</Text>
          </View>
        ) : alerts.length > 0 ? (
          <View className="mx-2 mb-8">
            {alerts.map((alert, index) => (
              <View key={alert.id} className={`mb-3 ${index > 0 ? 'mt-3' : ''}`}>
                <AlertCard
                  alert={alert}
                  onAcknowledge={() => handleAcknowledge(alert.id)}
                  onResolve={() => handleResolve(alert.id)}
                />
              </View>
            ))}
            
            {/* View More Button */}
            {alerts.length >= 50 && (
              <View className="items-center mt-6 mb-4">
                <TouchableOpacity className="px-6 py-3 bg-primary/10 rounded-full">
                  <Text className="text-primary font-semibold">{t('alerts.loadMore')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          <View className="items-center py-16">
            <View className="w-24 h-24 rounded-full bg-green-50 justify-center items-center mb-6">
              <Text className="text-4xl">✅</Text>
            </View>
            <Text className="text-xl text-gray font-medium mb-2">
              {filter === 'all' && t('alerts.noAlertsAll')}
              {filter === 'pending' && t('alerts.noAlertsPending')}
              {filter === 'resolved' && t('alerts.noAlertsResolved')}
            </Text>
            <Text className="text-sm text-lightGray text-center max-w-xs">
              {filter === 'all' 
                ? t('alerts.noAlertsAllDesc')
                : filter === 'pending'
                ? t('alerts.noAlertsPendingDesc')
                : t('alerts.noAlertsResolvedDesc')
              }
            </Text>
            
            {/* Action Button */}
            <TouchableOpacity
              className="mt-8 px-6 py-3 bg-primary rounded-full"
              onPress={loadAlerts}
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold">{t('alerts.refreshAlerts')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tips Section */}
        {alerts.length > 0 && (
          <View className="mx-4 mb-8 p-4 bg-blue-50 rounded-2xl border border-blue-200">
            <View className="flex-row items-center mb-3">
              <Text className="text-lg font-semibold text-dark">⚠️ {t('alerts.importantNotes')}</Text>
            </View>
            <Text className="text-sm text-gray mb-2">
              • {t('alerts.noteCritical')}
            </Text>
            <Text className="text-sm text-gray mb-2">
              • {t('alerts.noteRetention')}
            </Text>
            <Text className="text-sm text-gray">
              • {t('alerts.noteContact')}
            </Text>
          </View>
        )}

        {/* Bottom Spacing */}
        <View className="h-32" />
      </ScrollView>
    </SafeAreaView>
  );
};
