// MobileApp/src/navigation/types.ts

import { NativeStackNavigationProp as StackNavigationProp } from '@react-navigation/native-stack';

// تعريف أنواع التنقل الرئيسية
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  EmergencySetup: { requiredSetup?: boolean; openImport?: boolean } | undefined;
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
  EmergencyContacts: { requiredSetup?: boolean; openImport?: boolean } | undefined;
  LanguageSettings: undefined;
  PersonalInfo: undefined;
  CareManagement: undefined;
  CareDashboard: undefined;
  DeviceDetails: { device: import('../types').Device };
  PrivacyPolicy: undefined;
  ResetPassword: { token: string };
};

// أنواع التنقل للطوارئ
export type EmergencyStackParamList = {
  EmergencyContacts: { requiredSetup?: boolean; openImport?: boolean } | undefined;
  LanguageSettings: undefined;
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
