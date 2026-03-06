import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Dimensions } from 'react-native';
import { useLanguage } from '../components/LanguageProvider';
import { storageService } from '../services/storage';
import { apiService } from '../services/api';
import { ReportSummary, User } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';

export const ReportsScreen: React.FC = () => {
  const { t } = useLanguage();
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeUser, setActiveUser] = useState<User | null>(null);

  useEffect(() => {
    loadReport();
  }, [days]);

  const loadReport = async () => {
    try {
      setLoading(true);
      const user = await storageService.getUser();
      const monitored = await storageService.getMonitoredUser();
      const selected = monitored || user;
      setActiveUser(selected);
      if (!selected) {
        setReport(null);
        return;
      }
      const response = await apiService.getUserReport(selected.id, days);
      if (response.success && response.data) {
        setReport(response.data);
      } else {
        setReport(null);
      }
    } finally {
      setLoading(false);
    }
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
      className="flex-1 bg-light"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <ScreenHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />

      <View className="mx-4 mt-4 flex-row">
        {[7, 30].map((value) => (
          <TouchableOpacity
            key={value}
            className={`px-4 py-2 rounded-full mr-2 ${days === value ? 'bg-primary' : 'bg-lightGray'}`}
            onPress={() => setDays(value)}
          >
            <Text className={`${days === value ? 'text-white' : 'text-dark'} text-xs`}>
              {value} {t('reports.days')}
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
          <Text className="text-xs text-gray">{t('reports.noData')}</Text>
        </View>
      ) : (
        <>
          <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('reports.summary')}</Text>
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

          <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('reports.trend')}</Text>
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
              <Text className="text-xs text-gray">{t('reports.noTrend')}</Text>
            )}
          </View>

          <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('reports.vitals')}</Text>
            <View className="flex-row justify-between mb-2">
              <Text className="text-xs text-gray">{t('vitals.heartRate')}</Text>
              <Text className="text-sm font-semibold text-dark">
                {report.vitals.avg_heart_rate ?? '--'} {t('vitals.bpm')}
              </Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-xs text-gray">{t('vitals.oxygen')}</Text>
              <Text className="text-sm font-semibold text-dark">
                {report.vitals.avg_oxygen ?? '--'} {t('vitals.percent')}
              </Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-xs text-gray">{t('vitals.temperature')}</Text>
              <Text className="text-sm font-semibold text-dark">
                {report.vitals.avg_temperature ?? '--'} {t('vitals.celsius')}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-xs text-gray">{t('reports.abnormalRate')}</Text>
              <Text className="text-sm font-semibold text-dark">{abnormalRate}%</Text>
            </View>
          </View>

          <View className="mx-4 mt-4 mb-10 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
            <Text className="text-sm font-semibold text-dark mb-3">{t('reports.recommendations')}</Text>
            {report.recommendations.map((rec, idx) => (
              <Text key={`${rec}-${idx}`} className="text-xs text-gray mb-2">
                • {rec}
              </Text>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
};
