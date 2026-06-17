import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { LineChart } from 'react-native-chart-kit';
import { useLanguage } from '../components/LanguageProvider';
import { apiService } from '../services/api';
import { authService } from '../services/auth.service';
import { notificationService } from '../services/notifications';
import { storageService } from '../services/storage';
import { realtimeService } from '../services/realtime.service';
import { ScreenHeader } from '../components/ScreenHeader';
import { Alert as AlertType, CareLink, Device, LastKnownLocation, User, VitalData } from '../types';
import { SettingsStackParamList } from '../navigation/AppNavigator';
import { parseApiDate } from '../utils/helpers';

type MonitoredPatientRouteProp = RouteProp<SettingsStackParamList, 'MonitoredPatient'>;

export const MonitoredPatientScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const route = useRoute<MonitoredPatientRouteProp>();
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [patient, setPatient] = useState<User>(route.params.patient);
  const [vitals, setVitals] = useState<VitalData | null>(null);
  const [vitalsHistory, setVitalsHistory] = useState<VitalData[]>([]);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [location, setLocation] = useState<LastKnownLocation | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({});

  useEffect(() => {
    storageService.saveMonitoredUser(patient).catch(() => undefined);
    loadData();
  }, [patient.id]);

  useEffect(() => {
    const unsubscribe = realtimeService.subscribe('all', (event) => {
      if (event.user_id && event.user_id !== patient.id) return;
      if (!event.payload) return;

      if (event.resource === 'vitals') {
        setVitals(event.payload);
        setVitalsHistory((prev) => [...prev, event.payload].slice(-10));
      }

      if (event.resource === 'alerts') {
        setAlerts((prev) => {
          const exists = prev.find((item) => item.id === event.payload.id);
          const next = exists
            ? prev.map((item) => (item.id === event.payload.id ? { ...item, ...event.payload } : item))
            : [event.payload, ...prev];

          if (
            !exists &&
            (event.payload.status === 'pending' || event.payload.status === 'sent') &&
            (event.payload.alert_type === 'fall' || event.payload.alert_type === 'fall_now')
          ) {
            notificationService.sendFallAlert(event.payload, patient.name, patient.id);
          }

          return next.slice(0, 10);
        });
      }

      if (event.resource === 'profile' && event.payload?.id === patient.id) {
        const nextPatient = { ...patient, ...event.payload };
        setPatient(nextPatient);
        storageService.saveMonitoredUser(nextPatient).catch(() => undefined);
      }
    });

    return unsubscribe;
  }, [patient]);

  const loadData = async () => {
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

      setUser(normalizedSessionUser);
      if (normalizedSessionUser?.id) {
        const careResponse = await apiService.getCareLinks(normalizedSessionUser.id);
        setLinks(careResponse.success && careResponse.data ? careResponse.data : []);
      }

      const [vitalsResponse, alertsResponse, locationResponse, deviceResponse] = await Promise.all([
        apiService.getUserVitals(patient.id, 10),
        apiService.getUserAlerts(patient.id, 5),
        apiService.getLastLocation(patient.id),
        apiService.getUserDevice(patient.id),
      ]);

      if (vitalsResponse.success && vitalsResponse.data && vitalsResponse.data.length > 0) {
        const ordered = [...vitalsResponse.data].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        setVitalsHistory(ordered);
        setVitals(ordered[ordered.length - 1]);
      } else {
        setVitals(null);
        setVitalsHistory([]);
      }

      setAlerts(alertsResponse.success && alertsResponse.data ? alertsResponse.data : []);
      setLocation(locationResponse.success ? locationResponse.data ?? null : null);
      setDevice(deviceResponse.success ? deviceResponse.data ?? null : null);
      setLastRefreshedAt(new Date());
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSelectPatient = async (nextPatient: User) => {
    setPatient(nextPatient);
    await storageService.saveMonitoredUser(nextPatient);
  };

  const handleOpenMyPage = async () => {
    await storageService.saveMonitoredUser(null);
    navigation.getParent?.()?.navigate?.('Home');
  };

  const stats = useMemo(() => {
    const total = alerts.length;
    const pending = alerts.filter((a) => a.status === 'pending' || a.status === 'sent').length;
    const critical = alerts.filter((a) => a.severity === 'critical').length;
    return { total, pending, critical };
  }, [alerts]);
  const relationship = links.find((link) => link.patient?.id === patient.id)?.relationship;
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical').length;

  const formatRelativeTime = (dateString?: string | null) => {
    const date = parseApiDate(dateString);
    if (!date) return '--';
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.max(1, Math.floor(diffMs / 60000));
    if (diffMins < 60) return t('datetime.minutesAgo', { count: diffMins });
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffHours < 24) return t('datetime.hoursAgo', { count: diffHours });
    return date.toLocaleString();
  };

  const scrollToSection = (section: string) => {
    const y = sectionOffsets.current[section];
    if (typeof y === 'number') {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
    }
  };

  const hasLocation = location?.lat != null && location?.lng != null;
  const chartWidth = Dimensions.get('window').width - 64;
  const chartData = vitalsHistory
    .map((item) => item.heart_rate ?? 0)
    .filter((value) => Number.isFinite(value));
  const chartLabels = vitalsHistory.map((item) => {
    const date = new Date(item.timestamp);
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  });
  const timelineItems = [
    ...alerts.map((alert) => ({
      id: `alert-${alert.id}`,
      type: 'alert' as const,
      timestamp: alert.timestamp,
      title: alert.message,
      subtitle: `${t('alerts.type')}: ${alert.alert_type} • ${alert.severity}`,
    })),
    ...vitalsHistory.map((item, index) => ({
      id: `vitals-${item.id || index}`,
      type: 'vitals' as const,
      timestamp: item.timestamp,
      title: t('dashboard.vitals'),
      subtitle: `${t('vitals.heartRate')}: ${item.heart_rate ?? '--'} ${t('vitals.bpm')} • ${t('vitals.oxygenSaturation')}: ${item.oxygen_saturation ?? '--'} ${t('vitals.percent')}`,
    })),
    ...(location?.timestamp
      ? [{
          id: 'location',
          type: 'location' as const,
          timestamp: location.timestamp,
          title: t('dashboard.location'),
          subtitle: `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`,
        }]
      : []),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-light"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <ScreenHeader
        title={patient.name}
        subtitle={t('dashboard.shortDesc')}
        showBack
      />

      {loading ? (
        <View className="mt-8 items-center">
          <ActivityIndicator color="#2196F3" />
        </View>
      ) : (
        <>
          {criticalAlerts > 0 ? (
            <View className="mx-4 mt-4 rounded-2xl border border-danger/20 bg-red-50 px-4 py-3">
              <Text className="text-sm font-semibold text-danger">
                {criticalAlerts} {t('dashboard.criticalBannerForPatient', { name: patient.name })}
              </Text>
            </View>
          ) : null}

          <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-2">{t('care.selected')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TouchableOpacity
                className="px-4 py-2 rounded-full mr-2 bg-lightGray"
                onPress={handleOpenMyPage}
              >
                <Text className="text-xs font-semibold text-dark">{t('dashboard.myData')}</Text>
              </TouchableOpacity>
              {links.map((link) =>
                link.patient ? (
                  <TouchableOpacity
                    key={link.id}
                    className={`px-4 py-2 rounded-full mr-2 ${
                      patient.id === link.patient.id ? 'bg-primary' : 'bg-lightGray'
                    }`}
                    onPress={() => handleSelectPatient(link.patient!)}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        patient.id === link.patient.id ? 'text-white' : 'text-dark'
                      }`}
                    >
                      {link.patient.name}
                    </Text>
                  </TouchableOpacity>
                ) : null
              )}
            </ScrollView>
          </View>

          <View className="mx-4 mt-4 rounded-2xl shadow-lg border border-primary/20 bg-primary/5 p-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-primary mb-2">
                  {t('care.monitoring')}
                </Text>
                <Text className="text-base font-bold text-dark">{patient.name}</Text>
                {patient.email ? <Text className="text-xs text-gray mt-1">{patient.email}</Text> : null}
              </View>
              <View className="w-11 h-11 rounded-full bg-primary items-center justify-center">
                <MaterialCommunityIcons name="account-heart-outline" size={22} color="#FFFFFF" />
              </View>
            </View>
            <View className="flex-row justify-between mt-4 bg-white/80 rounded-2xl px-3 py-3">
              <View className="items-center flex-1">
                <Text className="text-[10px] text-gray mb-1">{t('common.years')}</Text>
                <Text className="text-xs font-semibold text-dark">{patient.age || '--'}</Text>
              </View>
              <View className="items-center flex-1 border-x border-lightGray">
                <Text className="text-[10px] text-gray mb-1">{t('settings.personalInfo')}</Text>
                <Text className="text-xs font-semibold text-dark">{patient.gender || '--'}</Text>
              </View>
              <View className="items-center flex-1">
                <Text className="text-[10px] text-gray mb-1">{t('care.relationshipShort')}</Text>
                <Text className="text-xs font-semibold text-dark">{relationship || '--'}</Text>
              </View>
            </View>
            {lastRefreshedAt ? (
              <Text className="text-[10px] text-gray mt-3">
                {t('dashboard.updatedNow', {
                  time: lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                })}
              </Text>
            ) : null}
          </View>

          <View className="mx-4 mt-5 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.quickActions')}</Text>
            <View className="flex-row">
              <TouchableOpacity
                className="flex-1 rounded-xl bg-blue-50 border border-primary/20 py-3 items-center mr-2"
                onPress={() => navigation.getParent?.()?.navigate?.('Alerts', { monitoredPatient: patient })}
              >
                <Text className="text-xs font-semibold text-primary">{t('dashboard.openAlerts')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-xl bg-green-50 border border-success/20 py-3 items-center mx-1"
                onPress={() => scrollToSection('vitals')}
              >
                <Text className="text-xs font-semibold text-success">{t('dashboard.openVitals')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-xl bg-orange-50 border border-warning/20 py-3 items-center ml-2"
                onPress={() => scrollToSection('location')}
              >
                <Text className="text-xs font-semibold text-warning">{t('dashboard.openLocation')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View
            className="mx-4 mt-5 bg-white rounded-2xl shadow-lg border border-lightGray p-4"
            onLayout={(event) => {
              sectionOffsets.current.device = event.nativeEvent.layout.y;
            }}
          >
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.deviceStatus')}</Text>
            <View className="bg-lightGray/30 rounded-2xl px-3 py-3">
              <View className="flex-row justify-between mb-3">
                <Text className="text-xs text-gray">{t('settings.deviceInfo')}</Text>
                <Text
                  className={`text-sm font-semibold ${
                    device?.device_status === 'active'
                      ? 'text-success'
                      : device?.device_status === 'connected_no_data'
                      ? 'text-warning'
                      : device
                      ? 'text-danger'
                      : 'text-gray'
                  }`}
                >
                  {device?.device_status_label || device?.connection_state || t('dashboard.noDeviceAssigned')}
                </Text>
              </View>
              <View className="flex-row justify-between mb-3">
                <Text className="text-xs text-gray">{t('dashboard.batteryLevel')}</Text>
                <Text className="text-sm font-semibold text-dark">
                  {device?.battery_level != null ? `${Math.round(device.battery_level)}%` : '--'}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-xs text-gray">{t('dashboard.lastSync')}</Text>
                <Text className="text-sm font-semibold text-dark">
                  {device?.latest_data_at || device?.last_seen
                    ? formatRelativeTime(device.latest_data_at || device.last_seen || '')
                    : '--'}
                </Text>
              </View>
            </View>
          </View>

          <View
            className="mx-4 mt-5 bg-white rounded-2xl shadow-lg border border-lightGray p-4"
            onLayout={(event) => {
              sectionOffsets.current.vitals = event.nativeEvent.layout.y;
            }}
          >
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.vitals')}</Text>
            {vitals ? (
              <View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-xs text-gray">{t('vitals.heartRate')}</Text>
                  <Text className="text-sm font-semibold text-dark">{vitals.heart_rate ?? '--'} {t('vitals.bpm')}</Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-xs text-gray">{t('vitals.oxygenSaturation')}</Text>
                  <Text className="text-sm font-semibold text-dark">{vitals.oxygen_saturation ?? '--'} {t('vitals.percent')}</Text>
                </View>
                {chartData.length > 1 ? (
                  <View className="mt-4">
                    <Text className="text-xs text-gray mb-2">{t('dashboard.heartRateTrend')}</Text>
                    <LineChart
                      data={{ labels: chartLabels.slice(-5), datasets: [{ data: chartData.slice(-5) }] }}
                      width={chartWidth}
                      height={160}
                      withDots
                      withInnerLines={false}
                      withOuterLines={false}
                      withVerticalLines={false}
                      chartConfig={{
                        backgroundGradientFrom: '#FFFFFF',
                        backgroundGradientTo: '#FFFFFF',
                        decimalPlaces: 0,
                        color: (opacity = 1) => `rgba(33, 150, 243, ${opacity})`,
                        labelColor: () => '#9E9E9E',
                        propsForDots: { r: '3', strokeWidth: '1', stroke: '#2196F3' },
                      }}
                      bezier
                      style={{ borderRadius: 12 }}
                    />
                  </View>
                ) : null}
              </View>
            ) : (
              <Text className="text-xs text-gray">{t('dashboard.noRecentVitals')}</Text>
            )}
          </View>

          <View className="mx-4 mt-5 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.alerts')}</Text>
            <View className="flex-row justify-between">
              <View className="items-center flex-1 bg-blue-50 border border-primary/20 rounded-xl py-3 mx-1">
                <Text className="text-primary text-[10px] font-semibold uppercase mb-1">{t('alerts.totalAlerts')}</Text>
                <Text className="text-primary text-lg font-bold">{stats.total}</Text>
              </View>
              <View className="items-center flex-1 bg-orange-50 border border-warning/20 rounded-xl py-3 mx-1">
                <Text className="text-warning text-[10px] font-semibold uppercase mb-1">{t('alerts.pending')}</Text>
                <Text className="text-warning text-lg font-bold">{stats.pending}</Text>
              </View>
              <View className="items-center flex-1 bg-red-50 border border-danger/20 rounded-xl py-3 mx-1">
                <Text className="text-danger text-[10px] font-semibold uppercase mb-1">{t('alerts.critical')}</Text>
                <Text className="text-danger text-lg font-bold">{stats.critical}</Text>
              </View>
            </View>
            <Text className="text-[10px] text-gray mt-3">
              {t('dashboard.lastUpdated')}: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>

            {alerts.length > 0 ? (
              <View className="mt-4">
                {alerts.map((alert) => (
                  <View key={alert.id} className="mb-3 p-3 rounded-xl bg-lightGray/40">
                    <Text className="text-xs text-dark font-semibold">{alert.message}</Text>
                    <Text className="text-[10px] text-gray mt-1">{new Date(alert.timestamp).toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-xs text-gray mt-3">{t('dashboard.noAlerts')}</Text>
            )}
          </View>

          <View
            className="mx-4 mt-5 mb-8 bg-white rounded-2xl shadow-lg border border-lightGray p-4"
            onLayout={(event) => {
              sectionOffsets.current.location = event.nativeEvent.layout.y;
            }}
          >
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.location')}</Text>
            {hasLocation ? (
              <View className="h-44 rounded-xl overflow-hidden">
                <MapView
                  style={{ flex: 1 }}
                  initialRegion={{
                    latitude: location!.lat,
                    longitude: location!.lng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                >
                  <Marker
                    coordinate={{ latitude: location!.lat, longitude: location!.lng }}
                    title={t('dashboard.lastKnown')}
                    description={location?.timestamp ? new Date(location.timestamp).toLocaleString() : undefined}
                  />
                </MapView>
              </View>
            ) : (
              <Text className="text-xs text-gray">{t('dashboard.noLocation')}</Text>
            )}

            <TouchableOpacity
              className="bg-primary rounded-xl py-3 items-center mt-4"
              onPress={() => navigation.getParent?.()?.navigate?.('Alerts', { monitoredPatient: patient })}
            >
              <Text className="text-white font-semibold">{t('dashboard.openAlerts')}</Text>
            </TouchableOpacity>
          </View>

          <View className="mx-4 mt-5 mb-8 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.timeline')}</Text>
            {timelineItems.length > 0 ? (
              timelineItems.map((item, index) => (
                <View key={item.id} className="flex-row mb-4">
                  <View className="items-center mr-3">
                    <View
                      className={`w-8 h-8 rounded-full items-center justify-center ${
                        item.type === 'alert'
                          ? 'bg-red-100'
                          : item.type === 'location'
                          ? 'bg-blue-100'
                          : 'bg-green-100'
                      }`}
                    >
                      <MaterialCommunityIcons
                        name={
                          item.type === 'alert'
                            ? 'bell-alert-outline'
                            : item.type === 'location'
                            ? 'map-marker-outline'
                            : 'heart-pulse'
                        }
                        size={16}
                        color={item.type === 'alert' ? '#F44336' : item.type === 'location' ? '#2196F3' : '#4CAF50'}
                      />
                    </View>
                    {index < timelineItems.length - 1 ? <View className="w-px flex-1 bg-lightGray mt-1" /> : null}
                  </View>
                  <View className="flex-1 rounded-2xl bg-lightGray/20 border border-lightGray px-3 py-3">
                    <Text className="text-sm font-semibold text-dark">{item.title}</Text>
                    <Text className="text-xs text-gray mt-1">{item.subtitle}</Text>
                    <Text className="text-[10px] text-gray mt-1">{new Date(item.timestamp).toLocaleString()}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text className="text-xs text-gray">{t('dashboard.noTimeline')}</Text>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
};
