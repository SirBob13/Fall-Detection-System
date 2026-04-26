import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
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
  const isRenderedRef = useRef(visible);

  useEffect(() => {
    if (visible) {
      isRenderedRef.current = true;

      // بدء الأنميشن عند الظهور
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

      // أنميشن الدوران للأيقونة
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      // أنميشن الاختفاء
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
      ]).start(({ finished }) => {
        if (finished) {
          isRenderedRef.current = false;
        }
      });
    }
  }, [fadeAnim, rotateAnim, scaleAnim, visible]);

  const getConfig = () => {
    switch (type) {
      case 'success':
        return { icon: 'check-circle' as const, color: '#4CAF50', bgColor: '#E8F5E9' };
      case 'error':
        return { icon: 'alert-circle' as const, color: '#F44336', bgColor: '#FFEBEE' };
      case 'warning':
        return { icon: 'alert' as const, color: '#FF9800', bgColor: '#FFF3E0' };
      default:
        return { icon: 'loading' as const, color: '#2196F3', bgColor: '#E3F2FD' };
    }
  };

  const config = getConfig();
  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!visible && !isRenderedRef.current) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <Animated.View
        style={[
          styles.container,
          {
            transform: [
              { scale: scaleAnim },
              {
                translateY: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={[styles.iconContainer, { backgroundColor: config.bgColor }]}>
          {type === 'default' ? (
            <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
              <MaterialCommunityIcons name={config.icon} size={48} color={config.color} />
            </Animated.View>
          ) : (
            <MaterialCommunityIcons name={config.icon} size={48} color={config.color} />
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
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)', // تعتيم خفيف للخلفية (Light Mode Friendly)
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  container: {
    backgroundColor: '#FFFFFF', // خلفية بيضاء نقية
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    maxWidth: 300,
    width: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  message: {
    fontSize: 16,
    fontWeight: '700',
    color: '#212121', // نص داكن وواضح
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 24,
  },
  progressContainer: {
    width: '100%',
    marginTop: 10,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#F5F5F5',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: '#757575',
    textAlign: 'center',
    fontWeight: '600',
  },
});

export default LoadingOverlay;
