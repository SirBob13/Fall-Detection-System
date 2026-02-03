import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Alert as RNAlert,
  SafeAreaView,
} from 'react-native';
import { AlertCard } from '../components/AlertCard';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { Alert as AlertType } from '../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const AlertsScreen: React.FC = () => {
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  const [isLoading, setIsLoading] = useState(true);
  
  // Get safe area insets
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadAlerts();
  }, [filter]);

  const loadAlerts = async () => {
    try {
      setIsLoading(true);
      const user = await storageService.getUser();
      if (!user) {
        RNAlert.alert('Error', 'Please login first');
        setIsLoading(false);
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
      'Clear All Alerts',
      'Are you sure you want to clear all alert history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            // Implement clear logic here
            RNAlert.alert('Success', 'Alert history cleared');
            setAlerts([]);
          },
        },
      ]
    );
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
          <Text className="text-2xl font-bold text-dark">Alert History</Text>
          <Text className="text-sm text-gray mt-1">
            Review all emergency alerts and notifications
          </Text>
        </View>

        {/* Statistics Overview */}
        <View className="mx-4 mb-6">
          <View className="flex-row justify-between mb-3">
            <View className="items-center flex-1 p-4 bg-primary rounded-2xl mx-1 shadow-lg">
              <Text className="text-3xl font-bold text-white">{stats.total}</Text>
              <Text className="text-sm text-white/90 mt-1">Total Alerts</Text>
            </View>
            
            <View className="items-center flex-1 p-4 bg-warning rounded-2xl mx-1 shadow-lg">
              <Text className="text-3xl font-bold text-white">{stats.pending}</Text>
              <Text className="text-sm text-white/90 mt-1">Pending</Text>
            </View>
          </View>
          
          <View className="flex-row justify-between">
            <View className="items-center flex-1 p-4 bg-success rounded-2xl mx-1 shadow-lg">
              <Text className="text-3xl font-bold text-white">{stats.resolved}</Text>
              <Text className="text-sm text-white/90 mt-1">Resolved</Text>
            </View>
            
            <View className="items-center flex-1 p-4 bg-danger rounded-2xl mx-1 shadow-lg">
              <Text className="text-3xl font-bold text-white">{stats.critical}</Text>
              <Text className="text-sm text-white/90 mt-1">Critical</Text>
            </View>
          </View>
          
          {/* Last Updated */}
          <View className="mt-4 items-center">
            <Text className="text-xs text-gray">
              Last updated: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>

        {/* Filter Section */}
        <View className="card mx-4 mb-6">
          <Text className="section-title">Filter Alerts</Text>
          
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
                  {filterType === 'all' && 'All'}
                  {filterType === 'pending' && 'Pending'}
                  {filterType === 'resolved' && 'Resolved'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          
          {/* Filter Summary */}
          <View className="flex-row items-center justify-between p-3 bg-blue-50 rounded-lg">
            <Text className="text-sm font-medium text-dark">
              Showing: <Text className="text-primary">{alerts.length}</Text> alerts
            </Text>
            {alerts.length > 0 && (
              <TouchableOpacity
                onPress={handleClearAllAlerts}
                className="px-3 py-1.5 bg-red-50 rounded-lg"
                activeOpacity={0.7}
              >
                <Text className="text-sm font-medium text-danger">Clear All</Text>
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
            <Text className="text-base text-gray">Loading alerts...</Text>
          </View>
        ) : alerts.length > 0 ? (
          <View className="mx-2 mb-8">
            {alerts.map((alert, index) => (
              <View key={alert.id} className={`mb-3 ${index > 0 ? 'mt-3' : ''}`}>
                <AlertCard
                  alert={alert}
                  onAcknowledge={() => {
                    // Handle acknowledge
                    RNAlert.alert('Success', 'Alert acknowledged');
                  }}
                  onResolve={() => {
                    // Handle resolve
                    RNAlert.alert('Success', 'Alert resolved');
                  }}
                />
              </View>
            ))}
            
            {/* View More Button */}
            {alerts.length >= 50 && (
              <View className="items-center mt-6 mb-4">
                <TouchableOpacity className="px-6 py-3 bg-primary/10 rounded-full">
                  <Text className="text-primary font-semibold">Load More Alerts</Text>
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
              {filter === 'all' && 'No alerts recorded yet'}
              {filter === 'pending' && 'No pending alerts'}
              {filter === 'resolved' && 'No resolved alerts'}
            </Text>
            <Text className="text-sm text-lightGray text-center max-w-xs">
              {filter === 'all' 
                ? 'All clear! No emergency alerts have been detected.'
                : filter === 'pending'
                ? 'Great! You have no pending alerts that need attention.'
                : 'You have no resolved alerts in history.'
              }
            </Text>
            
            {/* Action Button */}
            <TouchableOpacity
              className="mt-8 px-6 py-3 bg-primary rounded-full"
              onPress={loadAlerts}
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold">Refresh Alerts</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tips Section */}
        {alerts.length > 0 && (
          <View className="mx-4 mb-8 p-4 bg-blue-50 rounded-2xl border border-blue-200">
            <View className="flex-row items-center mb-3">
              <Text className="text-lg font-semibold text-dark">⚠️ Important Notes</Text>
            </View>
            <Text className="text-sm text-gray mb-2">
              • Critical alerts require immediate attention
            </Text>
            <Text className="text-sm text-gray mb-2">
              • Resolved alerts are kept for 30 days
            </Text>
            <Text className="text-sm text-gray">
              • Contact emergency services if alert persists
            </Text>
          </View>
        )}

        {/* Bottom Spacing */}
        <View className="h-32" />
      </ScrollView>
    </SafeAreaView>
  );
};

// We need to import TouchableOpacity
import { TouchableOpacity } from 'react-native';