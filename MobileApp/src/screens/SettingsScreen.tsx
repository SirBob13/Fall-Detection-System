import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useLanguage } from '../components/LanguageProvider';
import { storageService } from '../services/storage';
import { notificationService } from '../services/notifications';
import { authService } from '../services/auth.service';
import { User, Device } from '../types';

type SettingsScreenNavigationProp = StackNavigationProp<any>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { t, language } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [settings, setSettings] = useState({
    notifications: true,
    vibration: true,
    sound: true,
    autoConnect: true,
    fallDetection: true,
    vitalMonitoring: true,
    seniorMode: false,
    offlineMode: false,
    voiceCommands: false,
    automaticSOS: true,
    familyPortal: false,
    healthInsights: true,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const sessionUser = await authService.getCurrentUser();
    const normalizedSessionUser = sessionUser
      ? ({
          id: Number(sessionUser.id ?? 0),
          name: sessionUser.name || '',
          age: sessionUser.age ?? 0,
          gender: (sessionUser.gender as User['gender']) || 'other',
          weight: sessionUser.weight,
          height: sessionUser.height,
          medical_conditions: sessionUser.medical_conditions,
          emergency_contact: sessionUser.emergency_contact,
          is_active: sessionUser.is_active ?? true,
          created_at: sessionUser.created_at || new Date().toISOString(),
        } as User)
      : null;
    const storedUser = normalizedSessionUser || (await storageService.getUser());
    const storedDevice = await storageService.getDevice();
    const storedSettings = await storageService.getSettings();

    setUser(storedUser);
    if (normalizedSessionUser) {
      await storageService.saveUser(normalizedSessionUser);
    }
    setDevice(storedDevice);
    if (storedSettings) {
      setSettings(storedSettings);
    }
  };

  const handleSettingChange = async (key: keyof typeof settings, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await storageService.saveSettings(newSettings);

    if (key === 'notifications' && !value) {
      notificationService.cancelAllNotifications();
    }
  };

  const handlePersonalInfo = () => {
    navigation.navigate('PersonalInfo');
  };

  const handleCareManagement = () => {
    navigation.navigate('CareManagement');
  };

  const handleCareDashboard = () => {
    navigation.navigate('CareDashboard');
  };

  const handleReports = () => {
    navigation.navigate('Reports');
  };
  const handleLogout = () => {
    Alert.alert(
      t('settings.logout'),
      `${t('common.confirm')} ${t('settings.logout').toLowerCase()}?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.logout'),
          style: 'destructive',
          onPress: async () => {
            await authService.logout();
            await storageService.clearAll();
            const rootNavigation: any = navigation.getParent?.()?.getParent?.();
            rootNavigation?.reset?.({
              index: 0,
              routes: [{ name: 'Auth' }],
            });
          },
        },
      ]
    );
  };

  const testNotification = () => {
    if (!user) {
      Alert.alert(t('common.error'), t('errors.loginRequired'));
      return;
    }

    notificationService.sendFallAlert({
      id: Date.now(),
      user_id: user.id,
      timestamp: new Date().toISOString(),
      alert_type: 'fall',
      severity: 'critical',
      message: t('alerts.fallDetected'),
      status: 'pending',
    });
    Alert.alert(t('success.sent'), t('notifications.testSent'));
  };

  const handleEmergencyContacts = () => {
    navigation.navigate('EmergencyContacts');
  };

  const handleEmergencySettings = () => {
    navigation.navigate('EmergencySettings');
  };

  const handleLanguageSettings = () => {
    navigation.navigate('LanguageSettings');
  };

  const handleDeviceManagement = () => {
    navigation.navigate('DeviceManagement');
  };

  const handleHelp = () => {
    Alert.alert(t('settings.help'), t('settings.helpMessage'));
  };

  const handlePrivacy = () => {
    navigation.navigate('PrivacyPolicy');
  };

  const handleAbout = () => {
    Alert.alert(
      t('app.name'),
      `${t('app.version')} 1.0.0\n${t('app.description')}`
    );
  };

  const handleSyncData = async () => {
    try {
      Alert.alert(t('common.syncing'), t('common.pleaseWait'));
      await loadData();
      Alert.alert(t('success.synced'), t('success.dataUpdated'));
    } catch (error) {
      Alert.alert(t('common.error'), t('errors.syncFailed'));
    }
  };

  return (
    <ScrollView className="flex-1 bg-light" showsVerticalScrollIndicator={false}>
      {/* Personal Info Section */}
      <View className="my-2">
        <Text className="section-title">
          {t('settings.personalInfo')}
        </Text>
        
        <TouchableOpacity
          className="flex-row items-center justify-between bg-white mx-4 p-5 rounded-2xl shadow-lg active:opacity-80"
          onPress={handlePersonalInfo}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center flex-1">
            <View className="w-12 h-12 rounded-full bg-purple-50 justify-center items-center">
              <MaterialCommunityIcons name="account-circle" size={24} color="#7E57C2" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-dark">{t('settings.personalInfo')}</Text>
              <Text className="text-xs text-gray mt-1">
                {user ? `${user.name} • ${user.age} ${t('common.years')}` : t('settings.personalInfoDesc')}
              </Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#757575" />
        </TouchableOpacity>
      </View>

      {/* Care Management Section */}
      <View className="my-2">
        <Text className="section-title">
          {t('care.title')}
        </Text>

        <TouchableOpacity
          className="flex-row items-center justify-between bg-white mx-4 p-5 rounded-2xl shadow-lg active:opacity-80"
          onPress={handleCareManagement}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center flex-1">
            <View className="w-12 h-12 rounded-full bg-green-50 justify-center items-center">
              <MaterialCommunityIcons name="account-multiple" size={24} color="#4CAF50" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-dark">{t('settings.careManagement')}</Text>
              <Text className="text-xs text-gray mt-1">
                {t('settings.careManagementDesc')}
              </Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#757575" />
        </TouchableOpacity>

        <TouchableOpacity
          className="flex-row items-center justify-between bg-white mx-4 mt-3 p-5 rounded-2xl shadow-lg active:opacity-80"
          onPress={handleCareDashboard}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center flex-1">
            <View className="w-12 h-12 rounded-full bg-blue-50 justify-center items-center">
              <MaterialCommunityIcons name="view-dashboard" size={24} color="#2196F3" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-dark">{t('dashboard.title')}</Text>
              <Text className="text-xs text-gray mt-1">
                {t('dashboard.shortDesc')}
              </Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#757575" />
        </TouchableOpacity>
      </View>

      {/* Reports Section */}
      <View className="my-2">
        <Text className="section-title">
          {t('reports.title')}
        </Text>

        <TouchableOpacity
          className="flex-row items-center justify-between bg-white mx-4 p-5 rounded-2xl shadow-lg active:opacity-80"
          onPress={handleReports}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center flex-1">
            <View className="w-12 h-12 rounded-full bg-orange-50 justify-center items-center">
              <MaterialCommunityIcons name="file-chart" size={24} color="#FF9800" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-dark">{t('reports.title')}</Text>
              <Text className="text-xs text-gray mt-1">
                {t('reports.shortDesc')}
              </Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#757575" />
        </TouchableOpacity>
      </View>
      
      {/* Language Section */}
      <View className="my-2">
        <Text className="section-title">
      {t('language.title')}
        </Text>
        
        <TouchableOpacity
          className="flex-row items-center justify-between bg-white mx-4 p-5 rounded-2xl shadow-lg active:opacity-80"
          onPress={handleLanguageSettings}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center flex-1">
            <View className="w-12 h-12 rounded-full bg-blue-50 justify-center items-center">
              <MaterialCommunityIcons name="translate" size={24} color="#2196F3" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-dark">{t('language.title')}</Text>
              <Text className="text-xs text-gray mt-1">
                {language === 'ar' ? t('language.arabic') : t('language.english')}
              </Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#757575" />
        </TouchableOpacity>
      </View>

      {/* Accessibility / Senior Mode */}
      <View className="my-2">
        <Text className="section-title">{t('settings.accessibility')}</Text>

        <View className="bg-white mx-4 p-5 rounded-2xl shadow-lg">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View className="w-12 h-12 rounded-full bg-orange-50 justify-center items-center">
                <MaterialCommunityIcons name="account-heart" size={24} color="#FF9800" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-base font-semibold text-dark">
                  {t('settings.seniorMode')}
                </Text>
                <Text className="text-xs text-gray mt-1">
                  {t('settings.seniorModeDesc')}
                </Text>
              </View>
            </View>
            <Switch
              value={settings.seniorMode}
              onValueChange={(value) => handleSettingChange('seniorMode', value)}
              trackColor={{ false: '#E0E0E0', true: '#2196F3' }}
              thumbColor={settings.seniorMode ? '#FFFFFF' : '#F4F3F4'}
            />
          </View>
        </View>
      </View>

      {/* Emergency System Section */}
      <View className="my-2">
        <Text className="section-title">
          {t('emergency.title')}
        </Text>
        
        <View className="emergency-card">
          <TouchableOpacity
            className="flex-row items-center p-5 active:bg-lightGray/10"
            onPress={handleEmergencyContacts}
            activeOpacity={0.7}
          >
            <View className="w-12 h-12 rounded-full bg-red-50 justify-center items-center mr-4">
              <MaterialCommunityIcons name="account-group" size={24} color="#F44336" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-dark mb-1">
                {t('emergency.contacts.title')}
              </Text>
              <Text className="text-xs text-gray leading-4">
                {t('emergency.contacts.description')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#757575" />
          </TouchableOpacity>
          
          <View className="h-px bg-lightGray mx-5" />
          
          <TouchableOpacity
            className="flex-row items-center p-5 active:bg-lightGray/10"
            onPress={handleEmergencySettings}
            activeOpacity={0.7}
          >
            <View className="w-12 h-12 rounded-full bg-orange-50 justify-center items-center mr-4">
              <MaterialCommunityIcons name="cog" size={24} color="#FF9800" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-dark mb-1">
                {t('emergency.settings.title')}
              </Text>
              <Text className="text-xs text-gray leading-4">
                {t('emergency.settings.description')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#757575" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Device Information Section */}
      <View className="my-2">
        <Text className="section-title">
          {t('settings.deviceInfo')}
        </Text>
        <TouchableOpacity
          className="flex-row items-center justify-between bg-white mx-4 p-5 rounded-2xl shadow-lg active:opacity-80"
          onPress={handleDeviceManagement}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center flex-1">
            <View className="w-12 h-12 rounded-full bg-green-50 justify-center items-center">
              <MaterialCommunityIcons name="devices" size={24} color="#4CAF50" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-dark">{t('settings.deviceManagement')}</Text>
              <Text className="text-xs text-gray mt-1">
                {t('settings.deviceManagementDesc')}
              </Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#757575" />
        </TouchableOpacity>

        {device && (
          <View className="card mt-3">
            <View className="flex-row items-center mb-4">
              <View className="w-12 h-12 rounded-full bg-green-50 justify-center items-center">
                <MaterialCommunityIcons name="devices" size={24} color="#4CAF50" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-base font-semibold text-dark">
                  {device.device_id}
                </Text>
                <Text className="text-sm text-gray mt-1">{device.device_id}</Text>
              </View>
              <View className="flex-row items-center">
                <View 
                  className={`w-3 h-3 rounded-full mr-2 ${device.is_connected ? 'bg-success' : 'bg-danger'}`}
                />
                <Text className="text-xs text-gray">
                  {device.is_connected ? t('common.connected') : t('common.disconnected')}
                </Text>
              </View>
            </View>
            
            <View className="flex-row justify-between border-t border-lightGray pt-4">
              <View className="items-center flex-1">
                <View className="flex-row items-center mb-1">
                  <MaterialCommunityIcons name="battery" size={16} color="#757575" />
                  <Text className="text-xs text-gray ml-1">{t('home.battery')}</Text>
                </View>
                <Text className="text-base font-semibold text-dark">
                  {device.battery_level?.toFixed(0) || '--'}%
                </Text>
              </View>
              
              <View className="items-center flex-1 border-x border-lightGray">
                <View className="flex-row items-center mb-1">
                  <MaterialCommunityIcons name="clock" size={16} color="#757575" />
                  <Text className="text-xs text-gray ml-1">{t('system.lastSeen')}</Text>
                </View>
                <Text className="text-base font-semibold text-dark">
                  {device.last_seen
                    ? new Date(device.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--'}
                </Text>
              </View>
              
              <View className="items-center flex-1">
                <View className="flex-row items-center mb-1">
                  <MaterialCommunityIcons name="tag" size={16} color="#757575" />
                  <Text className="text-xs text-gray ml-1">{t('system.version')}</Text>
                </View>
                <Text className="text-base font-semibold text-dark">
                  {device.firmware_version || '--'}
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* General Settings Section */}
      <View className="my-2">
        <Text className="section-title">
          {t('settings.generalSettings')}
        </Text>
        
        <View className="card">
          {Object.entries({
            notifications: t('settings.notifications'),
            vibration: t('settings.vibration'),
            sound: t('settings.sound'),
            autoConnect: t('settings.autoConnect'),
            fallDetection: t('settings.fallDetection'),
            vitalMonitoring: t('settings.vitalMonitoring'),
            seniorMode: t('settings.seniorMode'),
          }).map(([key, label]) => (
            <View key={key} className="setting-row">
              <View className="flex-1">
                <Text className="text-base text-dark font-medium">{label}</Text>
                {key === 'fallDetection' && (
                  <Text className="text-xs text-gray mt-1">
                    {t('settings.fallDetectionDesc')}
                  </Text>
                )}
                {key === 'vitalMonitoring' && (
                  <Text className="text-xs text-gray mt-1">
                    {t('settings.vitalMonitoringDesc')}
                  </Text>
                )}
                {key === 'seniorMode' && (
                  <Text className="text-xs text-gray mt-1">
                    {t('settings.seniorModeDesc')}
                  </Text>
                )}
              </View>
              <Switch
                value={settings[key as keyof typeof settings]}
                onValueChange={(value) => 
                  handleSettingChange(key as keyof typeof settings, value)
                }
                trackColor={{ false: '#E0E0E0', true: '#2196F3' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#E0E0E0"
              />
            </View>
          ))}
        </View>
      </View>

      {/* Advanced Features */}
      <View className="my-2">
        <Text className="section-title">
          {t('settings.advanced')}
        </Text>
        <View className="card">
          {(['offlineMode', 'voiceCommands', 'automaticSOS', 'familyPortal', 'healthInsights'] as const).map((key) => (
            <View key={key} className="setting-row">
              <View className="flex-1">
                <Text className="text-base text-dark font-medium">{t(`settings.${key}`)}</Text>
                <Text className="text-xs text-gray mt-1">{t(`settings.${key}Desc`)}</Text>
              </View>
              <Switch
                value={settings[key]}
                onValueChange={(value) => handleSettingChange(key, value)}
                trackColor={{ false: '#E0E0E0', true: '#2196F3' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#E0E0E0"
              />
            </View>
          ))}
        </View>
      </View>

      {/* System Test Section */}
      <View className="my-2">
        <Text className="section-title">
          {t('settings.testSystem')}
        </Text>
        
        <View className="card">
          <TouchableOpacity 
            className="flex-row items-center py-4 border-b border-lightGray active:opacity-70"
            onPress={testNotification}
            disabled={!user}
            activeOpacity={0.7}
          >
            <View className="w-10 h-10 rounded-full bg-orange-50 justify-center items-center">
              <MaterialCommunityIcons name="bell-ring" size={20} color="#FF9800" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-medium text-dark">
                {t('settings.testNotifications')}
              </Text>
              <Text className="text-xs text-gray mt-1">
                {t('settings.testNotificationsDesc')}
              </Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity 
            className="flex-row items-center py-4 active:opacity-70"
            onPress={handleSyncData}
            activeOpacity={0.7}
          >
            <View className="w-10 h-10 rounded-full bg-blue-50 justify-center items-center">
              <MaterialCommunityIcons name="refresh" size={20} color="#2196F3" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-medium text-dark">
                {t('settings.refreshData')}
              </Text>
              <Text className="text-xs text-gray mt-1">
                {t('settings.refreshDataDesc')}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Actions Section */}
      <View className="my-2 mb-8">
        <Text className="section-title">
          {t('settings.actions')}
        </Text>
        
        <View className="emergency-card">
          <TouchableOpacity 
            className="flex-row items-center p-5 border-b border-lightGray active:bg-lightGray/10"
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <View className="w-10 h-10 rounded-full bg-gray-100 justify-center items-center">
              <MaterialCommunityIcons name="logout" size={20} color="#757575" />
            </View>
            <Text className="text-base text-dark ml-3 flex-1">{t('settings.logout')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#757575" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            className="flex-row items-center p-5 border-b border-lightGray active:bg-lightGray/10"
            onPress={handleHelp}
            activeOpacity={0.7}
          >
            <View className="w-10 h-10 rounded-full bg-blue-50 justify-center items-center">
              <MaterialCommunityIcons name="help-circle" size={20} color="#00BCD4" />
            </View>
            <Text className="text-base text-dark ml-3 flex-1">{t('settings.help')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#757575" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            className="flex-row items-center p-5 border-b border-lightGray active:bg-lightGray/10"
            onPress={handlePrivacy}
            activeOpacity={0.7}
          >
            <View className="w-10 h-10 rounded-full bg-green-50 justify-center items-center">
              <MaterialCommunityIcons name="shield-check" size={20} color="#4CAF50" />
            </View>
            <Text className="text-base text-dark ml-3 flex-1">{t('settings.privacy')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#757575" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            className="flex-row items-center p-5 active:bg-lightGray/10"
            onPress={handleAbout}
            activeOpacity={0.7}
          >
            <View className="w-10 h-10 rounded-full bg-purple-50 justify-center items-center">
              <MaterialCommunityIcons name="information" size={20} color="#2196F3" />
            </View>
            <Text className="text-base text-dark ml-3 flex-1">{t('settings.about')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#757575" />
          </TouchableOpacity>
        </View>
      </View>

      {/* App Info */}
      <View className="items-center py-8 mb-4">
        <MaterialCommunityIcons name="heart-pulse" size={40} color="#2196F3" />
        <Text className="text-base text-gray mt-3 mb-1">{t('app.name')}</Text>
        <Text className="text-sm text-lightGray">v1.0.0 • {t('app.description')}</Text>
        <Text className="text-xs text-lightGray mt-2">© 2024 {t('app.company')}</Text>
      </View>
    </ScrollView>
  );
};
