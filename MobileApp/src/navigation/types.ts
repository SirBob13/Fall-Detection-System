// MobileApp/src/navigation/types.ts

import { NativeStackNavigationProp as StackNavigationProp } from '@react-navigation/native-stack';

// تعريف أنواع التنقل الرئيسية
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

// أنواع شاشات المصادقة
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

// أنواع الشاشات الرئيسية (تبويبات)
export type MainTabParamList = {
  Home: undefined;
  Alerts: undefined;
  EmergencyContacts: undefined;
  Settings: undefined;
};

// أنواع التنقل لشاشات الإعدادات
export type SettingsStackParamList = {
  SettingsMain: undefined;
  EmergencyContacts: undefined;
  EmergencySettings: undefined;
  DeviceManagement: undefined;
};

// أنواع التنقل للطوارئ
export type EmergencyStackParamList = {
  EmergencyMain: undefined;
  EmergencyContacts: undefined;
  EmergencySettings: undefined;
};

// إعادة تصدير أنواع StackNavigationProp
export type AuthNavigationProp = StackNavigationProp<AuthStackParamList>;
export type MainTabNavigationProp = StackNavigationProp<MainTabParamList>;
export type SettingsNavigationProp = StackNavigationProp<SettingsStackParamList>;
export type EmergencyNavigationProp = StackNavigationProp<EmergencyStackParamList>;

// نوع شامل لجميع الشاشات
export type AllScreensParamList = RootStackParamList &
  AuthStackParamList &
  MainTabParamList &
  SettingsStackParamList &
  EmergencyStackParamList;

export type AppNavigationProp = StackNavigationProp<AllScreensParamList>;
