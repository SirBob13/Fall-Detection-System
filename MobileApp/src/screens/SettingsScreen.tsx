import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  Linking,
  StyleSheet,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp as StackNavigationProp } from '@react-navigation/native-stack';
import { useLanguage } from '../components/LanguageProvider';
import { useSettings } from '../components/SettingsProvider';
import { storageService } from '../services/storage';
import { notificationService } from '../services/notifications';
import { authService } from '../services/auth.service';
import { User, Device } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';
import { getUserPresenceStatus, isDeviceOnline } from '../utils/deviceStatus';

type SettingsScreenNavigationProp = StackNavigationProp<any>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { t, language } = useLanguage();
  const { settings, updateSetting, refreshSettings } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const sessionUser = await authService.getCurrentUser();
    const storedUser = sessionUser || (await storageService.getUser());
    const storedDevice = await storageService.getDevice();
    setUser(storedUser as User);
    setDevice(storedDevice);
    await refreshSettings();
  };

  const handleSettingChange = async (key: keyof typeof settings, value: any) => {
    await updateSetting(key, value);
    if (key === 'notifications' && !value) {
      notificationService.cancelAllNotifications();
    }
  };

  const handleFamilyPortal = async () => {
    const url = 'https://family.falldetection.app';
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
    else Alert.alert(t('common.error'), t('settings.familyPortalUnavailable'));
  };

  const handleLogout = () => {
    Alert.alert(t('settings.logout'), t('common.confirmLogout'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.logout'),
        style: 'destructive',
        onPress: async () => {
          await authService.logout();
          await storageService.clearAll();
          navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
        },
      },
    ]);
  };

  const presenceStatus = getUserPresenceStatus(!!user, device ? [device] : []);
  const presenceLabel = presenceStatus === 'active' ? t('system.userActive') : t('system.userLoggedIn');

  return (
    <ScrollView className="flex-1 bg-gray-50" showsVerticalScrollIndicator={false}>
      <ScreenHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {/* User Info Card */}
      <View className="px-5 mb-4">
        <TouchableOpacity
          className="flex-row items-center bg-white p-5 rounded-3xl shadow-sm border border-gray-100"
          onPress={() => navigation.navigate('PersonalInfo')}
          activeOpacity={0.8}
        >
          <View className="w-14 h-14 rounded-full bg-indigo-50 justify-center items-center">
            <MaterialCommunityIcons name="account" size={30} color="#4F46E5" />
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-lg font-bold text-gray-900">{user?.name || t('common.user')}</Text>
            <Text className="text-xs text-gray-500 mt-1">
              {user ? `${user.age} ${t('common.years')} • ${presenceLabel}` : t('settings.personalInfoDesc')}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#D1D5DB" />
        </TouchableOpacity>
      </View>

      {/* Main Settings Section */}
      <View className="px-5 space-y-3">
        <SettingItem 
          icon="account-multiple" 
          color="#10B981" 
          bgColor="bg-green-50"
          title={t('settings.careManagement')}
          desc={t('settings.careManagementDesc')}
          onPress={() => navigation.navigate('CareManagement')}
        />
        
        <SettingItem 
          icon="view-dashboard" 
          color="#3B82F6" 
          bgColor="bg-blue-50"
          title={t('dashboard.title')}
          desc={t('dashboard.shortDesc')}
          onPress={() => navigation.navigate('CareDashboard')}
        />

        <SettingItem 
          icon="translate" 
          color="#6366F1" 
          bgColor="bg-indigo-50"
          title={t('language.title')}
          desc={language === 'ar' ? 'العربية' : 'English'}
          onPress={() => navigation.navigate('LanguageSettings')}
        />
      </View>

      {/* Emergency Contacts Box */}
      <View className="px-5 mt-6">
        <Text className="text-xs font-bold text-gray-400 uppercase mb-2 ml-2">{t('emergency.title')}</Text>
        <TouchableOpacity
          className="flex-row items-center bg-white p-5 rounded-3xl shadow-sm border border-red-50"
          onPress={() => navigation.navigate('EmergencyContacts')}
        >
          <View className="w-12 h-12 rounded-full bg-red-50 justify-center items-center">
            <MaterialCommunityIcons name="phone-alert" size={24} color="#EF4444" />
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-base font-bold text-gray-900">{t('emergency.contacts.title')}</Text>
            <Text className="text-xs text-gray-500">{t('emergency.contacts.description')}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#D1D5DB" />
        </TouchableOpacity>
      </View>

      {/* Device Status Box */}
      {device && (
        <View className="px-5 mt-6">
          <Text className="text-xs font-bold text-gray-400 uppercase mb-2 ml-2">{t('system.deviceInfo')}</Text>
          <View className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center">
                <MaterialCommunityIcons name="watch" size={24} color="#6B7280" />
                <Text className="ml-2 font-bold text-gray-800">{device.device_id}</Text>
              </View>
              <View className={`px-3 py-1 rounded-full ${isDeviceOnline(device) ? 'bg-green-100' : 'bg-red-100'}`}>
                <Text className={`text-[10px] font-bold ${isDeviceOnline(device) ? 'text-green-700' : 'text-red-700'}`}>
                  {isDeviceOnline(device) ? t('common.online') : t('common.offline')}
                </Text>
              </View>
            </View>
            
            <View className="flex-row justify-between border-t border-gray-50 pt-4">
              <StatusMiniItem icon="battery" label={t('home.battery')} value={`${device.battery_level}%`} />
              <StatusMiniItem icon="clock-outline" label={t('system.lastSeen')} value={device.last_seen ? new Date(device.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'} />
              <StatusMiniItem icon="tag-outline" label={t('system.version')} value={device.firmware_version || '1.0'} />
            </View>
          </View>
        </View>
      )}

      {/* Toggles Section */}
      <View className="px-5 mt-6">
        <View className="bg-white rounded-3xl p-2 border border-gray-100">
          <ToggleRow 
            label={t('settings.notifications')} 
            value={!!settings.notifications} 
            onValueChange={(val) => handleSettingChange('notifications', val)} 
          />
          <View className="h-px bg-gray-50 mx-4" />
          <ToggleRow 
            label={t('settings.autoConnect')} 
            value={!!settings.autoConnect} 
            onValueChange={(val) => handleSettingChange('autoConnect', val)} 
          />
        </View>
      </View>

      {/* Bottom Actions */}
      <View className="px-5 mt-6 mb-10 space-y-2">
        <ActionRow icon="help-circle" title={t('settings.help')} color="#06B6D4" onPress={() => Alert.alert(t('settings.help'), t('settings.helpMessage'))} />
        <ActionRow icon="shield-lock" title={t('settings.privacy')} color="#10B981" onPress={() => navigation.navigate('PrivacyPolicy')} />
        <ActionRow icon="information" title={t('settings.about')} color="#3B82F6" onPress={() => Alert.alert(t('app.name'), `${t('app.version')} 2.0.0`)} />
        <ActionRow icon="logout" title={t('settings.logout')} color="#EF4444" onPress={handleLogout} isLast />
      </View>

      {/* App Branding */}
      <View className="items-center pb-12">
        <MaterialCommunityIcons name="heart-pulse" size={32} color="#3B82F6" />
        <Text className="text-gray-400 text-xs mt-2">© 2026 {t('app.company')}</Text>
      </View>
    </ScrollView>
  );
};

// --- Sub-components to keep code clean ---

const SettingItem = ({ icon, color, bgColor, title, desc, onPress }: any) => (
  <TouchableOpacity onPress={onPress} className="flex-row items-center bg-white p-4 rounded-2xl mb-3 shadow-sm border border-gray-50">
    <View className={`w-11 h-11 rounded-xl ${bgColor} justify-center items-center`}>
      <MaterialCommunityIcons name={icon} size={22} color={color} />
    </View>
    <View className="ml-4 flex-1">
      <Text className="text-sm font-bold text-gray-800">{title}</Text>
      <Text className="text-[11px] text-gray-400 mt-0.5">{desc}</Text>
    </View>
    <MaterialCommunityIcons name="chevron-right" size={20} color="#D1D5DB" />
  </TouchableOpacity>
);

const StatusMiniItem = ({ icon, label, value }: any) => (
  <View className="items-center flex-1">
    <MaterialCommunityIcons name={icon} size={16} color="#9CA3AF" />
    <Text className="text-[10px] text-gray-400 mt-1 uppercase font-bold">{label}</Text>
    <Text className="text-xs font-bold text-gray-700">{value}</Text>
  </View>
);

const ToggleRow = ({ label, value, onValueChange }: any) => (
  <View className="flex-row items-center justify-between p-4">
    <Text className="text-sm font-semibold text-gray-700">{label}</Text>
    <Switch 
      value={value} 
      onValueChange={onValueChange} 
      trackColor={{ false: '#E5E7EB', true: '#3B82F6' }}
      thumbColor="#FFFFFF"
    />
  </View>
);

const ActionRow = ({ icon, title, color, onPress, isLast }: any) => (
  <TouchableOpacity onPress={onPress} className={`flex-row items-center bg-white p-4 ${isLast ? 'rounded-b-2xl' : ''} border-b border-gray-50`}>
    <MaterialCommunityIcons name={icon} size={20} color={color} />
    <Text className="ml-3 flex-1 text-sm font-medium text-gray-700">{title}</Text>
    <MaterialCommunityIcons name="chevron-right" size={18} color="#D1D5DB" />
  </TouchableOpacity>
);