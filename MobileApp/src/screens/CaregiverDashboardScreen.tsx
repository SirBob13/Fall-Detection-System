import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useLanguage } from '../components/LanguageProvider';
import { authService } from '../services/auth.service';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { Alert as AlertType, CareDashboardItem, CareLink, LastKnownLocation, User, VitalData } from '../types';
import { LineChart } from 'react-native-chart-kit';
import { Dimensions } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';

export const CaregiverDashboardScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [monitoredUser, setMonitoredUser] = useState<User | null>(null);
  const [vitals, setVitals] = useState<VitalData | null>(null);
  const [vitalsHistory, setVitalsHistory] = useState<VitalData[]>([]);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [location, setLocation] = useState<LastKnownLocation | null>(null);
  const [dashboardItems, setDashboardItems] = useState<CareDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const init = async () => {
      await loadDashboard();
      intervalId = setInterval(loadDashboard, 15000);
    };
    init();
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const activeUser = monitoredUser || user;

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

      const storedMonitored = await storageService.getMonitoredUser();
      setMonitoredUser(storedMonitored);

      if (normalizedSessionUser) {
        const careResponse = await apiService.getCareLinks(normalizedSessionUser.id);
        if (careResponse.success && careResponse.data) {
          setLinks(careResponse.data);
        }

        const dashboardResponse = await apiService.getCareDashboard(normalizedSessionUser.id);
        if (dashboardResponse.success && dashboardResponse.data) {
          setDashboardItems(dashboardResponse.data);
        } else {
          setDashboardItems([]);
        }
      }

      const active = storedMonitored || normalizedSessionUser;
      if (!active) {
        setVitals(null);
        setAlerts([]);
        setLocation(null);
        setVitalsHistory([]);
        return;
      }

      const [vitalsResponse, alertsResponse, locationResponse] = await Promise.all([
        apiService.getUserVitals(active.id, 10),
        apiService.getUserAlerts(active.id, 5),
        apiService.getLastLocation(active.id),
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

      if (alertsResponse.success && alertsResponse.data) {
        setAlerts(alertsResponse.data);
      } else {
        setAlerts([]);
      }

      if (locationResponse.success) {
        setLocation(locationResponse.data ?? null);
      } else {
        setLocation(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  };

  const handleSelect = async (link: CareLink | null) => {
    if (!link || !link.patient) {
      await storageService.saveMonitoredUser(null);
      setMonitoredUser(null);
      return;
    }
    await storageService.saveMonitoredUser(link.patient);
    setMonitoredUser(link.patient);
  };

  const stats = useMemo(() => {
    const total = alerts.length;
    const pending = alerts.filter((a) => a.status === 'pending' || a.status === 'sent').length;
    const critical = alerts.filter((a) => a.severity === 'critical').length;
    return { total, pending, critical };
  }, [alerts]);

  const heartRate = vitals?.heart_rate;
  const oxygen = vitals?.oxygen_saturation;
  const bpSys = vitals?.blood_pressure_systolic;
  const bpDia = vitals?.blood_pressure_diastolic;
  const temp = vitals?.body_temperature;

  const hasLocation = location?.lat != null && location?.lng != null;
  const chartWidth = Dimensions.get('window').width - 64;
  const chartData = vitalsHistory
    .map((item) => (item.heart_rate ?? 0))
    .filter((value) => Number.isFinite(value));
  const chartLabels = vitalsHistory.map((item) => {
    const date = new Date(item.timestamp);
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  });

  return (
    <ScrollView
      className="flex-1 bg-light"
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <ScreenHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-sm font-semibold text-dark mb-2">{t('dashboard.monitoring')}</Text>
        {activeUser ? (
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-base font-semibold text-dark">{activeUser.name}</Text>
              {activeUser.email ? (
                <Text className="text-xs text-gray mt-1">{activeUser.email}</Text>
              ) : null}
            </View>
            <View className="flex-row items-center">
              <MaterialCommunityIcons name="account-heart" size={18} color="#4CAF50" />
              <Text className="text-xs text-success ml-2">{t('dashboard.live')}</Text>
            </View>
          </View>
        ) : (
          <Text className="text-xs text-gray">{t('dashboard.noUser')}</Text>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
          <TouchableOpacity
            className={`px-3 py-2 rounded-full mr-2 ${!monitoredUser ? 'bg-primary' : 'bg-lightGray'}`}
            onPress={() => handleSelect(null)}
          >
            <Text className={`${!monitoredUser ? 'text-white' : 'text-dark'} text-xs`}>
              {t('dashboard.myData')}
            </Text>
          </TouchableOpacity>
          {links.map((link) => (
            <TouchableOpacity
              key={link.id}
              className={`px-3 py-2 rounded-full mr-2 ${
                monitoredUser?.id === link.patient?.id ? 'bg-primary' : 'bg-lightGray'
              }`}
              onPress={() => handleSelect(link)}
              disabled={!link.patient}
            >
              <Text className={`${monitoredUser?.id === link.patient?.id ? 'text-white' : 'text-dark'} text-xs`}>
                {link.patient?.name || t('common.unknown')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View className="mt-8 items-center">
          <ActivityIndicator color="#2196F3" />
        </View>
      ) : (
        <>
          <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.vitals')}</Text>
            {vitals ? (
              <View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-xs text-gray">{t('vitals.heartRate')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {heartRate ?? '--'} {t('vitals.bpm')}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-xs text-gray">{t('vitals.oxygen')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {oxygen ?? '--'} {t('vitals.percent')}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-xs text-gray">{t('vitals.bloodPressure')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {bpSys ?? '--'}/{bpDia ?? '--'} {t('vitals.mmHg')}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-xs text-gray">{t('vitals.temperature')}</Text>
                  <Text className="text-sm font-semibold text-dark">
                    {temp ?? '--'} {t('vitals.celsius')}
                  </Text>
                </View>
                {chartData.length > 1 ? (
                  <View className="mt-4">
                    <Text className="text-xs text-gray mb-2">{t('dashboard.heartRateTrend')}</Text>
                    <LineChart
                      data={{
                        labels: chartLabels.slice(-5),
                        datasets: [{ data: chartData.slice(-5) }],
                      }}
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
                        propsForDots: {
                          r: '3',
                          strokeWidth: '1',
                          stroke: '#2196F3',
                        },
                      }}
                      bezier
                      style={{ borderRadius: 12 }}
                    />
                  </View>
                ) : null}
              </View>
            ) : (
              <Text className="text-xs text-gray">{t('vitals.noData')}</Text>
            )}
          </View>

          <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.alerts')}</Text>
            <View className="flex-row justify-between">
              <View className="items-center flex-1 bg-primary rounded-xl py-3 mx-1">
                <Text className="text-white text-lg font-bold">{stats.total}</Text>
                <Text className="text-white/90 text-xs">{t('alerts.totalAlerts')}</Text>
              </View>
              <View className="items-center flex-1 bg-warning rounded-xl py-3 mx-1">
                <Text className="text-white text-lg font-bold">{stats.pending}</Text>
                <Text className="text-white/90 text-xs">{t('alerts.pending')}</Text>
              </View>
              <View className="items-center flex-1 bg-danger rounded-xl py-3 mx-1">
                <Text className="text-white text-lg font-bold">{stats.critical}</Text>
                <Text className="text-white/90 text-xs">{t('alerts.critical')}</Text>
              </View>
            </View>
            <Text className="text-[10px] text-gray mt-3">
              {t('dashboard.lastUpdated')}: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            {alerts.length > 0 ? (
              <View className="mt-4 p-3 rounded-xl bg-lightGray/40">
                <Text className="text-xs text-gray">{t('dashboard.latestAlert')}</Text>
                <Text className="text-sm font-semibold text-dark mt-1">{alerts[0].message}</Text>
                <Text className="text-[10px] text-gray mt-1">
                  {new Date(alerts[0].timestamp).toLocaleString()}
                </Text>
              </View>
            ) : (
              <Text className="text-xs text-gray mt-3">{t('dashboard.noAlerts')}</Text>
            )}
          </View>

          <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
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
          </View>

          <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('dashboard.allMonitored')}</Text>
            {dashboardItems.length === 0 ? (
              <Text className="text-xs text-gray">{t('dashboard.noMonitored')}</Text>
            ) : (
              dashboardItems.map((item) => (
                <View key={item.patient.id} className="border border-lightGray rounded-xl p-3 mb-3">
                  <View className="flex-row justify-between items-center">
                    <View>
                      <Text className="text-sm font-semibold text-dark">{item.patient.name}</Text>
                      {item.relationship ? (
                        <Text className="text-[10px] text-gray mt-1">{item.relationship}</Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      className="px-3 py-1 rounded-full bg-primary/10"
                      onPress={() => handleSelect({ id: 0, caregiver_id: user?.id || 0, patient_id: item.patient.id, is_active: true, created_at: '', patient: item.patient })}
                    >
                      <Text className="text-xs text-primary">{t('dashboard.view')}</Text>
                    </TouchableOpacity>
                  </View>

                  <View className="mt-3 flex-row justify-between">
                    <View>
                      <Text className="text-[10px] text-gray">{t('vitals.heartRate')}</Text>
                      <Text className="text-sm font-semibold text-dark">
                        {item.vitals?.heart_rate ?? '--'} {t('vitals.bpm')}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-[10px] text-gray">{t('vitals.oxygen')}</Text>
                      <Text className="text-sm font-semibold text-dark">
                        {item.vitals?.oxygen_saturation ?? '--'} {t('vitals.percent')}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-[10px] text-gray">{t('dashboard.pending')}</Text>
                      <Text className="text-sm font-semibold text-dark">
                        {item.alerts?.pending ?? 0}
                      </Text>
                    </View>
                  </View>

                  {item.alerts?.last ? (
                    <View className="mt-3 p-2 rounded-lg bg-lightGray/40">
                      <Text className="text-[10px] text-gray">{t('dashboard.latestAlert')}</Text>
                      <Text className="text-xs text-dark mt-1" numberOfLines={2}>
                        {item.alerts.last.message}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-[10px] text-gray mt-2">{t('dashboard.noAlerts')}</Text>
                  )}
                </View>
              ))
            )}
          </View>

          <View className="mx-4 mt-5 mb-10">
            <TouchableOpacity
              className="bg-primary rounded-xl py-3 items-center mb-3"
              onPress={() => navigation.getParent?.()?.navigate?.('Alerts')}
              disabled={!activeUser}
            >
              <Text className="text-white font-semibold">{t('dashboard.openAlerts')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="bg-dark rounded-xl py-3 items-center"
              onPress={() => {
                if (!monitoredUser) return;
                navigation.navigate('Chat', {
                  patientId: monitoredUser.id,
                  patientName: monitoredUser.name,
                });
              }}
              disabled={!monitoredUser}
            >
              <Text className="text-white font-semibold">{t('dashboard.openChat')}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
};
