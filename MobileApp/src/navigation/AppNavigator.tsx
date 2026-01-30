import React, { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, View, Text } from 'react-native';

import { AUTH_CONFIG } from '../constants/auth';
import { authService } from '../services/auth.service';
import { useLanguage } from '../components/LanguageProvider';

// استيراد شاشات المصادقة
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';

// استيراد الشاشات الرئيسية
import { HomeScreen } from '../screens/HomeScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { EmergencyContactsScreen } from '../screens/EmergencyContactsScreen';
import { EmergencySettingsScreen } from '../screens/EmergencySettingsScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';

// تعريف أنواع التنقل
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

// تخصيص سمة التنقل
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

// مكون التحميل
const LoadingScreen = () => (
  <View style={{ 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#FFF'
  }}>
    <ActivityIndicator size="large" color={AUTH_CONFIG.COLORS.primary} />
    <Text style={{ marginTop: 16, color: '#666' }}>جاري التحميل...</Text>
  </View>
);

// شاشات المصادقة
const AuthNavigator = () => (
  <AuthStack.Navigator
    initialRouteName="Login"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: '#FFF' },
    }}
  >
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="Register" component={RegisterScreen} />
    <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    <AuthStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
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
      }}
    >
      <SettingsStack.Screen 
        name="SettingsMain" 
        component={SettingsScreen}
        options={{ 
          title: t('settings.title'),
          headerLeft: () => null,
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
      }}
    >
      <EmergencyStack.Screen 
        name="EmergencyContacts" 
        component={EmergencyContactsScreen}
        options={{ 
          title: t('emergency.contacts.title'),
          headerLeft: () => null,
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

// الشاشات الرئيسية
const MainNavigator = () => {
  const { t } = useLanguage();
  
  return (
    <MainTab.Navigator
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
          headerShown: false,
        }}
      />
      <MainTab.Screen 
        name="Alerts" 
        component={AlertsScreen}
        options={{ 
          tabBarLabel: t('alerts.title'),
          headerShown: false,
        }}
      />
      <MainTab.Screen 
        name="Emergency" 
        component={EmergencyNavigator}
        options={{ 
          tabBarLabel: t('emergency.title'),
          headerShown: false,
        }}
      />
      <MainTab.Screen 
        name="Settings" 
        component={SettingsNavigator}
        options={{ 
          tabBarLabel: t('settings.title'),
          headerShown: false,
        }}
      />
    </MainTab.Navigator>
  );
};

// المكون الرئيسي للتنقل
export const AppNavigator: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuthentication = async () => {
      try {
        // تحميل الجلسة أولاً من التخزين المحلي
        const session = await authService.loadSession();
        
        if (session) {
          // إذا كانت هناك جلسة محفوظة، تحقق من صحتها
          const isValid = await authService.isAuthenticated();
          
          if (isValid) {
            console.log('✅ User authenticated from saved session');
            setIsAuthenticated(true);
          } else {
            console.log('❌ Session expired or invalid');
            setIsAuthenticated(false);
          }
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthentication();
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer theme={MyTheme}>
      <RootStack.Navigator
        initialRouteName={isAuthenticated ? "MainTabs" : "Auth"}
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          animation: 'slide_from_right',
        }}
      >
        {!isAuthenticated ? (
          <RootStack.Screen 
            name="Auth" 
            component={AuthNavigator} 
            options={{ gestureEnabled: false }}
          />
        ) : (
          <RootStack.Screen 
            name="MainTabs" 
            component={MainNavigator}
            options={{ gestureEnabled: false }}
          />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};