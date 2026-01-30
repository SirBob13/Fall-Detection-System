import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { emergencyService } from '../services/emergency.service';
import { EmergencySettings } from '../services/emergency.types';
import { COLORS } from '../utils/constants';
import Slider from '@react-native-community/slider';

export const EmergencySettingsScreen: React.FC = () => {
  const [settings, setSettings] = useState<EmergencySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testPhone, setTestPhone] = useState('');

  useEffect(() => {
    loadSettings();
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

  const getHistoryStats = async () => {
    try {
      const history = await emergencyService.getEmergencyHistory();
      return {
        total: history.length,
        successful: history.filter(h => h.status === 'sent').length,
        failed: history.filter(h => h.status === 'failed').length,
        last: history[0]?.timestamp || 'None',
      };
    } catch (error) {
      return null;
    }
  };

  const renderSettingItem = (
    title: string,
    description: string,
    key: keyof EmergencySettings,
    icon: string
  ) => {
    if (!settings) return null;

    return (
      <View style={styles.settingItem}>
        <View style={styles.settingHeader}>
          <View style={styles.settingIconContainer}>
            <MaterialCommunityIcons name={icon} size={24} color={COLORS.primary} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>{title}</Text>
            <Text style={styles.settingDescription}>{description}</Text>
          </View>
          <Switch
            value={settings[key] as boolean}
            onValueChange={(value) => handleSettingChange(key, value)}
            trackColor={{ false: '#767577', true: COLORS.primary }}
            thumbColor={settings[key] ? '#fff' : '#f4f3f4'}
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
      <View style={styles.settingItem}>
        <View style={styles.settingHeader}>
          <View style={styles.settingIconContainer}>
            <MaterialCommunityIcons name={icon} size={24} color={COLORS.primary} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>{title}</Text>
            <Text style={styles.settingDescription}>{description}</Text>
          </View>
        </View>
        
        <View style={styles.sliderContainer}>
          <Text style={styles.sliderValue}>
            {value} {unit}
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={min}
            maximumValue={max}
            step={step}
            value={value}
            onValueChange={(value) => handleSettingChange(key, value)}
            minimumTrackTintColor={COLORS.primary}
            maximumTrackTintColor="#d3d3d3"
            thumbTintColor={COLORS.primary}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>{min}</Text>
            <Text style={styles.sliderLabel}>{max}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (isLoading || !settings) {
    return (
      <View style={styles.loadingContainer}>
        <MaterialCommunityIcons name="cog" size={60} color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <MaterialCommunityIcons name="shield-alert" size={40} color={COLORS.white} />
        </View>
        <Text style={styles.headerTitle}>Emergency System Settings</Text>
        <Text style={styles.headerSubtitle}>
          Customize how the emergency system works in case of danger
        </Text>
      </View>

      {/* Emergency Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Emergency Actions</Text>
        
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
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Timing Settings</Text>
        
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
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>System Statistics</Text>
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="history" size={24} color={COLORS.primary} />
            <Text style={styles.statNumber}>12</Text>
            <Text style={styles.statLabel}>Total Operations</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="check-circle" size={24} color={COLORS.success} />
            <Text style={styles.statNumber}>10</Text>
            <Text style={styles.statLabel}>Successful</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialCommunityIcons name="alert-circle" size={24} color={COLORS.danger} />
            <Text style={styles.statNumber}>2</Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
        </View>
      </View>

      {/* Test & Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Testing & Actions</Text>
        
        <TouchableOpacity
          style={styles.testButton}
          onPress={handleTestEmergency}
        >
          <MaterialCommunityIcons name="play-circle" size={24} color="#FFF" />
          <Text style={styles.testButtonText}>Test Emergency System</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.testButton, styles.smsButton]}
          onPress={() => setModalVisible(true)}
        >
          <MaterialCommunityIcons name="message-processing" size={24} color="#FFF" />
          <Text style={styles.testButtonText}>Test SMS Sending</Text>
        </TouchableOpacity>
        
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, styles.resetButton]}
            onPress={handleResetSettings}
          >
            <MaterialCommunityIcons name="restore" size={20} color={COLORS.dark} />
            <Text style={styles.resetButtonText}>Reset Settings</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.clearButton]}
            onPress={handleClearHistory}
          >
            <MaterialCommunityIcons name="trash-can" size={20} color={COLORS.danger} />
            <Text style={styles.clearButtonText}>Clear History</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Instructions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Important Instructions</Text>
        <View style={styles.instructions}>
          <View style={styles.instructionItem}>
            <MaterialCommunityIcons name="check-circle" size={16} color={COLORS.success} />
            <Text style={styles.instructionText}>
              Make sure you have added correct emergency contacts
            </Text>
          </View>
          <View style={styles.instructionItem}>
            <MaterialCommunityIcons name="check-circle" size={16} color={COLORS.success} />
            <Text style={styles.instructionText}>
              Test the system regularly to ensure it works
            </Text>
          </View>
          <View style={styles.instructionItem}>
            <MaterialCommunityIcons name="check-circle" size={16} color={COLORS.success} />
            <Text style={styles.instructionText}>
              Maintain battery charge to avoid service interruption
            </Text>
          </View>
          <View style={styles.instructionItem}>
            <MaterialCommunityIcons name="check-circle" size={16} color={COLORS.success} />
            <Text style={styles.instructionText}>
              Inform contacts that they are listed as emergency contacts
            </Text>
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Emergency system works automatically when fall is detected or when emergency button is pressed
        </Text>
        <Text style={styles.footerVersion}>Version 2.0 - Enhanced System</Text>
      </View>

      {/* Test SMS Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <MaterialCommunityIcons name="message-text" size={30} color={COLORS.primary} />
              <Text style={styles.modalTitle}>Test SMS Sending</Text>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Phone number (e.g., +201234567890)"
              value={testPhone}
              onChangeText={setTestPhone}
              keyboardType="phone-pad"
            />

            <TextInput
              style={[styles.modalInput, styles.messageInput]}
              placeholder="Test message text"
              value={testMessage}
              onChangeText={setTestMessage}
              multiline
              numberOfLines={4}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelModalButton]}
                onPress={() => {
                  setModalVisible(false);
                  setTestMessage('');
                  setTestPhone('');
                }}
              >
                <Text style={styles.cancelModalButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.sendModalButton]}
                onPress={handleTestSMS}
              >
                <MaterialCommunityIcons name="send" size={20} color="#FFF" />
                <Text style={styles.sendModalButtonText}>Send Test</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.gray,
  },
  header: {
    backgroundColor: COLORS.primary,
    padding: 24,
    alignItems: 'center',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    marginBottom: 16,
  },
  headerIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
    paddingBottom: 8,
  },
  settingItem: {
    marginBottom: 24,
  },
  settingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 12,
    color: COLORS.gray,
    lineHeight: 16,
  },
  sliderContainer: {
    marginTop: 8,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
    textAlign: 'center',
    marginBottom: 8,
  },
  slider: {
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sliderLabel: {
    fontSize: 12,
    color: COLORS.gray,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    marginHorizontal: 4,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginVertical: 8,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.gray,
    textAlign: 'center',
  },
  testButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  smsButton: {
    backgroundColor: COLORS.success,
  },
  testButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  resetButton: {
    backgroundColor: COLORS.lightGray,
  },
  resetButtonText: {
    color: COLORS.dark,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  clearButton: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  clearButtonText: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  instructions: {
    marginTop: 8,
  },
  instructionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.dark,
    marginLeft: 8,
    lineHeight: 20,
  },
  footer: {
    padding: 24,
    alignItems: 'center',
    marginBottom: 32,
  },
  footerText: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  footerVersion: {
    fontSize: 12,
    color: COLORS.lightGray,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginTop: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.dark,
    marginBottom: 16,
  },
  messageInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  cancelModalButton: {
    backgroundColor: COLORS.lightGray,
    marginRight: 8,
  },
  cancelModalButtonText: {
    color: COLORS.dark,
    fontSize: 16,
    fontWeight: '600',
  },
  sendModalButton: {
    backgroundColor: COLORS.success,
    marginLeft: 8,
  },
  sendModalButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
});