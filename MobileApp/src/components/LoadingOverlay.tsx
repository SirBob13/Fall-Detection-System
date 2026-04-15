import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from './LanguageProvider';

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  type?: 'default' | 'success' | 'error' | 'warning';
  showProgress?: boolean;
  progress?: number;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  visible,
  message,
  type = 'default',
  showProgress = false,
  progress = 0,
}) => {
  const { t } = useLanguage();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (visible) {
      // Start animations
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();

      // Rotate animation
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const getConfig = (): {
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    color: string;
    bgColor: string;
  } => {
    switch (type) {
      case 'success':
        return {
          icon: 'check-circle',
          color: '#4CAF50',
          bgColor: 'rgba(76, 175, 80, 0.1)',
        };
      case 'error':
        return {
          icon: 'alert-circle',
          color: '#F44336',
          bgColor: 'rgba(244, 67, 54, 0.1)',
        };
      case 'warning':
        return {
          icon: 'alert',
          color: '#FF9800',
          bgColor: 'rgba(255, 152, 0, 0.1)',
        };
      default:
        return {
          icon: 'loading',
          color: '#2196F3',
          bgColor: 'rgba(33, 150, 243, 0.1)',
        };
    }
  };

  const config = getConfig();

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <Animated.View
        style={[
          styles.container,
          {
            opacity: fadeAnim,
            transform: [
              { scale: scaleAnim },
              { translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              })},
            ],
          },
        ]}
      >
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: config.bgColor },
          ]}
        >
          {type === 'default' ? (
            <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
              <MaterialCommunityIcons
                name={config.icon}
                size={48}
                color={config.color}
              />
            </Animated.View>
          ) : (
            <MaterialCommunityIcons
              name={config.icon}
              size={48}
              color={config.color}
            />
          )}
        </View>

        <Text style={styles.message}>
          {message || t('common.loading')}
        </Text>

        {showProgress && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, Math.max(0, progress))}%`,
                    backgroundColor: config.color,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {Math.round(progress)}%
            </Text>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  container: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    maxWidth: 300,
    width: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  message: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 24,
  },
  progressContainer: {
    width: '100%',
    marginTop: 16,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: '#757575',
    textAlign: 'center',
    fontWeight: '500',
  },
});

export default LoadingOverlay;
