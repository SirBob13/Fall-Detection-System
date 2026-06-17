import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import { NativeStackNavigationProp as StackNavigationProp } from '@react-navigation/native-stack';
import { useLanguage } from '../components/LanguageProvider';
import { useSettings } from '../components/SettingsProvider';
import { storageService } from '../services/storage';
import { authService } from '../services/auth.service';
import { User, Device } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';
import { getDeviceOperationalStatus, getDeviceStatusLabel, getUserPresenceStatus } from '../utils/deviceStatus';
import { deviceService } from '../services/device.service';
import { parseApiDate } from '../utils/helpers';

type SettingsScreenNavigationProp = StackNavigationProp<any>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { t, language } = useLanguage();
  const { settings, refreshSettings, updateSettings } = useSettings();
  const scrollRef = useRef<any>(null);
  const [user, setUser] = useState<User | null>(null);
  const [primaryDevice, setPrimaryDevice] = useState<Device | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);

  useScrollToTop(scrollRef);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsRefreshingDevices(true);
    try {
      const sessionUser = await authService.getCurrentUser();
      const storedUser = sessionUser || (await storageService.getUser());
      const storedDevice = await storageService.getDevice();

      setUser(storedUser as User);
      await refreshSettings();

      const activeUserId = Number((storedUser as User | null)?.id || 0);
      if (activeUserId) {
        const userDevices = await deviceService.refreshUserDevices(activeUserId);
        const mergedDevices = dedupeDevices([
          ...userDevices,
          ...(storedDevice ? [storedDevice] : []),
        ]);
        setDevices(mergedDevices);
      } else {
        setDevices(storedDevice ? [storedDevice] : []);
      }

      setPrimaryDevice(storedDevice);
    } finally {
      setIsRefreshingDevices(false);
    }
  };

  const currentDeviceId = settings.defaultDeviceId || primaryDevice?.device_id || devices[0]?.device_id;

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

  const handleShowDeviceDetails = (device: Device) => {
    navigation.navigate('DeviceDetails', { device });
  };

  const handleRemoveDevice = (device: Device) => {
    if (!user?.id) return;

    Alert.alert(t('system.removeDeviceTitle'), t('system.removeDeviceBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('system.removeDeviceAction'),
        style: 'destructive',
        onPress: async () => {
          setRemovingDeviceId(device.device_id);
          try {
            const removed = await deviceService.removeDevice(device.device_id, user.id);
            if (!removed) {
              Alert.alert(t('common.error'), t('system.removeDeviceFailed'));
              return;
            }

            if (settings.defaultDeviceId === device.device_id) {
              await updateSettings({ defaultDeviceId: null });
            }

            await loadData();
            Alert.alert(t('common.success'), t('system.deviceRemoved'));
          } catch (error) {
            Alert.alert(t('common.error'), t('system.removeDeviceFailed'));
          } finally {
            setRemovingDeviceId(null);
          }
        },
      },
    ]);
  };

  const formatRelativeTime = (dateString?: string | null) => {
    const date = parseApiDate(dateString);
    if (!date) return null;

    const diffMs = Date.now() - date.getTime();
    const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSeconds < 60) return t('datetime.secondsAgo', { count: diffSeconds || 1 });

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return t('datetime.minutesAgo', { count: diffMinutes });

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return t('datetime.hoursAgo', { count: diffHours });

    return t('datetime.daysAgo', { count: Math.floor(diffHours / 24) });
  };

  const getDeviceQuickStatus = (device: Device) => {
    if (device.data_state === 'streaming') {
      return t('system.deviceQuickLive');
    }

    const syncTime = formatRelativeTime(device.latest_data_at || device.last_seen);
    if (syncTime) {
      return t('system.deviceQuickLastSync', { time: syncTime });
    }

    return t('system.dataUnavailable');
  };

  const presenceStatus = getUserPresenceStatus(!!user, devices);
  const presenceLabel = presenceStatus === 'active' ? t('system.userActive') : t('system.userLoggedIn');

  return (
    <ScrollView ref={scrollRef} className="flex-1 bg-gray-50" showsVerticalScrollIndicator={false}>
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
          <View className="px-3 py-1 rounded-full bg-primary/10 mr-3">
            <Text className="text-[10px] font-bold text-primary">{presenceLabel}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#D1D5DB" />
        </TouchableOpacity>
      </View>

      {/* Main Settings Section */}
      <View className="px-5 space-y-3">
        <Text className="text-xs font-bold text-gray-400 uppercase mb-2 ml-2">{t('settings.quickAccess')}</Text>
        <SettingItem
          icon="phone-alert"
          color="#EF4444"
          bgColor="bg-red-50"
          title={t('emergency.contacts.title')}
          desc={t('emergency.contacts.description')}
          onPress={() => navigation.navigate('EmergencyContacts')}
        />

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
          desc={language === 'ar' ? t('language.arabic') : t('language.english')}
          onPress={() => navigation.navigate('LanguageSettings')}
        />
      </View>

      <View className="px-5 mt-6">
        <View className="flex-row items-center justify-between mb-2 px-2">
          <Text className="text-xs font-bold text-gray-400 uppercase">{t('settings.deviceInfo')}</Text>
          <View className="flex-row items-center">
            <View className="px-2.5 py-1 rounded-full bg-primary/10 mr-2">
              <Text className="text-[10px] font-bold text-primary">
                {t('settings.deviceCount', { count: devices.length })}
              </Text>
            </View>
            <TouchableOpacity
              className="w-8 h-8 rounded-full bg-white border border-gray-200 items-center justify-center"
              onPress={loadData}
              disabled={isRefreshingDevices}
            >
              {isRefreshingDevices ? (
                <ActivityIndicator size="small" color="#2196F3" />
              ) : (
                <MaterialCommunityIcons name="refresh" size={16} color="#2196F3" />
              )}
            </TouchableOpacity>
          </View>
        </View>
        {devices.length === 0 ? (
          <View className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
            <Text className="text-sm font-semibold text-gray-800">{t('system.noDevicesLinkedTitle')}</Text>
            <Text className="text-xs text-gray-500 mt-1">{t('system.noDevicesLinkedDesc')}</Text>
          </View>
        ) : (
          devices.map((device) => {
            const isCurrent = currentDeviceId === device.device_id;
            const isOnlineLike = ['active', 'connected_no_data'].includes(getDeviceOperationalStatus(device));

            return (
              <View key={device.device_id} className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 mb-4">
                <View className="flex-row items-center justify-between mb-4">
                  <View className="flex-row items-center flex-1 pr-3">
                    <MaterialCommunityIcons name="watch" size={24} color="#6B7280" />
                    <View className="ml-2 flex-1">
                      <Text className="font-bold text-gray-800">{formatDeviceId(device.device_id)}</Text>
                      <Text className="text-[11px] text-gray-400 mt-1">{device.device_id}</Text>
                      <Text className="text-[11px] text-gray-500 mt-1">{getDeviceQuickStatus(device)}</Text>
                      {isCurrent ? (
                        <Text className="text-[11px] text-primary mt-1">{t('system.currentDevice')}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View className={`px-3 py-1 rounded-full ${isOnlineLike ? 'bg-green-100' : 'bg-red-100'}`}>
                    <Text className={`text-[10px] font-bold ${isOnlineLike ? 'text-green-700' : 'text-red-700'}`}>
                      {getDeviceStatusLabel(device)}
                    </Text>
                  </View>
                </View>

                <View className="flex-row justify-between border-t border-gray-50 pt-4">
                  <StatusMiniItem
                    icon="battery"
                    label={t('home.battery')}
                    value={typeof device.battery_level === 'number' ? `${device.battery_level}%` : '--'}
                  />
                  <StatusMiniItem
                    icon="clock-outline"
                    label={t('system.lastSeen')}
                    value={parseApiDate(device.last_seen)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '--'}
                  />
                  <StatusMiniItem
                    icon="tag-outline"
                    label={t('system.version')}
                    value={device.firmware_version || '--'}
                  />
                </View>

                <View className="flex-row mt-4">
                  <TouchableOpacity
                    className="flex-1 mr-2 rounded-xl bg-blue-50 border border-primary/20 py-3 items-center"
                    onPress={() => handleShowDeviceDetails(device)}
                  >
                    <Text className="text-xs font-semibold text-primary">{t('system.viewDetails')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 ml-2 rounded-xl bg-red-50 border border-danger/20 py-3 items-center"
                    onPress={() => handleRemoveDevice(device)}
                    disabled={removingDeviceId === device.device_id}
                  >
                    <Text className="text-xs font-semibold text-danger">
                      {removingDeviceId === device.device_id ? t('common.loading') : t('system.removeDeviceAction')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Bottom Actions */}
      <View className="px-5 mt-6 mb-10 space-y-2">
        <Text className="text-xs font-bold text-gray-400 uppercase mb-2 ml-2">{t('settings.actions')}</Text>
        <View className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
          <ActionRow icon="help-circle" title={t('settings.help')} color="#06B6D4" onPress={() => Alert.alert(t('settings.help'), t('settings.helpMessage'))} />
          <ActionRow icon="shield-lock" title={t('settings.privacy')} color="#10B981" onPress={() => navigation.navigate('PrivacyPolicy')} />
          <ActionRow icon="information" title={t('settings.about')} color="#3B82F6" onPress={() => Alert.alert(t('settings.about'), t('settings.aboutMessage', { version: '2.0.0' }))} />
          <ActionRow icon="logout" title={t('settings.logout')} color="#EF4444" onPress={handleLogout} isLast />
        </View>
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

const dedupeDevices = (devices: Device[]): Device[] =>
  devices.filter((device, index, list) => list.findIndex((item) => item.device_id === device.device_id) === index);

const formatDeviceId = (deviceId?: string | null) => {
  if (!deviceId) return '--';
  if (deviceId.length <= 16) return deviceId;
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
};

const SettingItem = ({ icon, color, bgColor, title, desc, onPress }: any) => (
  <TouchableOpacity onPress={onPress} className="flex-row items-center bg-white p-4 rounded-2xl mb-3 shadow-sm border border-gray-100">
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

const ActionRow = ({ icon, title, color, onPress, isLast }: any) => (
  <TouchableOpacity onPress={onPress} className={`flex-row items-center bg-white p-4 ${isLast ? '' : 'border-b border-gray-50'}`}>
    <MaterialCommunityIcons name={icon} size={20} color={color} />
    <Text className="ml-3 flex-1 text-sm font-medium text-gray-700">{title}</Text>
    <MaterialCommunityIcons name="chevron-right" size={18} color="#D1D5DB" />
  </TouchableOpacity>
);
