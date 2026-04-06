// App.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from './src/store/store';
import {
  ActivityIndicator,
  View,
  Text,
  StatusBar,
  Platform,
  I18nManager,
  LogBox,
  AppState,
  BackHandler,
  Alert,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { LanguageProvider } from './src/components/LanguageProvider';
import { SettingsProvider } from './src/components/SettingsProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
import { initI18n, getCurrentLanguage, isArabic } from './src/i18n';
import { notificationService } from './src/services/notifications';
import { authService } from './src/services/auth.service';
import { networkService } from './src/services/network.service';
import { analyticsService } from './src/services/analytics.service';
import { emergencyService } from './src/services/emergency.service';
import { offlineQueueService } from './src/services/offlineQueue.service';
import { NetworkStatusBar } from './src/components/NetworkStatusBar';
import { OfflineIndicator } from './src/components/OfflineIndicator';
import { SessionTimeout } from './src/components/SessionTimeout';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { LoadingScreen } from './src/components/LoadingScreen';
import { API_CONFIG } from './src/config/app.config';

// الخطوط المخصصة للتطبيق
const customFonts = {
  // يمكنك إضافة خطوطك هنا
  // 'Roboto-Bold': require('./assets/fonts/Roboto-Bold.ttf'),
  // 'Roboto-Regular': require('./assets/fonts/Roboto-Regular.ttf'),
};

// تجاهل تحذيرات معينة
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  'AsyncStorage has been extracted from react-native core',
  'EventEmitter.removeListener',
  'new NativeEventEmitter',
  'SplashScreen.show is deprecated',
  'Cannot connect to the Metro server',
]);

// منع إخفاء شاشة البداية تلقائياً
SplashScreen.preventAutoHideAsync();

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [networkStatus, setNetworkStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [appState, setAppState] = useState(AppState.currentState);
  const appStateRef = useRef(AppState.currentState);
  const lastBackPress = useRef<number>(0);
  const isInitializedRef = useRef(false);

  // تحميل الخطوط
  const loadFonts = useCallback(async () => {
    try {
      console.log('🔤 [App] Loading custom fonts...');
      
      // إذا كان لديك خطوط مخصصة
      if (Object.keys(customFonts).length > 0) {
        await Font.loadAsync(customFonts);
      }
      
      // تحميل خطوط النظام (اختياري)
      await Font.loadAsync({
        // يمكنك تحميل خطوط أيقونات إذا كنت بحاجة إليها
        // 'MaterialIcons': require('@expo/vector-icons/fonts/MaterialIcons.ttf'),
      });
      
      setFontsLoaded(true);
      console.log('✅ [App] Fonts loaded successfully');
    } catch (error) {
      console.warn('⚠️ [App] Error loading fonts:', error);
      setFontsLoaded(true); // نستمر حتى لو فشل تحميل الخطوط
    }
  }, []);

  // التعامل مع تغييرات حالة التطبيق
  const handleAppStateChange = useCallback((nextAppState: any) => {
    console.log(`📱 [App] State changed: ${appStateRef.current} -> ${nextAppState}`);
    
    if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
      // التطبيق عاد للمقدمة
      console.log('📱 [App] App returned to foreground');
      analyticsService.track('app_foreground');
      
      // تحديث نشاط المستخدم
      authService.updateLastActivity();
      
      // تحديث حالة الشبكة
      networkService.checkConnectivity().then(status => {
        setNetworkStatus(status.isConnected ? 'connected' : 'disconnected');
      });
    } else if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
      // التطبيق يذهب للخلفية
      console.log('📱 [App] App going to background');
      analyticsService.track('app_background');
    }
    
    appStateRef.current = nextAppState;
    setAppState(nextAppState);
  }, []);

  // التعامل مع زر الرجوع (أندرويد)
  const handleBackPress = useCallback(() => {
    const now = Date.now();
    
    if (now - lastBackPress.current < 2000) {
      // الضغط مرتين للخروج
      analyticsService.track('app_exit_double_tap');
      BackHandler.exitApp();
      return true;
    }
    
    lastBackPress.current = now;
    
    Alert.alert(
      'Exit App',
      'Are you sure you want to exit?',
      [
        { 
          text: 'Cancel', 
          style: 'cancel', 
          onPress: () => {
            analyticsService.track('app_exit_cancelled');
          } 
        },
        { 
          text: 'Exit', 
          style: 'destructive', 
          onPress: () => {
            analyticsService.track('app_exit_confirmed');
            BackHandler.exitApp();
          } 
        },
      ]
    );
    
    return true;
  }, []);

  // تهيئة التطبيق
  const initializeApp = useCallback(async () => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    try {
      console.log('🚀 [App] Starting application initialization...');

      // 1. تهيئة الخطوط أولاً
      await loadFonts();

      // 2. تهيئة الترجمة
      console.log('🌐 [App] Initializing i18n...');
      await initI18n();
      const lang = getCurrentLanguage();
      
      // تكوين RTL/LTR بناءً على اللغة
      const isRTL = isArabic();
      I18nManager.forceRTL(isRTL);
      I18nManager.allowRTL(true);
      
      if (Platform.OS === 'android') {
        I18nManager.swapLeftAndRightInRTL(isRTL);
      }

      console.log(`🌐 [App] Language set to: ${lang}, RTL: ${isRTL}`);

      // 3. تهيئة خدمة الشبكة
      console.log('📡 [App] Initializing network service...');
      const networkStatus = await networkService.initialize();
      setNetworkStatus(
        networkStatus.isConnected && networkStatus.isInternetReachable
          ? 'connected'
          : 'disconnected'
      );

      // 4. تهيئة التحليلات
      console.log('📊 [App] Initializing analytics...');
      await analyticsService.initialize();

      // 4.1 تهيئة طابور الإرسال بدون إنترنت
      await offlineQueueService.initialize();

      // 5. التحقق من جلسة المستخدم وتحميلها (عملية في الخلفية)
      console.log('🔐 [App] Checking user session...');
      authService.loadSession().then(async (session) => {
        if (session?.user?.id) {
          analyticsService.setUserId(session.user.id);
          analyticsService.setUserProperties({
            email: session.user.email,
            language: lang,
          });
          
          // بدء مراقبة الجلسة
          authService.startSessionMonitor();
          
          console.log(`✅ [App] User session loaded: ${session.user.email}`);
        }
      }).catch((error) => {
        console.warn('⚠️ [App] Session loading warning:', error);
      });

      // 6. إعداد الإشعارات
      console.log('🔔 [App] Setting up notifications...');
      const notificationPermission = await notificationService.requestPermissions();
      analyticsService.track('notification_permission_requested', { 
        granted: notificationPermission,
        platform: Platform.OS,
      });

      // 7. تهيئة خدمة الطوارئ
      console.log('🚨 [App] Initializing emergency service...');
      await emergencyService.getEmergencySettings();
      await emergencyService.getEmergencyContacts();

      // 8. تتبع تهيئة التطبيق
      analyticsService.track('app_initialized', {
        platform: Platform.OS,
        version: API_CONFIG.version,
        buildNumber: API_CONFIG.buildNumber,
        language: lang,
        rtl: isRTL,
        networkStatus: networkStatus,
      });

      console.log('✅ [App] Initialization completed successfully');

    } catch (error) {
      console.error('❌ [App] Initialization error:', error);
      setInitializationError(error instanceof Error ? error.message : 'Unknown initialization error');
      analyticsService.track('app_initialization_error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    } finally {
      setInitializing(false);
    }
  }, [loadFonts]);

  // التعامل مع انتهاء الجلسة
  const handleSessionTimeout = useCallback(async () => {
    console.log('⏰ [App] Session timeout triggered');
    analyticsService.track('session_timeout');
    
    const session = await authService.loadSession();
    if (session) {
      Alert.alert(
        'Session Expired',
        'Your session has expired due to inactivity. Please login again.',
        [
          { 
            text: 'OK', 
            onPress: async () => {
              await authService.logout();
              analyticsService.track('session_logout_timeout');
            }
          }
        ]
      );
    }
  }, []);

  // التعامل مع تغييرات حالة الشبكة
  const handleNetworkStatusChange = useCallback((status: any) => {
    setNetworkStatus(
      status.isConnected && status.isInternetReachable
        ? 'connected'
        : 'disconnected'
    );
  }, []);

  // إعداد مستمعي دورة حياة التطبيق
  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    
    // مستمع حالة الشبكة
    const unsubscribeNetwork = networkService.addListener(handleNetworkStatusChange);
    
    // فحص صحة دوري (كل 10 دقائق)
    const healthCheckInterval = setInterval(() => {
      if (appStateRef.current === 'active') {
        networkService.checkConnectivity();
      }
    }, 600000);

    return () => {
      clearInterval(healthCheckInterval);
      appStateSubscription.remove();
      backHandler.remove();
      unsubscribeNetwork();
      networkService.stop();
      analyticsService.destroy();
      emergencyService.cleanup();
    };
  }, [handleAppStateChange, handleBackPress, handleNetworkStatusChange]);

  // تهيئة التطبيق عند البدء
  useEffect(() => {
    const prepare = async () => {
      try {
        // انتظار تحميل الخطوط
        await loadFonts();
        
        // تهيئة التطبيق
        await initializeApp();
        
        // تأخير صغير لتجربة مستخدم أفضل
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // إخفاء شاشة البداية
        await SplashScreen.hideAsync();
        
        // تحديث حالة الجاهزية
        setAppIsReady(true);
        console.log('✅ [App] App is ready');
      } catch (error) {
        console.error('❌ [App] Preparation error:', error);
        setInitializationError(error instanceof Error ? error.message : 'Unknown preparation error');
        setAppIsReady(true); // نستمر في عرض التطبيق حتى مع وجود خطأ
      }
    };

    prepare();
  }, [loadFonts, initializeApp]);

  // عرض شاشة التحميل أثناء التهيئة
  if (!appIsReady) {
    return (
      <SafeAreaProvider>
        <View className="flex-1 justify-center items-center bg-gradient-to-b from-blue-50 to-white">
          <LoadingScreen 
            initializing={initializing}
            error={initializationError}
            networkStatus={networkStatus}
            currentLanguage={getCurrentLanguage()}
          />
        </View>
      </SafeAreaProvider>
    );
  }

  // المكون الرئيسي للتطبيق
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Provider store={store}>
          <PersistGate 
            loading={
              <View className="flex-1 justify-center items-center bg-white">
                <ActivityIndicator size="large" color="#2196F3" />
              </View>
            } 
            persistor={persistor}
          >
            <SafeAreaProvider>
              <LanguageProvider>
                <SettingsProvider>
                <StatusBar
                  barStyle={isArabic() ? "light-content" : "dark-content"}
                  backgroundColor="#2196F3"
                  translucent={Platform.OS === 'android'}
                />
                
                {/* شريط حالة الشبكة */}
                <NetworkStatusBar 
                  status={networkStatus}
                  onRetry={() => networkService.checkConnectivity()}
                />
                
                {/* مؤشر عدم الاتصال */}
                {networkStatus === 'disconnected' && (
                  <OfflineIndicator 
                    onRetry={() => networkService.checkConnectivity()}
                  />
                )}
                
                {/* معالج انتهاء الجلسة */}
                <SessionTimeout 
                  timeoutMinutes={30}
                  onTimeout={handleSessionTimeout}
                  warningMinutes={5}
                  onWarning={() => {
                    console.log('⚠️ [App] Session timeout warning');
                    analyticsService.track('session_timeout_warning');
                  }}
                />
                
                {/* التنقل الرئيسي للتطبيق */}
                <View className="flex-1 bg-light" style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
                  <AppNavigator />
                </View>
                
                {/* عرض الأخطاء العام (اختياري) */}
                {initializationError && (
                  <View className="absolute bottom-4 left-4 right-4 bg-danger/90 p-3 rounded-lg shadow-lg">
                    <Text className="text-white text-sm text-center">
                      Warning: {initializationError}
                    </Text>
                  </View>
                )}
                
                {/* مؤشر حالة التطبيق (للتنمية فقط) */}
                {__DEV__ && (
                  <View className="absolute bottom-4 left-4 z-40">
                    <View className="bg-dark/70 px-2 py-1 rounded-full">
                      <Text className="text-white text-xs font-mono">
                        {appState.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                )}
                </SettingsProvider>
              </LanguageProvider>
            </SafeAreaProvider>
          </PersistGate>
        </Provider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
