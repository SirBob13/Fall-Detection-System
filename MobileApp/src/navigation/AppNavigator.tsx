// src/navigation/AppNavigator.tsx
import React, { useEffect, useState, useRef } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, View, Text, AppState, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { AUTH_CONFIG } from '../constants/auth';
import { authService } from '../services/auth.service';
import { useLanguage } from '../components/LanguageProvider';
import { analyticsService } from '../services/analytics.service';

// Import authentication screens
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';

// Import main screens
import { HomeScreen } from '../screens/HomeScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { EmergencyContactsScreen } from '../screens/EmergencyContactsScreen';
import { EmergencySettingsScreen } from '../screens/EmergencySettingsScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';

// Define navigation types
type RootStackParamList = {
  Auth: undefined;
  MainTabs: undefined;
};

type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token: string };
};

type MainTabParamList = {
  Home: undefined;
  Alerts: undefined;
  Emergency: undefined;
  Settings: undefined;
};

type SettingsStackParamList = {
  SettingsMain: undefined;
  EmergencyContacts: undefined;
  EmergencySettings: undefined;
  LanguageSettings: undefined;
};

type EmergencyStackParamList = {
  EmergencyContacts: undefined;
  EmergencySettings: undefined;
  LanguageSettings: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();
const EmergencyStack = createNativeStackNavigator<EmergencyStackParamList>();

// Custom navigation theme
const MyTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: AUTH_CONFIG.COLORS.primary,
    background: '#FFF',
    card: '#FFF',
    text: '#333',
    border: '#E0E0E0',
  },
};

// Loading component
const LoadingScreen = () => (
  <View style={{ 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#FFF'
  }}>
    <ActivityIndicator size="large" color={AUTH_CONFIG.COLORS.primary} />
    <Text style={{ marginTop: 16, color: '#666' }}>Loading...</Text>
  </View>
);

// Authentication screens
const AuthNavigator = () => (
  <AuthStack.Navigator
    initialRouteName="Login"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: '#FFF' },
      animation: 'slide_from_right',
    }}
  >
    <AuthStack.Screen 
      name="Login" 
      component={LoginScreen}
      options={{ 
        gestureEnabled: true,
        animation: 'slide_from_right',
      }}
    />
    <AuthStack.Screen 
      name="Register" 
      component={RegisterScreen}
      options={{ 
        gestureEnabled: true,
        animation: 'slide_from_right',
      }}
    />
    <AuthStack.Screen 
      name="ForgotPassword" 
      component={ForgotPasswordScreen}
      options={{ 
        gestureEnabled: true,
        animation: 'slide_from_right',
      }}
    />
    <AuthStack.Screen 
      name="ResetPassword" 
      component={ResetPasswordScreen}
      options={{ 
        gestureEnabled: true,
        animation: 'slide_from_right',
      }}
    />
  </AuthStack.Navigator>
);

// Settings Stack
const SettingsNavigator = () => {
  const { t } = useLanguage();
  
  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: AUTH_CONFIG.COLORS.primary,
        },
        headerTintColor: '#FFF',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        headerTitleAlign: 'center',
        headerBackTitleVisible: false,
        animation: 'slide_from_right',
      }}
    >
      <SettingsStack.Screen 
        name="SettingsMain" 
        component={SettingsScreen}
        options={{ 
          title: t('settings.title'),
        }}
      />
      <SettingsStack.Screen 
        name="EmergencyContacts" 
        component={EmergencyContactsScreen}
        options={{ title: t('emergency.contacts.title') }}
      />
      <SettingsStack.Screen 
        name="EmergencySettings" 
        component={EmergencySettingsScreen}
        options={{ title: t('emergency.settings.title') }}
      />
      <SettingsStack.Screen 
        name="LanguageSettings" 
        component={LanguageSettingsScreen}
        options={{ title: t('language.title') }}
      />
    </SettingsStack.Navigator>
  );
};

// Emergency Stack
const EmergencyNavigator = () => {
  const { t } = useLanguage();
  
  return (
    <EmergencyStack.Navigator
      initialRouteName="EmergencyContacts"
      screenOptions={{
        headerStyle: {
          backgroundColor: AUTH_CONFIG.COLORS.primary,
        },
        headerTintColor: '#FFF',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        headerTitleAlign: 'center',
        headerBackTitleVisible: false,
        animation: 'slide_from_right',
      }}
    >
      <EmergencyStack.Screen 
        name="EmergencyContacts" 
        component={EmergencyContactsScreen}
        options={{ 
          title: t('emergency.contacts.title'),
        }}
      />
      <EmergencyStack.Screen 
        name="EmergencySettings" 
        component={EmergencySettingsScreen}
        options={{ title: t('emergency.settings.title') }}
      />
      <EmergencyStack.Screen 
        name="LanguageSettings" 
        component={LanguageSettingsScreen}
        options={{ title: t('language.title') }}
      />
    </EmergencyStack.Navigator>
  );
};

// Main screens with bottom tabs
const MainNavigator = () => {
  const { t } = useLanguage();
  
  return (
    <MainTab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: AUTH_CONFIG.COLORS.primary,
        tabBarInactiveTintColor: '#666',
        tabBarStyle: {
          backgroundColor: '#FFF',
          borderTopWidth: 1,
          borderTopColor: '#E0E0E0',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        headerShown: false,
        tabBarIcon: ({ color, size, focused }) => {
          let iconName = 'home';
          
          switch (route.name) {
            case 'Home': iconName = 'home'; break;
            case 'Alerts': iconName = 'bell'; break;
            case 'Emergency': iconName = 'alert-circle'; break;
            case 'Settings': iconName = 'cog'; break;
            default: iconName = 'home';
          }
          
          return <Icon name={iconName} size={size} color={color} />;
        },
      })}
    >
      <MainTab.Screen 
        name="Home" 
        component={HomeScreen}
        options={{ 
          tabBarLabel: t('home.title'),
        }}
      />
      <MainTab.Screen 
        name="Alerts" 
        component={AlertsScreen}
        options={{ 
          tabBarLabel: t('alerts.title'),
        }}
      />
      <MainTab.Screen 
        name="Emergency" 
        component={EmergencyNavigator}
        options={{ 
          tabBarLabel: t('emergency.title'),
        }}
      />
      <MainTab.Screen 
        name="Settings" 
        component={SettingsNavigator}
        options={{ 
          tabBarLabel: t('settings.title'),
        }}
      />
    </MainTab.Navigator>
  );
};

// Main navigation component
export const AppNavigator: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const appState = useRef(AppState.currentState);
  const navigationRef = useRef<any>(null);

  // Enhanced authentication check with session validation
  const checkAuthentication = async (backgroundCheck: boolean = false) => {
    try {
      console.log(`🔄 [Auth Check] ${backgroundCheck ? 'Background' : 'Initial'} check started`);
      
      const session = await authService.loadSession();
      
      if (session) {
        // Check session validity with smart options
        const validation = await authService.validateSession({
          skipServerCheck: backgroundCheck, // Skip server check in background
          autoRefresh: true // Auto-refresh if needed
        });
        
        if (validation.isValid) {
          console.log('✅ [Auth Check] Valid session found');
          
          // Update user in analytics
          analyticsService.setUserId(session.user.id);
          analyticsService.setUserProperties({
            email: session.user.email,
            isAuthenticated: true,
          });
          
          setIsAuthenticated(true);
          
          // Start session monitoring if not already started
          if (!backgroundCheck) {
            authService.startSessionMonitor();
          }
        } else {
          console.log(`❌ [Auth Check] Session invalid: ${validation.reason}`);
          
          // Track session expiration
          analyticsService.track('session_expired', {
            reason: validation.reason,
            wasInBackground: backgroundCheck,
          });
          
          // Clear session data
          await authService.clearSession();
          setIsAuthenticated(false);
          
          // Show alert only if not in background and not initial load
          if (!backgroundCheck && !isLoading) {
            Alert.alert(
              'Session Expired',
              'Your session has expired. Please login again.',
              [{ 
                text: 'OK', 
                onPress: () => {
                  // Navigate to login if possible
                  if (navigationRef.current) {
                    navigationRef.current.navigate('Auth');
                  }
                }
              }]
            );
          }
        }
      } else {
        console.log('❌ [Auth Check] No session found');
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('❌ [Auth Check] Error:', error);
      
      // Track authentication error
      analyticsService.track('authentication_error', {
        error: error instanceof Error ? error.message : 'Unknown',
        backgroundCheck,
      });
      
      // On error, assume not authenticated to be safe
      setIsAuthenticated(false);
    } finally {
      if (!backgroundCheck) {
        setIsLoading(false);
      }
    }
  };

  // App state change handler
  const handleAppStateChange = (nextAppState: any) => {
    console.log(`📱 [App State] Changed from ${appState.current} to ${nextAppState}`);
    
    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      // App came to foreground - check authentication
      console.log('📱 [App State] App came to foreground, checking auth...');
      analyticsService.track('app_foreground');
      checkAuthentication(true);
    } else if (
      appState.current === 'active' &&
      nextAppState.match(/inactive|background/)
    ) {
      // App going to background
      console.log('📱 [App State] App going to background');
      analyticsService.track('app_background');
      
      // Update last activity before going to background
      authService.updateLastActivity();
    }
    
    appState.current = nextAppState;
  };

  // Initialize auth and setup listeners
  useEffect(() => {
    // Initial authentication check
    const initializeNavigation = async () => {
      try {
        await checkAuthentication(false);
        
        // Initialize auth service
        await authService.initialize();
        
        console.log('✅ [Navigation] Initialized successfully');
      } catch (error) {
        console.error('❌ [Navigation] Initialization error:', error);
        setIsLoading(false);
      }
    };

    initializeNavigation();

    // Listen for app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Cleanup function
    return () => {
      subscription.remove();
      authService.stopSessionMonitor();
    };
  }, []);

  // Check session on focus (when returning to auth screens)
  useFocusEffect(
    React.useCallback(() => {
      if (!isAuthenticated && !isLoading) {
        console.log('🔍 [Focus] Checking auth on screen focus...');
        checkAuthentication(true);
      }
    }, [isAuthenticated, isLoading])
  );

  // Handle authentication state changes
  useEffect(() => {
    if (!isLoading) {
      console.log(`🔐 [Auth State] User is ${isAuthenticated ? 'authenticated' : 'not authenticated'}`);
      
      // Track authentication state change
      analyticsService.track('authentication_state_change', {
        isAuthenticated,
      });
    }
  }, [isAuthenticated, isLoading]);

  // Handle logout
  const handleLogout = async () => {
    try {
      await authService.logout();
      setIsAuthenticated(false);
      analyticsService.track('user_logout');
      
      // Reset navigation to auth stack
      if (navigationRef.current) {
        navigationRef.current.reset({
          index: 0,
          routes: [{ name: 'Auth' }],
        });
      }
    } catch (error) {
      console.error('❌ [Logout] Error:', error);
    }
  };

  // Handle session timeout from parent component
  useEffect(() => {
    const handleSessionTimeout = async () => {
      console.log('⏰ [Navigation] Session timeout triggered');
      
      Alert.alert(
        'Session Expired',
        'Your session has expired due to inactivity. Please login again.',
        [
          { 
            text: 'OK', 
            onPress: async () => {
              await handleLogout();
            }
          }
        ]
      );
    };

    // Listen for session timeout events (if implemented in authService)
    const timeoutListener = authService.onSessionTimeout(handleSessionTimeout);

    return () => {
      timeoutListener?.remove?.();
    };
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer 
      ref={navigationRef}
      theme={MyTheme}
      onStateChange={(state) => {
        // Track navigation state changes
        const currentRoute = state?.routes[state.index];
        if (currentRoute) {
          analyticsService.track('navigation_state_change', {
            routeName: currentRoute.name,
            isAuthenticated,
          });
        }
      }}
    >
      <RootStack.Navigator
        initialRouteName={isAuthenticated ? "MainTabs" : "Auth"}
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          animation: 'slide_from_right',
          animationTypeForReplace: isAuthenticated ? 'push' : 'pop',
        }}
      >
        {!isAuthenticated ? (
          <RootStack.Screen 
            name="Auth" 
            component={AuthNavigator}
            listeners={{
              focus: () => {
                // Check authentication when auth screens get focus
                if (!isLoading) {
                  checkAuthentication(true);
                }
              }
            }}
          />
        ) : (
          <RootStack.Screen 
            name="MainTabs" 
            component={MainNavigator}
            listeners={{
              focus: () => {
                // Update last activity when main tabs get focus
                authService.updateLastActivity();
              }
            }}
          />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};

// Authentication event handler utilities
export const useAuthEvents = () => {
  const checkAuthOnEvent = async () => {
    try {
      const validation = await authService.validateSession({
        skipServerCheck: false,
        autoRefresh: true
      });
      
      if (!validation.isValid) {
        console.log('⚠️ [Auth Event] Session invalid, navigating to login');
        analyticsService.track('auth_event_session_invalid');
        return false;
      }
      return true;
    } catch (error) {
      console.error('❌ [Auth Event] Error:', error);
      analyticsService.track('auth_event_error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return false;
    }
  };

  const requireAuthForAction = async (actionName: string) => {
    const canProceed = await authService.ensureValidSession(actionName);
    if (!canProceed) {
      // Track unauthorized action attempt
      analyticsService.track('unauthorized_action_attempt', {
        actionName,
      });
      
      // Handle unauthorized action
      Alert.alert(
        'Authentication Required',
        'Please login to perform this action',
        [{ text: 'OK' }]
      );
    }
    return canProceed;
  };

  const logout = async () => {
    try {
      await authService.logout();
      analyticsService.track('manual_logout');
      return true;
    } catch (error) {
      console.error('❌ [Logout] Error:', error);
      analyticsService.track('logout_error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return false;
    }
  };

  return {
    checkAuthOnEvent,
    requireAuthForAction,
    logout
  };
};