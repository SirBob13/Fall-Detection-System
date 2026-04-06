// src/components/AnimatedLoader.tsx
import React from 'react';
import { View, Animated, Easing } from 'react-native';
import LottieView from 'lottie-react-native';

export const AnimatedLoader: React.FC = () => (
  <View className="flex-1 justify-center items-center bg-white dark:bg-darkTheme-surface">
    <LottieView
      source={require('../assets/animations/loading.json')}
      autoPlay
      loop
      style={{ width: 200, height: 200 }}
    />
  </View>
);