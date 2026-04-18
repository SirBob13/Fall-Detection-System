// src/components/HealthDashboard.tsx
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { VictoryChart, VictoryLine, VictoryArea, VictoryTheme } from 'victory-native';
import Svg from 'react-native-svg';
import { LineChart } from 'react-native-chart-kit';


interface HealthDashboardProps {
  metrics: any;
  onViewDetails: (metric: string) => void;
}

export const HealthDashboard: React.FC<HealthDashboardProps> = ({ metrics, onViewDetails }) => {
  return (
    <View className="card">
      <Text className="section-title mb-4">Health Dashboard</Text>
      
      {/* Heart Rate Section */}
      <TouchableOpacity 
        className="mb-4 p-3 bg-red-50 rounded-xl"
        onPress={() => onViewDetails('heartRate')}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-sm text-gray">Heart Rate</Text>
            <Text className="text-2xl font-bold text-dark">{metrics.heartRate.value} BPM</Text>
            <Text className={`text-xs mt-1 ${
              metrics.heartRate.status === 'normal' ? 'text-success' :
              metrics.heartRate.status === 'critical' ? 'text-danger' :
              'text-warning'
            }`}>
              {metrics.heartRate.status.toUpperCase()}
            </Text>
          </View>
          <View>
            {/* Mini chart or icon */}
          </View>
        </View>
      </TouchableOpacity>

      {/* Blood Pressure Section */}
      <TouchableOpacity 
        className="mb-4 p-3 bg-blue-50 rounded-xl"
        onPress={() => onViewDetails('bloodPressure')}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-sm text-gray">Blood Pressure</Text>
            <Text className="text-2xl font-bold text-dark">
              {metrics.bloodPressure.systolic}/{metrics.bloodPressure.diastolic}
            </Text>
            <Text className="text-xs text-gray mt-1">mmHg</Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
};
