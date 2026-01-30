import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert as RNAlert,
  SafeAreaView,
} from 'react-native';
import { COLORS } from '../utils/constants';
import { AlertCard } from '../components/AlertCard';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { Alert as AlertType } from '../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const AlertsScreen: React.FC = () => {
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  
  // Get safe area insets
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadAlerts();
  }, [filter]);

  const loadAlerts = async () => {
    try {
      const user = await storageService.getUser();
      if (!user) {
        RNAlert.alert('Error', 'Please login first');
        return;
      }

      const response = await apiService.getUserAlerts(user.id, 50);
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
        RNAlert.alert('Error', response.message || 'Failed to load alerts');
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
      RNAlert.alert('Error', 'An error occurred while loading alerts');
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

  const stats = getAlertStats();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingTop: insets.top } // Add top spacing
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Additional top spacing */}
        <View style={styles.topSpacing} />

        {/* Statistics Overview */}
        <View style={styles.statsContainer}>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: COLORS.primary }]}>
              <Text style={styles.statNumber}>{stats.total}</Text>
              <Text style={styles.statLabel}>Total Alerts</Text>
            </View>
            
            <View style={[styles.statCard, { backgroundColor: COLORS.warning }]}>
              <Text style={styles.statNumber}>{stats.pending}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
          </View>
          
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: COLORS.success }]}>
              <Text style={styles.statNumber}>{stats.resolved}</Text>
              <Text style={styles.statLabel}>Resolved</Text>
            </View>
            
            <View style={[styles.statCard, { backgroundColor: COLORS.danger }]}>
              <Text style={styles.statNumber}>{stats.critical}</Text>
              <Text style={styles.statLabel}>Critical</Text>
            </View>
          </View>
        </View>

        {/* Spacing before filters */}
        <View style={styles.spacingMedium} />

        {/* Filter buttons */}
        <View style={styles.filterContainer}>
          <Text style={styles.filterTitle}>Filter</Text>
          <View style={styles.filterButtons}>
            {(['all', 'pending', 'resolved'] as const).map((filterType) => (
              <Text
                key={filterType}
                style={[
                  styles.filterButton,
                  filter === filterType && styles.filterButtonActive,
                ]}
                onPress={() => setFilter(filterType)}
              >
                {filterType === 'all' && 'All'}
                {filterType === 'pending' && 'Pending'}
                {filterType === 'resolved' && 'Resolved'}
              </Text>
            ))}
          </View>
        </View>

        {/* Spacing before alerts */}
        <View style={styles.spacingLarge} />

        {/* Alerts list */}
        {alerts.length > 0 ? (
          <View style={styles.alertsList}>
            {alerts.map((alert, index) => (
              <View key={alert.id} style={index > 0 ? styles.alertSpacing : {}}>
                <AlertCard
                  alert={alert}
                  onAcknowledge={() => {}}
                  onResolve={() => {}}
                />
              </View>
            ))}
            
            {/* Bottom spacing to protect content from bottom tab */}
            <View style={styles.bottomSpacing} />
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No alerts</Text>
            <Text style={styles.emptyStateSubtext}>
              {filter === 'all' && 'No alerts recorded yet'}
              {filter === 'pending' && 'No pending alerts'}
              {filter === 'resolved' && 'No resolved alerts'}
            </Text>
            
            {/* Bottom spacing to protect content from bottom tab */}
            <View style={styles.bottomSpacing} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 8,
  },
  topSpacing: {
    height: 15,
  },
  spacingMedium: {
    height: 20,
  },
  spacingLarge: {
    height: 25,
  },
  bottomSpacing: {
    height: 120, // Large bottom spacing to protect content
  },
  statsContainer: {
    padding: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    marginHorizontal: 4,
    padding: 18, // Increased padding
    borderRadius: 16, // Increased borderRadius
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  statNumber: {
    fontSize: 30, // Increased font size
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.white,
    textAlign: 'center',
  },
  filterContainer: {
    backgroundColor: COLORS.white,
    padding: 20, // Increased padding
    marginHorizontal: 16,
    borderRadius: 16, // Increased borderRadius
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  filterTitle: {
    fontSize: 18, // Increased font size
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: 16,
    textAlign: 'center',
  },
  filterButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 10, // Add spacing between buttons
  },
  filterButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    backgroundColor: COLORS.lightGray,
    color: COLORS.dark,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  filterButtonActive: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
  },
  alertsList: {
    marginTop: 10,
  },
  alertSpacing: {
    marginTop: 12, // Increased spacing between alerts
  },
  emptyState: {
    alignItems: 'center',
    padding: 60, // Increased padding
    marginTop: 40,
  },
  emptyStateText: {
    fontSize: 22, // Increased font size
    color: COLORS.gray,
    marginBottom: 12,
    fontWeight: '600',
  },
  emptyStateSubtext: {
    fontSize: 16,
    color: COLORS.lightGray,
    textAlign: 'center',
    lineHeight: 24,
  },
});