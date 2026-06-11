import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Alert as RNAlert,
  TouchableOpacity,
} from 'react-native';
import { AlertCard } from '../components/AlertCard';
import { apiService } from '../services/api';
import { authService } from '../services/auth.service';
import { storageService } from '../services/storage';
import { Alert as AlertType, CareLink, User, VitalsStatus } from '../types';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../components/LanguageProvider';
import { ScreenHeader } from '../components/ScreenHeader';
import { realtimeService } from '../services/realtime.service';
import { RouteProp, useNavigation, useRoute, useScrollToTop } from '@react-navigation/native';
import { MainTabParamList } from '../navigation/AppNavigator';

type AlertsRouteProp = RouteProp<MainTabParamList, 'Alerts'>;

export const AlertsScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const route = useRoute<AlertsRouteProp>();
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [allAlerts, setAllAlerts] = useState<AlertType[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [latestVitalsStatus, setLatestVitalsStatus] = useState<VitalsStatus | null>(null);
  const [lastValidVitals, setLastValidVitals] = useState<{ heartRate?: number; spo2?: number }>({});
  const hasShownLoadErrorRef = useRef(false);
  const scrollRef = useRef<any>(null);
  const monitoredUser = route.params?.monitoredPatient ?? null;
  
  // Get safe area insets
  const insets = useSafeAreaInsets();

  useScrollToTop(scrollRef);

  useEffect(() => {
    loadAlerts();
  }, [monitoredUser?.id]);

  useEffect(() => {
    setAlerts(applyFilter(allAlerts, filter));
  }, [allAlerts, filter]);

  const applyFilter = (items: AlertType[], activeFilter: typeof filter) => {
    if (activeFilter === 'pending') {
      return items.filter((alert) => alert.status === 'pending' || alert.status === 'sent');
    }
    if (activeFilter === 'resolved') {
      return items.filter((alert) => alert.status === 'resolved');
    }
    return items;
  };

  const showLoadErrorOnce = (message: string) => {
    if (hasShownLoadErrorRef.current) {
      return;
    }

    hasShownLoadErrorRef.current = true;
    RNAlert.alert(t('common.error'), message, [
      {
        text: t('common.ok'),
        onPress: () => {
          hasShownLoadErrorRef.current = false;
        },
      },
    ]);
  };

  const loadAlerts = async () => {
    try {
      setIsLoading(true);
      const sessionUser = await authService.getCurrentUser();
      const normalizedSessionUser = sessionUser
        ? ({
            id: Number(sessionUser.id ?? 0),
            name: sessionUser.name || '',
            email: sessionUser.email,
            phone: sessionUser.phone,
            age: sessionUser.age ?? 0,
            gender: (sessionUser.gender as User['gender']) || 'other',
            weight: sessionUser.weight,
            height: sessionUser.height,
            medical_conditions: sessionUser.medical_conditions,
            emergency_contact: sessionUser.emergency_contact,
            is_active: sessionUser.is_active ?? true,
            created_at: sessionUser.created_at || new Date().toISOString(),
          } as User)
        : null;

      if (normalizedSessionUser) {
        setUser(normalizedSessionUser);
        const linksResponse = await apiService.getCareLinks(normalizedSessionUser.id);
        setLinks(linksResponse.success && linksResponse.data ? linksResponse.data : []);
      }
      const activeUser = monitoredUser || normalizedSessionUser;

      if (!activeUser) {
        showLoadErrorOnce(t('errors.loginRequired'));
        setIsLoading(false);
        return;
      }

      const response = await apiService.getUserAlerts(activeUser.id, 50);
      if (response.success && response.data) {
        hasShownLoadErrorRef.current = false;
        setAllAlerts(response.data);
        setAlerts(applyFilter(response.data, filter));
        setLastRefreshedAt(new Date());
      } else {
        showLoadErrorOnce(response.message || t('alerts.loadFailed'));
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
      showLoadErrorOnce(t('alerts.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = realtimeService.subscribe('alerts', (event) => {
      const activeUser = monitoredUser || user;
      if (!activeUser) return;
      if (event.user_id && event.user_id !== activeUser.id) return;
      if (!event.payload) return;

      setAllAlerts((prev) => {
        const exists = prev.find((item) => item.id === event.payload.id);
        const next = exists
          ? prev.map((item) => (item.id === event.payload.id ? { ...item, ...event.payload } : item))
          : [event.payload, ...prev];
        return next.slice(0, 50);
      });
    });

    return unsubscribe;
  }, [monitoredUser, user]);

  useEffect(() => {
    const unsubscribe = realtimeService.subscribe('vitals_status', (event) => {
      const activeUser = monitoredUser || user;
      const payload = event.payload as VitalsStatus | undefined;
      if (!activeUser || !payload) return;
      if (payload.user_id && payload.user_id !== activeUser.id) return;

      setLatestVitalsStatus(payload);
      setLastValidVitals((current) => ({
        heartRate: payload.heart_rate_valid && payload.heart_rate ? payload.heart_rate : current.heartRate,
        spo2: payload.spo2_valid && payload.spo2 ? payload.spo2 : current.spo2,
      }));
    });

    return unsubscribe;
  }, [monitoredUser, user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAlerts();
    setRefreshing(false);
  };

  const handleOpenMyAlerts = async () => {
    await storageService.saveMonitoredUser(null);
    navigation.setParams({ monitoredPatient: undefined });
  };

  const handleOpenPersonAlerts = async (patient: User) => {
    await storageService.saveMonitoredUser(patient);
    navigation.setParams({ monitoredPatient: patient });
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
    if (monitoredUser) return;
    try {
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
    if (monitoredUser) return;
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

  const handleImFine = async (alertId: number) => {
    if (monitoredUser) return;
    try {
      const response = await apiService.resolveAlert(alertId);
      if (response.success) {
        RNAlert.alert(t('common.success'), t('alerts.imFineConfirmed'));
        await loadAlerts();
      } else {
        RNAlert.alert(t('common.error'), response.message || t('alerts.resolveFailed'));
      }
    } catch (error) {
      RNAlert.alert(t('common.error'), t('alerts.resolveFailed'));
    }
  };

  const stats = getAlertStats();
  const showingVitalsStatus = latestVitalsStatus && ['requested', 'measuring', 'complete'].includes(latestVitalsStatus.state);
  const statusHeartRate = latestVitalsStatus?.heart_rate_valid ? latestVitalsStatus.heart_rate : lastValidVitals.heartRate;
  const statusSpo2 = latestVitalsStatus?.spo2_valid ? latestVitalsStatus.spo2 : lastValidVitals.spo2;
  const statusProgress = Math.max(0, Math.min(100, Math.round(latestVitalsStatus?.progress_percent ?? 0)));
  const groupedAlerts = alerts.reduce<Record<string, AlertType[]>>((groups, alert) => {
    const alertDate = new Date(alert.timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    let key = t('datetime.today');
    if (alertDate.toDateString() === yesterday.toDateString()) {
      key = t('datetime.yesterday');
    } else if (alertDate.toDateString() !== today.toDateString()) {
      key = alertDate.toLocaleDateString();
    }

    groups[key] = groups[key] || [];
    groups[key].push(alert);
    return groups;
  }, {});

  return (
    <SafeAreaView className="flex-1 bg-light">
      <ScrollView
        ref={scrollRef}
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
        <ScreenHeader
          title={monitoredUser ? t('alerts.forPerson', { name: monitoredUser.name }) : t('alerts.historyTitle')}
          subtitle={monitoredUser ? t('dashboard.shortDesc') : t('alerts.historySubtitle')}
          showBack={Boolean(monitoredUser)}
          onBack={() => {
            if (monitoredUser) {
              navigation.navigate('Settings', {
                screen: 'MonitoredPatient',
                params: { patient: monitoredUser },
              });
            }
          }}
        />

        <View className="mx-4 mb-5 bg-white border border-lightGray rounded-2xl p-4 shadow-sm">
          <Text className="text-sm font-semibold text-dark mb-2">
            {t('care.selected')}
          </Text>
          <Text className="text-xs text-gray mb-1">
            {monitoredUser ? t('care.monitoring') : t('dashboard.myData')}
          </Text>
          <Text className="text-sm font-semibold text-dark">
            {monitoredUser ? monitoredUser.name : user?.name || t('common.unknown')}
          </Text>
          {monitoredUser?.email ? (
            <Text className="text-xs text-gray mt-1">{monitoredUser.email}</Text>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
            <TouchableOpacity
              className={`px-4 py-2 rounded-full mr-2 ${!monitoredUser ? 'bg-primary' : 'bg-lightGray'}`}
              onPress={handleOpenMyAlerts}
            >
              <Text className={`${!monitoredUser ? 'text-white' : 'text-dark'} text-xs font-semibold`}>
                {t('dashboard.myData')}
              </Text>
            </TouchableOpacity>
            {links.map((link) =>
              link.patient ? (
                <TouchableOpacity
                  key={link.id}
                  className={`px-4 py-2 rounded-full mr-2 ${
                    monitoredUser?.id === link.patient.id ? 'bg-primary' : 'bg-lightGray'
                  }`}
                  onPress={() => handleOpenPersonAlerts(link.patient!)}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      monitoredUser?.id === link.patient.id ? 'text-white' : 'text-dark'
                    }`}
                  >
                    {link.patient.name}
                  </Text>
                </TouchableOpacity>
              ) : null
            )}
          </ScrollView>
          {lastRefreshedAt ? (
            <Text className="text-[10px] text-gray mt-3">
              {t('dashboard.updatedNow', {
                time: lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              })}
            </Text>
          ) : null}
        </View>

        {showingVitalsStatus ? (
          <View className="mx-4 mb-5 bg-red-950 rounded-3xl p-4 border border-red-800">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-xs text-red-100 font-semibold uppercase">
                  {latestVitalsStatus?.vitals_trigger === 'fall_alert' ? 'Fall Alert' : 'Vitals'}
                </Text>
                <Text className="text-lg text-white font-bold mt-1">
                  {latestVitalsStatus?.state === 'complete' ? 'Vitals ready' : 'Measuring vitals...'}
                </Text>
                <Text className="text-xs text-red-100 mt-1">
                  {latestVitalsStatus?.finger_detected ? latestVitalsStatus?.signal_status || 'Signal detected' : 'Place finger properly'}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-sm text-white font-bold">HR {statusHeartRate ? Math.round(statusHeartRate) : '--'}</Text>
                <Text className="text-sm text-white font-bold mt-1">SpO2 {statusSpo2 ? Math.round(statusSpo2) : '--'}%</Text>
              </View>
            </View>
            <View className="mt-4 h-2 rounded-full bg-white/15 overflow-hidden">
              <View className="h-2 rounded-full bg-red-300" style={{ width: `${statusProgress}%` }} />
            </View>
          </View>
        ) : null}

        {/* Statistics Overview */}
        <View className="mx-4 mb-6">
          <View className="flex-row justify-between mb-3">
            <View className="items-center flex-1 p-4 bg-blue-50 border border-primary/20 rounded-2xl mx-1 shadow-sm">
              <Text className="text-primary text-[10px] font-semibold uppercase mb-1">{t('alerts.totalAlerts')}</Text>
              <Text className="text-3xl font-bold text-primary">{stats.total}</Text>
            </View>
            
            <View className="items-center flex-1 p-4 bg-orange-50 border border-warning/20 rounded-2xl mx-1 shadow-sm">
              <Text className="text-warning text-[10px] font-semibold uppercase mb-1">{t('alerts.pending')}</Text>
              <Text className="text-3xl font-bold text-warning">{stats.pending}</Text>
            </View>
          </View>
          
          <View className="flex-row justify-between">
            <View className="items-center flex-1 p-4 bg-green-50 border border-success/20 rounded-2xl mx-1 shadow-sm">
              <Text className="text-success text-[10px] font-semibold uppercase mb-1">{t('alerts.resolved')}</Text>
              <Text className="text-3xl font-bold text-success">{stats.resolved}</Text>
            </View>
            
            <View className="items-center flex-1 p-4 bg-red-50 border border-danger/20 rounded-2xl mx-1 shadow-sm">
              <Text className="text-danger text-[10px] font-semibold uppercase mb-1">{t('alerts.critical')}</Text>
              <Text className="text-3xl font-bold text-danger">{stats.critical}</Text>
            </View>
          </View>
          
          {/* Last Updated */}
          <View className="mt-4 items-center">
            <Text className="text-xs text-gray">
              {t('dashboard.updatedNow', {
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              })}
            </Text>
          </View>
        </View>

        {/* Filter Section */}
        <View className="mx-4 mb-6 bg-white rounded-2xl border border-lightGray p-4 shadow-sm">
          <Text className="text-base font-bold text-dark mb-4">{t('alerts.filterAlerts')}</Text>
          
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
                <Text className={`text-sm font-semibold ${
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
          <View className="flex-row items-center justify-between p-3 bg-blue-50 rounded-xl border border-primary/10">
            <Text className="text-sm font-medium text-dark">
              {t('alerts.showingSummary', { count: alerts.length })}
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
            <Text className="text-base text-gray">
              {t('alerts.loading')}
            </Text>
          </View>
        ) : alerts.length > 0 ? (
          <View className="mx-2 mb-8">
            {Object.entries(groupedAlerts).map(([group, items]) => (
              <View key={group} className="mb-5">
                <Text className="text-sm font-bold text-dark mx-4 mb-3">{group}</Text>
                {items.map((alert, index) => (
                  <View key={alert.id} className={`mb-3 ${index > 0 ? 'mt-3' : ''}`}>
                    {monitoredUser ? (
                      <Text className="text-[10px] text-gray mx-4 mb-1">{monitoredUser.name}</Text>
                    ) : null}
                    <AlertCard
                      alert={alert}
                      onAcknowledge={monitoredUser ? undefined : () => handleAcknowledge(alert.id)}
                      onResolve={monitoredUser ? undefined : () => handleResolve(alert.id)}
                      onImFine={monitoredUser ? undefined : () => handleImFine(alert.id)}
                    />
                  </View>
                ))}
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
              <Text className="text-lg font-semibold text-dark">{t('alerts.importantNotes')}</Text>
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
