// src/components/FallHistoryChart.tsx
import React from 'react';
import { View, Text, Dimensions } from 'react-native';
import { VictoryChart, VictoryBar, VictoryAxis, VictoryTheme } from 'victory-native';
import Svg from 'react-native-svg';

interface FallHistoryChartProps {
  data: Array<{ day: string; falls: number; risk: number }>;
}

export const FallHistoryChart: React.FC<FallHistoryChartProps> = ({ data }) => {
  const chartWidth = Dimensions.get('window').width - 32;

  return (
    <View className="card">
      <Text className="section-title mb-4">Fall History (7 Days)</Text>
      
      <View style={{ height: 250 }}>
        <VictoryChart
          width={chartWidth}
          height={250}
          theme={VictoryTheme.material}
          domainPadding={20}
        >
          <VictoryAxis
            tickFormat={(t) => t.substring(0, 3)}
            style={{
              tickLabels: { fontSize: 10, padding: 5 }
            }}
          />
          <VictoryAxis
            dependentAxis
            style={{
              tickLabels: { fontSize: 10, padding: 5 }
            }}
          />
          <VictoryBar
            data={data}
            x="day"
            y="falls"
            style={{
              data: {
                fill: ({ datum }) => 
                  datum.falls > 2 ? "#F44336" : 
                  datum.falls > 0 ? "#FF9800" : "#4CAF50",
                width: 20
              }
            }}
          />
        </VictoryChart>
      </View>
    </View>
  );
};