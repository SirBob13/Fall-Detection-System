import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { emergencyService } from '../services/emergency.service';
import { EmergencySettings } from '../services/emergency.types';

export const EmergencySettingsScreen: React.FC = () => {
  const [settings, setSettings] = useState<EmergencySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testPhone, setTestPhone] = useState('');
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
      Alert.alert('Error', 'Failed to load emergency settings');
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
        Alert.alert('Error', 'Failed to update settings');
      }
    } catch (error) {
      console.error('Error updating setting:', error);
      setSettings(settings); // Rollback
    }
  };

  const handleResetSettings = () => {
    Alert.alert(
      'Reset Settings',
      'Do you want to reset all emergency settings to default values?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              const defaultSettings = emergencyService.getDefaultSettings();
              await emergencyService.updateEmergencySettings(defaultSettings);
              setSettings(defaultSettings);
              Alert.alert('Success', 'Settings reset successfully');
            } catch (error) {
              Alert.alert('Error', 'Failed to reset settings');
            }
          },
        },
      ]
    );
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear History',
      'Do you want to clear all emergency operation history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const success = await emergencyService.clearEmergencyHistory();
              if (success) {
                Alert.alert('Success', 'History cleared successfully');
                setStats({ total: 0, successful: 0, failed: 0, last: 'None' });
              } else {
                Alert.alert('Error', 'Failed to clear history');
              }
            } catch (error) {
              Alert.alert('Error', 'An error occurred while clearing history');
            }
          },
        },
      ]
    );
  };

  const handleTestSMS = async () => {
    if (!testPhone.trim() || !testMessage.trim()) {
      Alert.alert('Error', 'Please enter phone number and message');
      return;
    }

    try {
      Alert.alert(
        'Test SMS',
        `Will send message to:\n${testPhone}\n\nMessage: ${testMessage}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Send',
            onPress: async () => {
              // Note: In real app, use SMS.sendSMSAsync
              Alert.alert('Success', 'Test message sent (simulation)');
              setModalVisible(false);
              setTestMessage('');
              setTestPhone('');
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to send test message');
    }
  };

  const handleTestEmergency = async () => {
    Alert.alert(
      'Test Emergency System',
      'Will run a test of the emergency system (without actual sending). Do you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Test',
          onPress: async () => {
            try {
              const success = await emergencyService.triggerEmergency('manual');
              if (success) {
                Alert.alert(
                  '✅ Test Successful',
                  'Emergency operation simulated successfully.\n\n' +
                  'In real mode it would:\n' +
                  '• Send SMS to emergency contacts\n' +
                  '• Send location\n' +
                  '• Call specified numbers'
                );
              } else {
                Alert.alert('⚠️ Warning', 'Emergency system test failed');
              }
            } catch (error) {
              Alert.alert('❌ Error', 'An error occurred during testing');
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
    icon: string
  ) => {
    if (!settings) return null;

    return (
      <View className="mb-6">
        <View className="flex-row items-center mb-3">
          <View className="w-10 h-10 rounded-full bg-blue-50 justify-center items-center mr-3">
            <MaterialCommunityIcons name={icon} size={20} color="#2196F3" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-dark">{title}</Text>
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
    icon: string,
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
            <Text className="text-base font-semibold text-dark">{title}</Text>
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
            <Text className="text-xs text-gray">{min}</Text>
            <Text className="text-xs text-gray">{max}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (isLoading || !settings) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <MaterialCommunityIcons name="cog" size={60} color="#2196F3" />
        <Text className="mt-4 text-base text-gray">Loading settings...</Text>
        <ActivityIndicator color="#2196F3" size="large" className="mt-4" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-light" showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View className="bg-primary pb-8 rounded-b-3xl">
        <View className="items-center pt-8">
          <View className="w-20 h-20 rounded-full bg-white/20 justify-center items-center mb-4">
            <MaterialCommunityIcons name="shield-alert" size={40} color="#FFFFFF" />
          </View>
          <Text className="text-2xl font-bold text-white text-center mb-2">
            Emergency System Settings
          </Text>
          <Text className="text-sm text-white/80 text-center px-8">
            Customize how the emergency system works in case of danger
          </Text>
        </View>
      </View>

      {/* Emergency Actions */}
      <View className="card mx-4 mt-6">
        <Text className="section-title">Emergency Actions</Text>
        
        {renderSettingItem(
          'Auto Call Emergency',
          'Automatically call specified numbers when emergency is triggered',
          'auto_call_emergency',
          'phone'
        )}
        
        {renderSettingItem(
          'Send SMS Messages',
          'Send text messages to emergency contacts with emergency details',
          'send_sms',
          'message-text'
        )}
        
        {renderSettingItem(
          'Send Location',
          'Include current location in emergency messages',
          'send_location',
          'map-marker'
        )}
        
        {renderSettingItem(
          'Call After Fall',
          'Activate emergency system automatically when fall is detected',
          'call_after_fall',
          'run'
        )}
      </View>

      {/* Timing Settings */}
      <View className="card mx-4 my-4">
        <Text className="section-title">Timing Settings</Text>
        
        {renderSliderSetting(
          'Emergency Countdown',
          'Wait duration before sending help request',
          'sos_countdown',
          'timer',
          3,
          30,
          1
        )}
        
        {renderSliderSetting(
          'Max Retry Attempts',
          'Number of retry attempts if connection fails',
          'max_retries',
          'refresh',
          1,
          5,
          1,
          'attempts'
        )}
      </View>

      {/* Statistics */}
      <View className="card mx-4 my-4">
        <Text className="section-title">System Statistics</Text>
        <View className="flex-row justify-between mt-2">
          <View className="items-center flex-1 p-3 bg-lightGray/20 rounded-xl mx-1">
            <MaterialCommunityIcons name="history" size={24} color="#2196F3" />
            <Text className="text-2xl font-bold text-dark mt-2">{stats.total}</Text>
            <Text className="text-xs text-gray">Total Operations</Text>
          </View>
          
          <View className="items-center flex-1 p-3 bg-lightGray/20 rounded-xl mx-1">
            <MaterialCommunityIcons name="check-circle" size={24} color="#4CAF50" />
            <Text className="text-2xl font-bold text-dark mt-2">{stats.successful}</Text>
            <Text className="text-xs text-gray">Successful</Text>
          </View>
          
          <View className="items-center flex-1 p-3 bg-lightGray/20 rounded-xl mx-1">
            <MaterialCommunityIcons name="alert-circle" size={24} color="#F44336" />
            <Text className="text-2xl font-bold text-dark mt-2">{stats.failed}</Text>
            <Text className="text-xs text-gray">Failed</Text>
          </View>
        </View>
        
        <View className="mt-4 p-3 bg-blue-50 rounded-lg">
          <Text className="text-sm text-dark font-medium">Last Operation</Text>
          <Text className="text-xs text-gray mt-1">{stats.last}</Text>
        </View>
      </View>

      {/* Test & Actions */}
      <View className="card mx-4 my-4">
        <Text className="section-title">Testing & Actions</Text>
        
        <TouchableOpacity
          className="btn-primary flex-row items-center justify-center mb-3"
          onPress={handleTestEmergency}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="play-circle" size={24} color="#FFFFFF" />
          <Text className="btn-primary-text ml-2">Test Emergency System</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          className="btn-success flex-row items-center justify-center mb-4"
          onPress={() => setModalVisible(true)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="message-processing" size={24} color="#FFFFFF" />
          <Text className="text-white font-semibold ml-2">Test SMS Sending</Text>
        </TouchableOpacity>
        
        <View className="flex-row justify-between mt-2">
          <TouchableOpacity
            className="flex-row items-center justify-center py-3 px-4 bg-lightGray rounded-lg flex-1 mr-2"
            onPress={handleResetSettings}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="restore" size={20} color="#212121" />
            <Text className="text-sm font-semibold text-dark ml-2">Reset</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            className="flex-row items-center justify-center py-3 px-4 bg-red-50 border border-danger rounded-lg flex-1 ml-2"
            onPress={handleClearHistory}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="trash-can" size={20} color="#F44336" />
            <Text className="text-sm font-semibold text-danger ml-2">Clear History</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Instructions */}
      <View className="card mx-4 my-4">
        <Text className="section-title">Important Instructions</Text>
        <View className="space-y-3 mt-2">
          <View className="flex-row items-start">
            <MaterialCommunityIcons name="check-circle" size={16} color="#4CAF50" className="mt-0.5" />
            <Text className="text-sm text-dark ml-2 flex-1">
              Make sure you have added correct emergency contacts
            </Text>
          </View>
          
          <View className="flex-row items-start">
            <MaterialCommunityIcons name="check-circle" size={16} color="#4CAF50" className="mt-0.5" />
            <Text className="text-sm text-dark ml-2 flex-1">
              Test the system regularly to ensure it works
            </Text>
          </View>
          
          <View className="flex-row items-start">
            <MaterialCommunityIcons name="check-circle" size={16} color="#4CAF50" className="mt-0.5" />
            <Text className="text-sm text-dark ml-2 flex-1">
              Maintain battery charge to avoid service interruption
            </Text>
          </View>
          
          <View className="flex-row items-start">
            <MaterialCommunityIcons name="check-circle" size={16} color="#4CAF50" className="mt-0.5" />
            <Text className="text-sm text-dark ml-2 flex-1">
              Inform contacts that they are listed as emergency contacts
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
          Emergency system works automatically when fall is detected or when emergency button is pressed
        </Text>
        <Text className="text-xs text-lightGray">Version 2.0 - Enhanced System</Text>
      </View>

      {/* Test SMS Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/50">
          <View className="bg-white rounded-2xl w-11/12 max-w-md p-6">
            <View className="items-center mb-6">
              <View className="w-16 h-16 rounded-full bg-blue-50 justify-center items-center mb-3">
                <MaterialCommunityIcons name="message-text" size={30} color="#2196F3" />
              </View>
              <Text className="text-xl font-bold text-dark">Test SMS Sending</Text>
              <Text className="text-sm text-gray mt-1 text-center">
                Enter phone number and message for testing
              </Text>
            </View>

            <TextInput
              className="input-field mb-4"
              placeholder="Phone number (e.g., +201234567890)"
              value={testPhone}
              onChangeText={setTestPhone}
              keyboardType="phone-pad"
              placeholderTextColor="#BDBDBD"
            />

            <TextInput
              className="input-field h-28 mb-6 text-align-top"
              placeholder="Test message text"
              value={testMessage}
              onChangeText={setTestMessage}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              placeholderTextColor="#BDBDBD"
            />

            <View className="flex-row justify-between">
              <TouchableOpacity
                className="flex-1 bg-lightGray py-3 rounded-lg mr-2 items-center"
                onPress={() => {
                  setModalVisible(false);
                  setTestMessage('');
                  setTestPhone('');
                }}
                activeOpacity={0.7}
              >
                <Text className="text-dark font-semibold">Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                className="flex-1 bg-success py-3 rounded-lg ml-2 flex-row items-center justify-center"
                onPress={handleTestSMS}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" />
                <Text className="text-white font-bold ml-2">Send Test</Text>
              </TouchableOpacity>
            </View>
            
            <Text className="text-xs text-gray mt-4 text-center">
              Note: In development mode, SMS sending is simulated
            </Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};