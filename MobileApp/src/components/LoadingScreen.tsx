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
          <MaterialCommunityIcons 
            name="shield-check" 
            size={80} 
            color="#2196F3" 
          />
        </View>
        
        {/* App Name */}
        <Text style={styles.appName}>Fall Detection</Text>
        <Text style={styles.appTagline}>Smart Safety System</Text>
        
        {/* Loading Indicator */}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>
            {initializing ? 'Initializing...' : 'Loading...'}
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
              color="#666" 
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
              size={24} 
              color="#F44336" 
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        
        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.versionText}>Version 2.0.0</Text>
          <Text style={styles.copyrightText}>© 2024 Fall Detection System</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  iconContainer: {
    marginBottom: 20,
  },
  appName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 5,
  },
  appTagline: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
  },
  loadingContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
  },
  statusContainer: {
    width: '100%',
    maxWidth: 300,
    marginBottom: 20,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 15,
    paddingVertical: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
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
    color: '#333',
    marginLeft: 5,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
    maxWidth: 300,
  },
  errorText: {
    fontSize: 14,
    color: '#D32F2F',
    marginLeft: 10,
    flex: 1,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    alignItems: 'center',
  },
  versionText: {
    fontSize: 12,
    color: '#999',
    marginBottom: 5,
  },
  copyrightText: {
    fontSize: 10,
    color: '#BBB',
  },
});

export default LoadingScreen;