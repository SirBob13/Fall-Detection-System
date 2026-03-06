import React from 'react';
import { View, Text } from 'react-native';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ title, subtitle }) => {
  return (
    <View className="mx-4 mt-4 mb-6 rounded-3xl overflow-hidden bg-primary/10 border border-primary/20">
      <View className="absolute -right-8 -top-8 w-24 h-24 rounded-full bg-primary/20" />
      <View className="absolute -left-10 -bottom-10 w-32 h-32 rounded-full bg-primary/10" />
      <View className="p-5">
        <Text className="text-2xl font-bold text-dark">{title}</Text>
        {subtitle ? (
          <Text className="text-xs text-gray mt-1">{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
};
