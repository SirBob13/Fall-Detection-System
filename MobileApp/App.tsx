// App.tsx
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TouchableOpacity,
  Alert,
  I18nManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from './src/components/LanguageProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
import { initI18n, getCurrentLanguage, isArabic } from './src/i18n';
import { notificationService } from './src/services/notifications';
import { authService } from './src/services/auth.service';
import { COLORS } from './src/utils/constants';
import { API_CONFIG } from './src/utils/constants';

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [currentLanguage, setCurrentLanguage] = useState<'ar' | 'en'>('ar');
  const [connectionCheckInProgress, setConnectionCheckInProgress] = useState(false);

  useEffect(() => {
    prepareApp();
    
    // فحص اتصال دوري كل 5 دقائق فقط (بدلاً من كل دقيقة)
    const connectionInterval = setInterval(() => {
      if (!connectionCheckInProgress) {
        checkServerConnection();
      }
    }, 300000); // كل 5 دقائق

    return () => clearInterval(connectionInterval);
  }, [connectionCheckInProgress]);

  const prepareApp = async () => {
    try {
      console.log('🚀 [App] Preparing application...');
      
      // 1. Initialize i18n for translation
      await initI18n();
      
      // Get current language from i18n after initialization
      const lang = getCurrentLanguage();
      setCurrentLanguage(lang as 'ar' | 'en');
      
      // Force RTL/LTR settings based on language
      I18nManager.forceRTL(isArabic());
      I18nManager.allowRTL(true);
      
      // For Android, swap left and right in RTL
      if (Platform.OS === 'android') {
        I18nManager.swapLeftAndRightInRTL(isArabic());
      }
      
      console.log(`🌐 [App] Language: ${lang}, RTL: ${isArabic()}`);
      
      // 2. Load user session if exists (في الخلفية، لا ننتظر)
      authService.loadSession().then(session => {
        if (session) {
          console.log(`📱 [App] Found session for: ${session.user?.email || 'unknown user'}`);
        }
      }).catch(() => {
        // تجاهل الأخطاء في تحميل الجلسة
      });
      
      // 3. Setup notifications (في الخلفية)
      setupNotifications();
      
      // 4. فحص الاتصال مرة واحدة فقط عند البدء
      setTimeout(() => {
        checkServerConnection().catch(() => {
          // تجاهل الأخطاء في الفحص الأولي
        });
      }, 500);
      
    } catch (error) {
      console.error('❌ [App] Preparation error:', error);
      // لا نعرض Alert هنا - نترك التطبيق يعمل في الوضع المحلي
    } finally {
      setTimeout(() => {
        setAppIsReady(true);
        console.log('✅ [App] Ready for use');
      }, 500);
    }
  };

  const setupNotifications = async () => {
    try {
      console.log('🔔 [App] Setting up notifications...');
      const hasPermission = await notificationService.requestPermissions();
      if (!hasPermission) {
        console.warn('⚠️ [App] Notification permissions not granted');
      }
    } catch (error) {
      console.warn('⚠️ [App] Notifications setup warning:', error);
    }
  };

  const checkServerConnection = async () => {
    if (connectionCheckInProgress) {
      console.log('⏳ [App] Connection check already in progress, skipping...');
      return;
    }

    setConnectionCheckInProgress(true);
    
    try {
      console.log('🌐 [App] Starting single connection check...');
      
      const isConnected = await authService.testDatabaseConnection();
      
      if (isConnected) {
        console.log('✅ [App] Database connected');
        setBackendStatus('connected');
      } else {
        console.log('❌ [App] Database disconnected');
        setBackendStatus('disconnected');
        
        // فقط عرض Alert إذا كان التطبيق جاهزاً وهناك مشكلة جديدة
        if (appIsReady && backendStatus !== 'disconnected') {
          Alert.alert(
            'Connection Issue',
            'Cannot connect to server. Some features may not work properly.\n\n' +
            'You can still use the app in offline mode.',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      console.warn('⚠️ [App] Connection check warning:', error);
      setBackendStatus('disconnected');
    } finally {
      setConnectionCheckInProgress(false);
    }
  };

  const handleRetryConnection = async () => {
    Alert.alert(
      'Retry Connection',
      'Do you want to retry connecting to the server?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retry',
          onPress: async () => {
            await checkServerConnection();
          },
        },
      ]
    );
  };

  const handleLanguageInfo = () => {
    Alert.alert(
      'Language Information',
      `Current Language: ${currentLanguage === 'ar' ? 'Arabic (العربية)' : 'English'}\n\n` +
      `You can change the language from:\n` +
      '1. Login screen (top right)\n' +
      '2. Settings → Language',
      [{ text: 'OK' }]
    );
  };

  // Loading screen
  if (!appIsReady) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.loadingContainer}>
          <View style={styles.loadingContent}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoIcon}>🛡️</Text>
              <Text style={styles.logoText}>Fall Detection</Text>
            </View>
            
            <ActivityIndicator size="large" color={COLORS.primary} />
            
            <Text style={styles.loadingText}>
              {currentLanguage === 'ar' ? 'جاري تحميل التطبيق...' : 'Loading application...'}
            </Text>
            
            <View style={styles.loadingInfo}>
              <Text style={styles.loadingInfoText}>
                Language: {currentLanguage}
              </Text>
              <Text style={styles.loadingInfoText}>
                RTL: {isArabic() ? 'Yes' : 'No'}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // Main app
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <StatusBar
          barStyle={isArabic() ? "light-content" : "dark-content"}
          backgroundColor={COLORS.primary}
        />
        
        {/* Connection status indicator - فقط اظهر عند الفشل */}
        {backendStatus !== 'connected' && (
          <View style={[
            styles.connectionStatus,
            backendStatus === 'disconnected' && styles.connectionStatusDisconnected,
          ]}>
            <View style={styles.connectionContent}>
              <View style={styles.statusInfo}>
                <View style={[
                  styles.statusDot,
                  { backgroundColor: COLORS.danger }
                ]} />
                <Text style={styles.statusText}>
                  ❌ No connection - Using offline mode
                </Text>
              </View>
              
              <View style={styles.statusActions}>
                <TouchableOpacity 
                  onPress={handleRetryConnection} 
                  style={styles.statusButton}
                >
                  <Text style={styles.statusButtonText}>⟳ Retry</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
        
        <AppNavigator />
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  loadingContent: {
    alignItems: 'center',
    padding: 30,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoIcon: {
    fontSize: 60,
    marginBottom: 10,
  },
  logoText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.primary,
    textAlign: 'center',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 16,
    color: COLORS.dark,
    fontWeight: '600',
    marginBottom: 5,
  },
  loadingInfo: {
    marginTop: 30,
    padding: 15,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  loadingInfoText: {
    fontSize: 12,
    color: COLORS.primary,
    marginBottom: 3,
  },
  connectionStatus: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 45 : 10,
    left: 10,
    right: 10,
    zIndex: 1000,
    backgroundColor: COLORS.white,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    padding: 12,
  },
  connectionStatusDisconnected: {
    borderColor: COLORS.danger,
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
  },
  connectionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.dark,
  },
  statusActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  statusButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.dark,
  },
});