import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Dimensions } from 'react-native';
import { useLanguage } from '../components/LanguageProvider';
import { storageService } from '../services/storage';
import { apiService } from '../services/api';
import { CareLink, ReportSummary, User } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';
import { realtimeService } from '../services/realtime.service';

export const ReportsScreen: React.FC = () => {
  const { t } = useLanguage();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeUser, setActiveUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [links, setLinks] = useState<CareLink[]>([]);

  useEffect(() => {
    loadReport();
  }, [period]);

  const periodDays = useMemo(() => {
    switch (period) {
      case 'daily':
        return 1;
      case 'monthly':
        return 30;
      default:
        return 7;
    }
  }, [period]);

  const loadReport = async () => {
    try {
      setLoading(true);
      const user = await storageService.getUser();
      setCurrentUser(user);
      const monitored = await storageService.getMonitoredUser();
      const selected = monitored || user;
      setActiveUser(selected);
      if (!selected) {
        setReport(null);
        return;
      }
      if (user) {
        const linksResponse = await apiService.getCareLinks(user.id);
        if (linksResponse.success && linksResponse.data) {
          setLinks(linksResponse.data);
        } else {
          setLinks([]);
        }
      }
      const response = await apiService.getUserReport(selected.id, periodDays);
      if (response.success && response.data) {
        setReport(response.data);
      } else {
        setReport(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = realtimeService.subscribe('all', (event) => {
      if (!activeUser || !report) return;
      if (event.user_id && event.user_id !== activeUser.id) return;
      if (!event.payload) return;

      if (event.resource === 'alerts' && event.action === 'created') {
        setReport((prev) => {
          if (!prev) return prev;
          const timestamp = event.payload.timestamp ? new Date(event.payload.timestamp) : null;
          const withinRange = timestamp
            ? timestamp.getTime() >= Date.now() - periodDays * 24 * 60 * 60 * 1000
            : false;
          if (!withinRange) return prev;

          const byType = { ...(prev.alerts.by_type || {}) };
          const bySeverity = { ...(prev.alerts.by_severity || {}) };
          const byStatus = { ...(prev.alerts.by_status || {}) };

          const typeKey = event.payload.type || event.payload.alert_type || 'unknown';
          const severityKey = event.payload.severity || 'unknown';
          const statusKey = event.payload.status || 'pending';

          byType[typeKey] = (byType[typeKey] || 0) + 1;
          bySeverity[severityKey] = (bySeverity[severityKey] || 0) + 1;
          byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;

          const dateKey = timestamp ? timestamp.toISOString().slice(0, 10) : '';
          const dailyCounts = [...(prev.alerts.daily_counts || [])];
          const idx = dailyCounts.findIndex((item) => item.date === dateKey);
          if (idx >= 0) {
            dailyCounts[idx] = { ...dailyCounts[idx], count: dailyCounts[idx].count + 1 };
          } else if (dateKey) {
            dailyCounts.push({ date: dateKey, count: 1 });
          }

          return {
            ...prev,
            alerts: {
              ...prev.alerts,
              total: prev.alerts.total + 1,
              by_type: byType,
              by_severity: bySeverity,
              by_status: byStatus,
              daily_counts: dailyCounts,
            },
          };
        });
      }

      if (event.resource === 'vitals' && event.action === 'created') {
        setReport((prev) => {
          if (!prev) return prev;
          const nextTotal = prev.vitals.total + 1;
          const currentAbnormal = Math.round((prev.vitals.abnormal_rate || 0) * prev.vitals.total);
          const isAbnormal = !!event.payload.is_abnormal;
          const nextAbnormal = currentAbnormal + (isAbnormal ? 1 : 0);
          const nextRate = nextTotal > 0 ? nextAbnormal / nextTotal : 0;
          return {
            ...prev,
            vitals: {
              ...prev.vitals,
              total: nextTotal,
              abnormal_rate: nextRate,
            },
          };
        });
      }
    });

    return unsubscribe;
  }, [activeUser, report, periodDays]);

  const handleSelect = async (link: CareLink | null) => {
    if (!link || !link.patient) {
      await storageService.saveMonitoredUser(null);
      setActiveUser(currentUser);
      return;
    }
    await storageService.saveMonitoredUser(link.patient);
    setActiveUser(link.patient);
    await loadReport();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReport();
    setRefreshing(false);
  };

  const chartWidth = Dimensions.get('window').width - 64;
  const dailyCounts = report?.alerts.daily_counts ?? [];
  const labels = dailyCounts.map((d) => d.date.slice(5));
  const data = dailyCounts.map((d) => d.count);

  const abnormalRate = useMemo(() => {
    if (!report) return 0;
    return Math.round((report.vitals.abnormal_rate || 0) * 100);
  }, [report]);

  return (
    <ScrollView
      className="flex-1 bg-light dark:bg-darkTheme-background"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <ScreenHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />

      {links.length > 0 ? (
        <View className="mx-4 mt-4 bg-white dark:bg-darkTheme-surface rounded-2xl shadow-lg border border-lightGray dark:border-darkTheme-border p-4">
          <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text mb-2">{t('reports.viewing')}</Text>
          {activeUser ? (
            <Text className="text-xs text-gray dark:text-darkTheme-muted">{activeUser.name}</Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
            <TouchableOpacity
              className={`px-3 py-2 rounded-full mr-2 ${
                !activeUser || activeUser.id === currentUser?.id ? 'bg-primary' : 'bg-lightGray'
              }`}
              onPress={() => handleSelect(null)}
            >
              <Text className={`${!activeUser || activeUser.id === currentUser?.id ? 'text-white' : 'text-dark dark:text-darkTheme-text'} text-xs`}>
                {t('dashboard.myData')}
              </Text>
            </TouchableOpacity>
            {links.map((link) => (
              <TouchableOpacity
                key={link.id}
                className={`px-3 py-2 rounded-full mr-2 ${activeUser?.id === link.patient?.id ? 'bg-primary' : 'bg-lightGray'}`}
                onPress={() => handleSelect(link)}
                disabled={!link.patient}
              >
                <Text className={`${activeUser?.id === link.patient?.id ? 'text-white' : 'text-dark dark:text-darkTheme-text'} text-xs`}>
                  {link.patient?.name ?? t('dashboard.noUser')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View className="mx-4 mt-4 flex-row">
        {(['daily', 'weekly', 'monthly'] as const).map((value) => (
          <TouchableOpacity
            key={value}
            className={`px-4 py-2 rounded-full mr-2 ${period === value ? 'bg-primary' : 'bg-lightGray'}`}
            onPress={() => setPeriod(value)}
          >
            <Text className={`${period === value ? 'text-white' : 'text-dark dark:text-darkTheme-text'} text-xs`}>
              {t(`reports.${value}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View className="mt-6 items-center">
          <ActivityIndicator color="#2196F3" />
        </View>
      ) : !report ? (
        <View className="mx-4 mt-6">
          <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('reports.noData')}</Text>
        </View>
      ) : (
        <>
          <View className="mx-4 mt-4 bg-white dark:bg-darkTheme-surface rounded-2xl shadow-lg border border-lightGray dark:border-darkTheme-border p-4">
            <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text mb-3">{t('reports.summary')}</Text>
            <View className="flex-row justify-between">
              <View className="items-center flex-1 bg-primary rounded-xl py-3 mx-1">
                <Text className="text-white text-lg font-bold">{report.alerts.total}</Text>
                <Text className="text-white/90 text-xs">{t('alerts.totalAlerts')}</Text>
              </View>
              <View className="items-center flex-1 bg-warning rounded-xl py-3 mx-1">
                <Text className="text-white text-lg font-bold">{report.alerts.by_status?.pending ?? 0}</Text>
                <Text className="text-white/90 text-xs">{t('alerts.pending')}</Text>
              </View>
              <View className="items-center flex-1 bg-danger rounded-xl py-3 mx-1">
                <Text className="text-white text-lg font-bold">{report.alerts.by_severity?.critical ?? 0}</Text>
                <Text className="text-white/90 text-xs">{t('alerts.critical')}</Text>
              </View>
            </View>
          </View>

          <View className="mx-4 mt-4 bg-white dark:bg-darkTheme-surface rounded-2xl shadow-lg border border-lightGray dark:border-darkTheme-border p-4">
            <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text mb-3">{t('reports.trend')}</Text>
            {data.length > 1 ? (
              <LineChart
                data={{
                  labels: labels.slice(-7),
                  datasets: [{ data: data.slice(-7) }],
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
            ) : (
              <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('reports.noTrend')}</Text>
            )}
          </View>

          <View className="mx-4 mt-4 bg-white dark:bg-darkTheme-surface rounded-2xl shadow-lg border border-lightGray dark:border-darkTheme-border p-4">
            <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text mb-3">{t('reports.vitals')}</Text>
            <View className="flex-row justify-between mb-2">
              <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('vitals.heartRate')}</Text>
              <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text">
                {report.vitals.avg_heart_rate ?? '--'} {t('vitals.bpm')}
              </Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('vitals.oxygen')}</Text>
              <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text">
                {report.vitals.avg_oxygen ?? '--'} {t('vitals.percent')}
              </Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('vitals.temperature')}</Text>
              <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text">
                {report.vitals.avg_temperature ?? '--'} {t('vitals.celsius')}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-xs text-gray dark:text-darkTheme-muted">{t('reports.abnormalRate')}</Text>
              <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text">{abnormalRate}%</Text>
            </View>
          </View>

          <View className="mx-4 mt-4 mb-10 bg-white dark:bg-darkTheme-surface rounded-2xl shadow-lg border border-lightGray dark:border-darkTheme-border p-4">
            <Text className="text-sm font-semibold text-dark dark:text-darkTheme-text mb-3">{t('reports.recommendations')}</Text>
            {report.recommendations.map((rec, idx) => (
              <Text key={`${rec}-${idx}`} className="text-xs text-gray dark:text-darkTheme-muted mb-2">
                • {rec}
              </Text>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
};
