import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useLanguage } from '../components/LanguageProvider';
import { authService } from '../services/auth.service';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { CareDashboardItem, CareLink, User } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';
import { realtimeService } from '../services/realtime.service';

export const CaregiverDashboardScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [dashboardItems, setDashboardItems] = useState<CareDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'critical' | 'pending' | 'stable'>('all');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePulseAnim = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const init = async () => {
      await loadDashboard();
    };
    init().catch(() => undefined);
    const clockId = setInterval(() => {
      setClockTick(Date.now());
    }, 30000);
    return () => {
      clearInterval(clockId);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(livePulseAnim, {
          toValue: 0.55,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();

    return () => {
      pulseLoop.stop();
    };
  }, [livePulseAnim]);

  const scheduleRealtimeRefresh = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      loadDashboard().catch(() => undefined);
    }, 350);
  };

  const loadDashboard = async () => {
    try {
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
        await storageService.saveUser(normalizedSessionUser);
      }
      setUser(normalizedSessionUser);

      if (!normalizedSessionUser) {
        setLinks([]);
        setDashboardItems([]);
        return;
      }

      const [careResponse, dashboardResponse] = await Promise.all([
        apiService.getCareLinks(normalizedSessionUser.id),
        apiService.getCareDashboard(normalizedSessionUser.id),
      ]);

      setLinks(careResponse.success && careResponse.data ? careResponse.data : []);
      setDashboardItems(dashboardResponse.success && dashboardResponse.data ? dashboardResponse.data : []);
      setLastRefreshedAt(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = realtimeService.subscribe('all', (event) => {
      if (!event?.resource) return;

      const payloadUserId =
        typeof event.payload?.user_id === 'number'
          ? event.payload.user_id
          : typeof event.payload?.id === 'number' && event.resource === 'profile'
          ? event.payload.id
          : null;

      const isLinkedPatientEvent =
        payloadUserId == null || links.some((link) => link.patient_id === payloadUserId);

      if (!isLinkedPatientEvent && event.resource !== 'care') {
        return;
      }

      if (['care', 'vitals', 'alerts', 'profile', 'devices', 'motions', 'predictions'].includes(event.resource)) {
        scheduleRealtimeRefresh();
      }
    });

    return unsubscribe;
  }, [links]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  };

  const handleOpenPatient = async (patient: User) => {
    await storageService.saveMonitoredUser(patient);
    navigation.navigate('MonitoredPatient', { patient });
  };

  const cards = dashboardItems.length > 0
    ? dashboardItems
    : links
        .filter((link) => Boolean(link.patient))
        .map((link) => ({
          patient: link.patient!,
          relationship: link.relationship,
          vitals: undefined,
          alerts: undefined,
        }));

  const getCardPriority = (item: typeof cards[number]) => {
    const severity = item.alerts?.last?.severity;
    const pending = item.alerts?.pending ?? 0;
    const abnormal = item.vitals?.is_abnormal;
    if (severity === 'critical') return 0;
    if (pending > 0) return 1;
    if (abnormal) return 2;
    return 3;
  };

  const criticalCount = cards.filter((item) => item.alerts?.last?.severity === 'critical').length;

  const formatLiveStatus = (timestamp?: string | null) => {
    if (!timestamp) return null;

    const diffMs = Math.max(0, clockTick - new Date(timestamp).getTime());
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) {
      return t('settings.deviceQuickLive');
    }

    if (diffMinutes < 5) {
      return t('dashboard.updatedJustNow');
    }

    if (diffMinutes < 60) {
      return t('datetime.minutesAgo', { count: diffMinutes });
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return t('datetime.hoursAgo', { count: diffHours });
    }

    return new Date(timestamp).toLocaleDateString();
  };

  const isLiveNow = (timestamp?: string | null) => {
    if (!timestamp) return false;
    const diffMs = Math.max(0, clockTick - new Date(timestamp).getTime());
    return diffMs < 60000;
  };

  const filteredCards = cards
    .filter((item) =>
      item.patient.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
    )
    .filter((item) => {
      if (filterMode === 'critical') return item.alerts?.last?.severity === 'critical';
      if (filterMode === 'pending') return (item.alerts?.pending ?? 0) > 0;
      if (filterMode === 'stable') {
        return (item.alerts?.pending ?? 0) === 0 && item.alerts?.last?.severity !== 'critical' && !item.vitals?.is_abnormal;
      }
      return true;
    })
    .sort((a, b) => {
      const priorityDiff = getCardPriority(a) - getCardPriority(b);
      if (priorityDiff !== 0) return priorityDiff;

      const aTime = new Date(
        a.alerts?.last?.timestamp || a.vitals?.timestamp || a.patient.created_at
      ).getTime();
      const bTime = new Date(
        b.alerts?.last?.timestamp || b.vitals?.timestamp || b.patient.created_at
      ).getTime();
      return bTime - aTime;
    });

  return (
    <ScrollView
      className="flex-1 bg-light"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <ScreenHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        showBack
      />

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-sm font-semibold text-dark mb-2">{t('care.listTitle')}</Text>
        <Text className="text-xs text-gray">
          {t('dashboard.choosePersonHint')}
        </Text>
        {criticalCount > 0 ? (
          <View className="mt-4 rounded-2xl border border-danger/20 bg-red-50 px-4 py-3">
            <Text className="text-sm font-semibold text-danger">
              {criticalCount} {t('dashboard.criticalBanner')}
            </Text>
          </View>
        ) : null}
        <TextInput
          className="input-field mt-4"
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('dashboard.searchPlaceholder')}
          placeholderTextColor="#BDBDBD"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4">
          {(['all', 'critical', 'pending', 'stable'] as const).map((mode) => (
            <TouchableOpacity
              key={mode}
              className={`px-4 py-2 rounded-full mr-2 ${filterMode === mode ? 'bg-primary' : 'bg-lightGray'}`}
              onPress={() => setFilterMode(mode)}
            >
              <Text className={`text-xs font-semibold ${filterMode === mode ? 'text-white' : 'text-dark'}`}>
                {mode === 'all'
                  ? t('common.all')
                  : mode === 'critical'
                  ? t('alerts.critical')
                  : mode === 'pending'
                  ? t('alerts.pending')
                  : t('dashboard.stable')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {lastRefreshedAt ? (
          <Text className="text-[10px] text-gray mt-3">
            {t('dashboard.updatedNow', {
              time: lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })}
          </Text>
        ) : null}
      </View>

      {loading ? (
        <View className="mt-8 items-center">
          <ActivityIndicator color="#2196F3" />
        </View>
      ) : (
        <View className="mx-4 mt-4 mb-8">
          {filteredCards.length === 0 ? (
            <View className="bg-white rounded-2xl shadow-lg border border-lightGray p-5 items-center">
              <Text className="text-sm font-medium text-gray text-center">{t('dashboard.noMonitored')}</Text>
              <Text className="text-xs text-lightGray text-center mt-2 px-6">{t('dashboard.noMonitoredHint')}</Text>
              <TouchableOpacity
                className="mt-5 px-5 py-3 rounded-full bg-primary"
                onPress={() => navigation.navigate('CareManagement')}
              >
                <Text className="text-white font-semibold">{t('settings.careManagement')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredCards.map((item) => {
              const pendingCount = item.alerts?.pending ?? 0;
              const lastAlert = item.alerts?.last?.message;
              const isCritical = item.alerts?.last?.severity === 'critical';
              const isAbnormal = Boolean(item.vitals?.is_abnormal);
              const lastUpdated = item.alerts?.last?.timestamp || item.vitals?.timestamp;
              const liveStatus = formatLiveStatus(lastUpdated);
              const liveNow = isLiveNow(lastUpdated);
              const cardTone = isCritical
                ? 'border-danger bg-red-50'
                : pendingCount > 0
                ? 'border-warning bg-orange-50'
                : isAbnormal
                ? 'border-orange-300 bg-orange-50/60'
                : 'border-lightGray bg-white';
              const actionTone = isCritical ? 'bg-danger' : 'bg-primary';

              return (
                <TouchableOpacity
                  key={item.patient.id}
                  className={`rounded-2xl shadow-lg border p-4 mb-4 ${cardTone}`}
                  activeOpacity={0.85}
                  onPress={() => handleOpenPatient(item.patient)}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <Text className="text-[10px] font-semibold uppercase tracking-widest text-gray">
                      {t('dashboard.monitoring')}
                    </Text>
                    {isCritical ? (
                      <View className="px-2 py-1 rounded-full bg-danger">
                        <Text className="text-[10px] font-semibold text-white">{t('alerts.critical')}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-3">
                      <View className="flex-row items-center flex-wrap">
                        <Text className="text-base font-bold text-dark">{item.patient.name}</Text>
                        {liveNow ? (
                          <View className="flex-row items-center ml-2 mt-[2px]">
                            <Animated.View
                              style={{ opacity: livePulseAnim, transform: [{ scale: livePulseAnim }] }}
                              className="w-2.5 h-2.5 rounded-full bg-green-500 mr-1.5"
                            />
                            <Text className="text-[10px] font-semibold text-success">
                              {t('settings.deviceQuickLive')}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {item.relationship ? (
                        <Text className="text-xs text-gray mt-1">{item.relationship}</Text>
                      ) : null}
                      {item.patient.email ? (
                        <Text className="text-xs text-gray mt-1">{item.patient.email}</Text>
                      ) : null}
                      <View className="flex-row flex-wrap mt-2">
                        {pendingCount > 0 ? (
                          <View className="px-2 py-1 rounded-full bg-warning mr-2 mb-2">
                            <Text className="text-[10px] font-semibold text-white">
                              {pendingCount} {t('dashboard.pendingBadge')}
                            </Text>
                          </View>
                        ) : null}
                        {isAbnormal ? (
                          <View className="px-2 py-1 rounded-full bg-orange-100 mr-2 mb-2">
                            <Text className="text-[10px] font-semibold text-warning">{t('dashboard.abnormalVitals')}</Text>
                          </View>
                        ) : (
                          <View className="px-2 py-1 rounded-full bg-green-100 mr-2 mb-2">
                            <Text className="text-[10px] font-semibold text-success">{t('dashboard.stable')}</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    <View className={`px-3 py-2 rounded-full ${actionTone}`}>
                      <Text className="text-xs font-semibold text-white">{t('dashboard.view')}</Text>
                    </View>
                  </View>

                  <View className="flex-row justify-between mt-4 bg-white/80 rounded-2xl px-3 py-3">
                    <View className="flex-1">
                      <Text className="text-[10px] text-gray mb-1">{t('vitals.heartRate')}</Text>
                      <Text className="text-sm font-semibold text-dark">
                        {item.vitals?.heart_rate ?? '--'} {t('vitals.bpm')}
                      </Text>
                    </View>
                    <View className="flex-1 items-center">
                      <Text className="text-[10px] text-gray mb-1">{t('vitals.oxygenSaturation')}</Text>
                      <Text className="text-sm font-semibold text-dark">
                        {item.vitals?.oxygen_saturation ?? '--'} {t('vitals.percent')}
                      </Text>
                    </View>
                    <View className="flex-1 items-end">
                      <Text className="text-[10px] text-gray mb-1">{t('alerts.pending')}</Text>
                      <Text className="text-sm font-semibold text-dark">{pendingCount}</Text>
                    </View>
                  </View>

                  <View className="flex-row justify-between mt-3">
                    <View>
                      <Text className="text-[10px] text-gray">{t('dashboard.lastUpdated')}</Text>
                      {liveStatus ? (
                        <Text className="text-[10px] font-semibold text-primary mt-1">
                          {liveStatus}
                        </Text>
                      ) : null}
                    </View>
                    <Text className="text-[10px] text-gray text-right">
                      {lastUpdated ? new Date(lastUpdated).toLocaleString() : '--'}
                    </Text>
                  </View>

                  {lastAlert ? (
                    <View className="mt-3 p-3 rounded-xl bg-white/85 border border-lightGray">
                      <View className="flex-row items-center mb-1">
                        <MaterialCommunityIcons name="bell-alert-outline" size={14} color="#FF9800" />
                        <Text className="text-[10px] text-gray ml-1">{t('dashboard.latestAlert')}</Text>
                      </View>
                      <Text className="text-xs text-dark" numberOfLines={2}>
                        {lastAlert}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-[10px] text-gray mt-3">{t('dashboard.noAlerts')}</Text>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}
    </ScrollView>
  );
};
