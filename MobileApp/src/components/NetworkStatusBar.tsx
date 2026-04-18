import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { networkService, NetworkStatus } from '../services/network.service';
import { useLanguage } from './LanguageProvider';

export const NetworkStatusBar: React.FC = () => {
  const { t } = useLanguage();
  const [status, setStatus] = useState<NetworkStatus>(
    networkService.getCurrentStatus()
  );
  const [visible, setVisible] = useState(false);
  const [lastConnected, setLastConnected] = useState<Date | null>(null);
  const [slideAnim] = useState(new Animated.Value(-100));

  useEffect(() => {
    const unsubscribe = networkService.addListener((newStatus) => {
      setStatus(newStatus);
      
      if (!newStatus.isConnected) {
        showStatusBar();
      } else {
        if (!visible) {
          setLastConnected(new Date());
        }
        hideStatusBar();
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const showStatusBar = () => {
    setVisible(true);
  };

  const hideStatusBar = () => {
    setVisible(false);
  };

  const handleRetry = async () => {
    const isConnected = await networkService.checkConnectivity();
    if (isConnected) {
      hideStatusBar();
    }
  };

  const getStatusColor = () => {
    if (status.isConnected && status.isInternetReachable) {
      return '#4CAF50'; // Green
    } else if (status.isConnected && !status.isInternetReachable) {
      return '#FF9800'; // Orange
    } else {
      return '#F44336'; // Red
    }
  };

  const getStatusIcon = () => {
    if (status.isConnected && status.isInternetReachable) {
      return 'wifi';
    } else if (status.isConnected && !status.isInternetReachable) {
      return 'wifi-strength-alert-outline';
    } else {
      return 'wifi-off';
    }
  };

  const getStatusText = () => {
    if (status.isConnected && status.isInternetReachable) {
      return t('network.connected');
    } else if (status.isConnected && !status.isInternetReachable) {
      return t('network.noInternet');
    } else {
      return t('network.disconnected');
    }
  };

  const getConnectionDetails = () => {
    if (status.type === 'wifi') {
      return `WiFi • ${status.details?.ssid || 'Unknown'}`;
    } else if (status.type === 'cellular') {
      return `Mobile • ${status.details?.cellularGeneration || 'Unknown'}`;
    } else {
      return status.type.charAt(0).toUpperCase() + status.type.slice(1);
    }
  };

  if (!visible && status.isConnected) return null;

  const themeStyles = {
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
    lastConnected: {
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
    },
    lastConnectedText: {
      color: 'rgba(0, 0, 0, 0.7)',
    },
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: getStatusColor(),
          borderBottomColor: themeStyles.borderBottomColor,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.statusInfo}>
          <MaterialCommunityIcons
            name={getStatusIcon()}
            size={20}
            color="#FFF"
          />
          <View style={styles.textContainer}>
            <Text style={styles.statusText}>{getStatusText()}</Text>
            <Text style={styles.detailsText}>{getConnectionDetails()}</Text>
          </View>
        </View>

        {!status.isConnected && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            activeOpacity={0.7}
          >
            <Text style={styles.retryText}>{t('network.retry')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={hideStatusBar} style={styles.closeButton}>
          <MaterialCommunityIcons name="close" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      {lastConnected && (
        <View style={[styles.lastConnected, themeStyles.lastConnected]}>
          <Text style={[styles.lastConnectedText, themeStyles.lastConnectedText]}>
            {t('network.lastConnected')}:{' '}
            {lastConnected.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.2)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  textContainer: {
    marginLeft: 12,
    flex: 1,
  },
  statusText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  detailsText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  retryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginLeft: 12,
  },
  retryText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '500',
  },
  closeButton: {
    padding: 4,
    marginLeft: 8,
  },
  lastConnected: {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  lastConnectedText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    textAlign: 'center',
  },
});

export default NetworkStatusBar;
