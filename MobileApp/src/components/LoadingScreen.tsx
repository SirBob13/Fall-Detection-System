// src/components/LoadingScreen.tsx
import React from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface LoadingScreenProps {
  initializing?: boolean;
  error?: string | null;
  networkStatus?: 'checking' | 'connected' | 'disconnected';
  currentLanguage?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  initializing = true,
  error = null,
  networkStatus = 'checking',
  currentLanguage = 'ar',
}) => {

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo/Icon */}
        <View style={styles.iconContainer}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons 
              name="shield-check" 
              size={60} 
              color="#2196F3" 
            />
          </View>
        </View>
        
        {/* App Name */}
        <Text style={styles.appName}>Fall Detection</Text>
        <Text style={styles.appTagline}>Smart Safety System</Text>
        
        {/* Loading Indicator */}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>
            {initializing ? 'Initializing System...' : 'Loading Data...'}
          </Text>
        </View>
        
        {/* Status Information */}
        <View style={styles.statusContainer}>
          <View style={styles.statusItem}>
            <View style={[
              styles.statusDot,
              networkStatus === 'connected' ? styles.statusConnected :
              networkStatus === 'disconnected' ? styles.statusDisconnected :
              styles.statusChecking
            ]} />
            <Text style={styles.statusText}>
              {networkStatus === 'connected' ? 'Network Connected' :
               networkStatus === 'disconnected' ? 'Network Disconnected' :
               'Checking Network...'}
            </Text>
          </View>
          
          <View style={styles.statusItem}>
            <MaterialCommunityIcons 
              name="translate" 
              size={16} 
              color="#757575" 
            />
            <Text style={styles.statusText}>
              Language: {currentLanguage === 'ar' ? 'العربية' : 'English'}
            </Text>
          </View>
        </View>
        
        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <MaterialCommunityIcons 
              name="alert-circle" 
              size={20} 
              color="#D32F2F" 
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        
        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.versionText}>Version 2.0.0</Text>
          <Text style={styles.copyrightText}>© 2026 Fall Detection System</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // أبيض صريح
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: {
    marginBottom: 24,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    // ظل خفيف للأيقونة
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: 0.5,
  },
  appTagline: {
    fontSize: 14,
    color: '#757575',
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 48,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  loadingText: {
    fontSize: 15,
    color: '#616161',
    marginTop: 12,
    fontWeight: '500',
  },
  statusContainer: {
    width: '100%',
    maxWidth: 280,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FAFAFA', // رمادي خفيف جداً
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  statusConnected: {
    backgroundColor: '#4CAF50',
  },
  statusDisconnected: {
    backgroundColor: '#F44336',
  },
  statusChecking: {
    backgroundColor: '#FF9800',
  },
  statusText: {
    fontSize: 14,
    color: '#424242',
    fontWeight: '500',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
    width: '100%',
    maxWidth: 300,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorText: {
    fontSize: 14,
    color: '#B71C1C',
    marginLeft: 10,
    flex: 1,
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    alignItems: 'center',
  },
  versionText: {
    fontSize: 12,
    color: '#9E9E9E',
    fontWeight: '600',
    marginBottom: 4,
  },
  copyrightText: {
    fontSize: 10,
    color: '#BDBDBD',
    fontWeight: '400',
  },
});

export default LoadingScreen;