import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Dimensions, StyleSheet } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
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
      case 'daily': return 1;
      case 'monthly': return 30;
      default: return 7;
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

  const handleSelect = async (link: CareLink | null) => {
    const targetUser = link?.patient || null;
    await storageService.saveMonitoredUser(targetUser);
    setActiveUser(targetUser || currentUser);
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

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" />}
    >
      <ScreenHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />

      {/* User Selector */}
      {links.length > 0 && (
        <View style={styles.card} className="mx-4 mt-4">
          <Text className="text-sm font-bold text-gray-800 mb-1">{t('reports.viewing')}</Text>
          <Text className="text-xs text-gray-500 mb-3">{activeUser?.name}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity
              onPress={() => handleSelect(null)}
              className={`px-4 py-2 rounded-xl mr-2 ${(!activeUser || activeUser.id === currentUser?.id) ? 'bg-blue-500' : 'bg-gray-100'}`}
            >
              <Text className={`text-xs font-bold ${(!activeUser || activeUser.id === currentUser?.id) ? 'text-white' : 'text-gray-600'}`}>
                {t('dashboard.myData')}
              </Text>
            </TouchableOpacity>
            {links.map((link) => (
              <TouchableOpacity
                key={link.id}
                onPress={() => handleSelect(link)}
                className={`px-4 py-2 rounded-xl mr-2 ${activeUser?.id === link.patient?.id ? 'bg-blue-500' : 'bg-gray-100'}`}
              >
                <Text className={`text-xs font-bold ${activeUser?.id === link.patient?.id ? 'text-white' : 'text-gray-600'}`}>
                  {link.patient?.name ?? t('dashboard.noUser')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Period Selector */}
      <View className="flex-row mx-4 mt-4">
        {(['daily', 'weekly', 'monthly'] as const).map((v) => (
          <TouchableOpacity
            key={v}
            onPress={() => setPeriod(v)}
            className={`px-5 py-2 rounded-full mr-2 ${period === v ? 'bg-blue-600' : 'bg-white border border-gray-200'}`}
          >
            <Text className={`text-xs font-bold ${period === v ? 'text-white' : 'text-gray-500'}`}>
              {t(`reports.${v}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View className="mt-10 items-center">
          <ActivityIndicator size="large" color="#2196F3" />
        </View>
      ) : !report ? (
        <View className="mt-10 items-center">
          <Text className="text-gray-400">{t('reports.noData')}</Text>
        </View>
      ) : (
        <>
          {/* Summary Box */}
          <View style={styles.card} className="mx-4 mt-5">
            <Text className="text-sm font-bold text-gray-800 mb-4">{t('reports.summary')}</Text>
            <View className="flex-row justify-between">
              <SummaryItem value={report.alerts.total} label={t('alerts.totalAlerts')} color="#3B82F6" />
              <SummaryItem value={report.alerts.by_status?.pending ?? 0} label={t('alerts.pending')} color="#F59E0B" />
              <SummaryItem value={report.alerts.by_severity?.critical ?? 0} label={t('alerts.critical')} color="#EF4444" />
            </View>
          </View>

          {/* Chart Section */}
          <View style={styles.card} className="mx-4 mt-4">
            <Text className="text-sm font-bold text-gray-800 mb-4">{t('reports.trend')}</Text>
            {data.length > 1 ? (
              <LineChart
                data={{ labels: labels.slice(-7), datasets: [{ data: data.slice(-7) }] }}
                width={chartWidth}
                height={180}
                chartConfig={chartConfig}
                bezier
                style={{ borderRadius: 16, marginTop: 8 }}
                withInnerLines={false}
                withVerticalLines={false}
              />
            ) : (
              <Text className="text-center text-gray-400 py-10">{t('reports.insufficientData')}</Text>
            )}
          </View>

          {/* Vitals Stats */}
          <View style={styles.card} className="mx-4 mt-4">
            <Text className="text-sm font-bold text-gray-800 mb-4">{t('reports.vitals')}</Text>
            <VitalRow label={t('vitals.heartRate')} value={`${report.vitals.avg_heart_rate ?? '--'} BPM`} />
            <VitalRow label={t('vitals.oxygen')} value={`${report.vitals.avg_oxygen ?? '--'} %`} />
            <VitalRow label={t('vitals.temperature')} value={`${report.vitals.avg_temperature ?? '--'} °C`} />
            <VitalRow label={t('vitals.abnormalStatus')} value={`${Math.round((report.vitals.abnormal_rate || 0) * 100)} %`} isLast />
          </View>

          {/* Recommendations */}
          <View style={[styles.card, { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD' }]} className="mx-4 mt-4 mb-12">
            <Text className="text-sm font-bold text-blue-900 mb-3">{t('reports.recommendations')}</Text>
            {report.recommendations.map((rec, idx) => (
              <View key={idx} className="flex-row mb-2">
                <Text className="text-blue-500 mr-2">•</Text>
                <Text className="text-xs text-blue-800 leading-5 flex-1">{rec}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
};

// --- المكونات المساعدة للثيم الفاتح ---

const SummaryItem = ({ value, label, color }: any) => (
  <View style={{ backgroundColor: color }} className="items-center flex-1 rounded-2xl py-4 mx-1 shadow-sm">
    <Text className="text-white text-xl font-black">{value}</Text>
    <Text className="text-white/80 text-[10px] font-bold uppercase tracking-tighter">{label}</Text>
  </View>
);

const VitalRow = ({ label, value, isLast }: any) => (
  <View className={`flex-row justify-between items-center py-3 ${!isLast ? 'border-b border-gray-50' : ''}`}>
    <Text className="text-xs font-medium text-gray-500">{label}</Text>
    <Text className="text-sm font-bold text-gray-900">{value}</Text>
  </View>
);

const chartConfig = {
  backgroundGradientFrom: '#ffffff',
  backgroundGradientTo: '#ffffff',
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(33, 150, 243, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(158, 158, 158, ${opacity})`,
  style: { borderRadius: 16 },
  propsForDots: { r: '4', strokeWidth: '2', stroke: '#2196F3' }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB', // رمادي فاتح جداً للخلفية
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  }
});