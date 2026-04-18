// src/components/AnimatedLoader.tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';

export const AnimatedLoader: React.FC = () => {
  return (
    <View className="flex-1 justify-center items-center bg-white">
      <LottieView
        source={require('../assets/animations/loading.json')}
        autoPlay
        loop
        style={styles.animation}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  animation: {
    width: 200,
    height: 200,
  },
});