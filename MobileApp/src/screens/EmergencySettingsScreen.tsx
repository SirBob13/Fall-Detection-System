import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { emergencyService } from '../services/emergency.service';
import { EmergencySettings } from '../services/emergency.types';
import { useLanguage } from '../components/LanguageProvider';
import { ScreenHeader } from '../components/ScreenHeader';

export const EmergencySettingsScreen: React.FC = () => {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<EmergencySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 12,
    successful: 10,
    failed: 2,
    last: '2024-01-15',
  });

  useEffect(() => {
    loadSettings();
    loadStats();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const data = await emergencyService.getEmergencySettings();
      setSettings(data);
    } catch (error) {
      console.error('Error loading emergency settings:', error);
      Alert.alert(t('common.error'), t('emergency.settings.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const statsData = await emergencyService.getEmergencyStats();
      if (statsData) {
        setStats(statsData);
      }
    } catch (error) {
      console.warn('Could not load stats:', error);
    }
  };

  const handleSettingChange = async (key: keyof EmergencySettings, value: any) => {
    if (!settings) return;

    try {
      const updatedSettings = { ...settings, [key]: value };
      setSettings(updatedSettings);
      
      const success = await emergencyService.updateEmergencySettings({ [key]: value });
      if (!success) {
        // Rollback if failed
        setSettings(settings);
        Alert.alert(t('common.error'), t('emergency.settings.updateFailed'));
      }
    } catch (error) {
      console.error('Error updating setting:', error);
      setSettings(settings); // Rollback
    }
  };

  const handleResetSettings = () => {
    Alert.alert(
      t('emergency.settings.resetTitle'),
      t('emergency.settings.resetConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('emergency.settings.resetAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              const defaultSettings = emergencyService.getDefaultSettings();
              await emergencyService.updateEmergencySettings(defaultSettings);
              setSettings(defaultSettings);
              Alert.alert(t('success.updated'), t('emergency.settings.resetSuccess'));
            } catch (error) {
              Alert.alert(t('common.error'), t('emergency.settings.resetFailed'));
            }
          },
        },
      ]
    );
  };

  const handleClearHistory = () => {
    Alert.alert(
      t('emergency.settings.clearTitle'),
      t('emergency.settings.clearConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('emergency.settings.clearAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              const success = await emergencyService.clearEmergencyHistory();
              if (success) {
                Alert.alert(t('success.deleted'), t('emergency.settings.clearSuccess'));
                setStats({ total: 0, successful: 0, failed: 0, last: t('common.none') });
              } else {
                Alert.alert(t('common.error'), t('emergency.settings.clearFailed'));
              }
            } catch (error) {
              Alert.alert(t('common.error'), t('emergency.settings.clearError'));
            }
          },
        },
      ]
    );
  };


  const renderSettingItem = (
    title: string,
    description: string,
    key: keyof EmergencySettings,
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']
  ) => {
    if (!settings) return null;

    return (
      <View className="mb-6">
        <View className="flex-row items-center mb-3">
          <View className="w-10 h-10 rounded-full bg-blue-50 justify-center items-center mr-3">
            <MaterialCommunityIcons name={icon} size={20} color="#2196F3" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-dark">
              {title}
            </Text>
            <Text className="text-xs text-gray mt-1">{description}</Text>
          </View>
          <Switch
            value={settings[key] as boolean}
            onValueChange={(value) => handleSettingChange(key, value)}
            trackColor={{ false: '#E0E0E0', true: '#2196F3' }}
            thumbColor={settings[key] ? '#FFFFFF' : '#F4F3F4'}
          />
        </View>
      </View>
    );
  };

  const renderSliderSetting = (
    title: string,
    description: string,
    key: keyof EmergencySettings,
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'],
    min: number,
    max: number,
    step: number,
    unit: string = 'seconds'
  ) => {
    if (!settings) return null;

    const value = settings[key] as number;

    return (
      <View className="mb-6">
        <View className="flex-row items-center mb-4">
          <View className="w-10 h-10 rounded-full bg-blue-50 justify-center items-center mr-3">
            <MaterialCommunityIcons name={icon} size={20} color="#2196F3" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-dark">
              {title}
            </Text>
            <Text className="text-xs text-gray mt-1">{description}</Text>
          </View>
        </View>
        
        <View className="pl-13">
          <Text className="text-lg font-bold text-primary text-center mb-2">
            {value} {unit}
          </Text>
          <Slider
            style={{ height: 40 }}
            minimumValue={min}
            maximumValue={max}
            step={step}
            value={value}
            onValueChange={(value) => handleSettingChange(key, value)}
            minimumTrackTintColor="#2196F3"
            maximumTrackTintColor="#D3D3D3"
            thumbTintColor="#2196F3"
          />
          <View className="flex-row justify-between mt-1">
            <Text className="text-xs text-gray">
              {t('settings.currentValue')}
            </Text>
            <Text className="text-xs text-gray">
              {String(settings[key] ?? '')}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  if (isLoading || !settings) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <MaterialCommunityIcons name="cog" size={60} color="#2196F3" />
        <Text className="mt-4 text-base text-gray">
          {t('common.loading')}
        </Text>
        <ActivityIndicator color="#2196F3" size="large" className="mt-4" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-light" showsVerticalScrollIndicator={false}>
      <ScreenHeader title={t('emergency.settings.title')} subtitle={t('emergency.settings.description')} />

      {/* Emergency Actions */}
      <View className="card mx-4 mt-6">
        <Text className="section-title">{t('emergency.settings.actionsTitle')}</Text>
        
        {renderSettingItem(
          t('emergency.settings.autoCall'),
          t('emergency.settings.autoCallDesc'),
          'auto_call_emergency',
          'phone'
        )}
        
        {renderSettingItem(
          t('emergency.settings.sendSMS'),
          t('emergency.settings.sendSMSDesc'),
          'send_sms',
          'message-text'
        )}
        
        {renderSettingItem(
          t('emergency.settings.sendLocation'),
          t('emergency.settings.sendLocationDesc'),
          'send_location',
          'map-marker'
        )}
        
        {renderSettingItem(
          t('emergency.settings.callAfterFall'),
          t('emergency.settings.callAfterFallDesc'),
          'call_after_fall',
          'run'
        )}
      </View>

      {/* Timing Settings */}
      <View className="card mx-4 my-4">
        <Text className="section-title">{t('emergency.settings.timingTitle')}</Text>
        
        {renderSliderSetting(
          t('emergency.settings.countdown'),
          t('emergency.settings.countdownDesc'),
          'sos_countdown',
          'timer',
          3,
          30,
          1,
          t('common.seconds')
        )}
        
        {renderSliderSetting(
          t('emergency.settings.maxRetries'),
          t('emergency.settings.maxRetriesDesc'),
          'max_retries',
          'refresh',
          1,
          5,
          1,
          t('common.attempts')
        )}
      </View>

      {/* Statistics */}
      <View className="card mx-4 my-4">
        <Text className="section-title">{t('emergency.settings.statsTitle')}</Text>
        <View className="flex-row justify-between mt-2">
          <View className="items-center flex-1 p-3 bg-lightGray/20 rounded-xl mx-1">
            <MaterialCommunityIcons name="history" size={24} color="#2196F3" />
            <Text className="text-2xl font-bold text-dark mt-2">{stats.total}</Text>
            <Text className="text-xs text-gray">
              {t('emergency.settings.totalTests')}
            </Text>
          </View>
          
          <View className="items-center flex-1 p-3 bg-lightGray/20 rounded-xl mx-1">
            <MaterialCommunityIcons name="check-circle" size={24} color="#4CAF50" />
            <Text className="text-2xl font-bold text-dark mt-2">{stats.successful}</Text>
            <Text className="text-xs text-gray">
              {t('emergency.settings.successfulTests')}
            </Text>
          </View>
          
          <View className="items-center flex-1 p-3 bg-lightGray/20 rounded-xl mx-1">
            <MaterialCommunityIcons name="alert-circle" size={24} color="#F44336" />
            <Text className="text-2xl font-bold text-dark mt-2">{stats.failed}</Text>
            <Text className="text-xs text-gray">
              {t('emergency.settings.failedTests')}
            </Text>
          </View>
        </View>
        
        <View className="mt-4 p-3 bg-blue-50 rounded-lg">
          <Text className="text-sm text-dark font-medium">{t('emergency.settings.statsLast')}</Text>
          <Text className="text-xs text-gray mt-1">{stats.last}</Text>
        </View>
      </View>

      {/* Actions */}
      <View className="card mx-4 my-4">
        <Text className="section-title">{t('emergency.settings.actions')}</Text>
        
        <View className="flex-row justify-between mt-2">
          <TouchableOpacity
            className="flex-row items-center justify-center py-3 px-4 bg-lightGray rounded-lg flex-1 mr-2"
            onPress={handleResetSettings}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="restore" size={20} color="#212121" />
            <Text className="text-sm font-semibold text-dark ml-2">{t('emergency.settings.resetAction')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            className="flex-row items-center justify-center py-3 px-4 bg-red-50 border border-danger rounded-lg flex-1 ml-2"
            onPress={handleClearHistory}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="trash-can" size={20} color="#F44336" />
            <Text className="text-sm font-semibold text-danger ml-2">{t('emergency.settings.clearAction')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Instructions */}
      <View className="card mx-4 my-4">
        <Text className="section-title">{t('emergency.settings.instructionsTitle')}</Text>
        <View className="space-y-3 mt-2">
          <View className="flex-row items-start">
            <MaterialCommunityIcons name="check-circle" size={16} color="#4CAF50" className="mt-0.5" />
            <Text className="text-sm text-dark ml-2 flex-1">
              {t('emergency.settings.instruction1')}
            </Text>
          </View>
          
          <View className="flex-row items-start">
            <MaterialCommunityIcons name="check-circle" size={16} color="#4CAF50" className="mt-0.5" />
            <Text className="text-sm text-dark ml-2 flex-1">
              {t('emergency.settings.instruction2')}
            </Text>
          </View>
          
          <View className="flex-row items-start">
            <MaterialCommunityIcons name="check-circle" size={16} color="#4CAF50" className="mt-0.5" />
            <Text className="text-sm text-dark ml-2 flex-1">
              {t('emergency.settings.instruction3')}
            </Text>
          </View>
          
          <View className="flex-row items-start">
            <MaterialCommunityIcons name="check-circle" size={16} color="#4CAF50" className="mt-0.5" />
            <Text className="text-sm text-dark ml-2 flex-1">
              {t('emergency.settings.instruction4')}
            </Text>
          </View>
        </View>
      </View>

      {/* Footer */}
      <View className="items-center py-8 px-4">
        <View className="w-12 h-12 rounded-full bg-blue-50 justify-center items-center mb-3">
          <MaterialCommunityIcons name="shield-check" size={24} color="#2196F3" />
        </View>
        <Text className="text-sm text-gray text-center mb-2">
          {t('emergency.settings.footerDesc')}
        </Text>
        <Text className="text-xs text-lightGray">
          {t('emergency.settings.footerHint')}
        </Text>
      </View>

    </ScrollView>
  );
};
