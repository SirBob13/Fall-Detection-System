import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { COLORS } from '../utils/constants';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { notificationService } from '../services/notifications';
import { User, Device } from '../types';
import { useLanguage } from '../components/LanguageProvider';


type SettingsScreenNavigationProp = StackNavigationProp<any>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { t, language, changeLanguage } = useLanguage(); 
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [settings, setSettings] = useState({
    notifications: true,
    vibration: true,
    sound: true,
    autoConnect: true,
    fallDetection: true,
    vitalMonitoring: true,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editedUser, setEditedUser] = useState<Partial<User>>({});
    
  const handleLanguageChange = () => {
    navigation.navigate('LanguageSettings');
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const storedUser = await storageService.getUser();
    const storedDevice = await storageService.getDevice();
    const storedSettings = await storageService.getSettings();

    setUser(storedUser);
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

  const handleUpdateUser = async () => {
    if (!user) return;

    try {
      const response = await apiService.updateUser(user.id, editedUser);
      if (response.success && response.data) {
        setUser(response.data);
        await storageService.saveUser(response.data);
        setIsEditing(false);
        setEditedUser({});
        Alert.alert(t('success.updated'), t('success.saved'));
      } else {
        Alert.alert(t('common.error'), response.message || t('errors.unknown'));
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('errors.unknown'));
    }
  };

  const handleLogout = () => {
    Alert.alert(
      t('settings.logout'),
      t('common.confirm') + ' ' + t('settings.logout').toLowerCase() + '?',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.logout'),
          style: 'destructive',
          onPress: async () => {
            await storageService.clearAll();
            Alert.alert(t('success.loggedOut'), t('success.loggedOut'));
          },
        },
      ]
    );
  };

  const testNotification = () => {
    notificationService.sendFallAlert({
      id: 1,
      user_id: user?.id || 1,
      timestamp: new Date().toISOString(),
      alert_type: 'fall',
      severity: 'critical',
      message: t('alerts.fallDetected'),
      status: 'pending',
    });
    Alert.alert(t('success.sent'), t('success.sent'));
  };

  const handleEmergencyContacts = () => {
    navigation.navigate('EmergencyContacts');
  };

  const handleEmergencySettings = () => {
    navigation.navigate('EmergencySettings');
  };

  const handleLanguageSettings = () => {
    navigation.navigate('LanguageSettings' as never);
  };

  const handleHelp = () => {
    Alert.alert(t('settings.help'), t('common.info'));
  };

  const handlePrivacy = () => {
    Alert.alert(t('settings.privacy'), t('common.info'));
  };

  const handleAbout = () => {
    Alert.alert(t('app.name'), t('app.version'));
  };

  return (
    <ScrollView style={styles.container}>
      {/* Profile Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.profile')}</Text>
        
        {user ? (
          <View style={styles.profileCard}>
            {isEditing ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{t('auth.register.name')}</Text>
                  <TextInput
                    style={styles.input}
                    value={editedUser.name || user.name}
                    onChangeText={(text) => setEditedUser({ ...editedUser, name: text })}
                    placeholder={t('auth.register.name')}
                  />
                </View>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{t('settings.emergencyContact')}</Text>
                  <TextInput
                    style={styles.input}
                    value={editedUser.emergency_contact || user.emergency_contact || ''}
                    onChangeText={(text) => setEditedUser({ ...editedUser, emergency_contact: text })}
                    placeholder="+201234567890"
                    keyboardType="phone-pad"
                  />
                </View>
                
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.button, styles.cancelButton]}
                    onPress={() => {
                      setIsEditing(false);
                      setEditedUser({});
                    }}
                  >
                    <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.button, styles.saveButton]}
                    onPress={handleUpdateUser}
                  >
                    <Text style={styles.saveButtonText}>{t('common.save')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={styles.profileInfo}>
                  <MaterialCommunityIcons name="account-circle" size={60} color={COLORS.primary} />
                  <View style={styles.profileText}>
                    <Text style={styles.userName}>{user.name}</Text>
                    <Text style={styles.userInfo}>
                      {user.age} {t('common.years')} • {user.gender === 'male' ? t('common.male') : t('common.female')}
                    </Text>
                    {user.emergency_contact && (
                      <Text style={styles.userContact}>
                        📞 {user.emergency_contact}
                      </Text>
                    )}
                  </View>
                </View>
                
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => setIsEditing(true)}
                >
                  <MaterialCommunityIcons name="pencil" size={20} color={COLORS.primary} />
                  <Text style={styles.editButtonText}>{t('common.edit')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <TouchableOpacity style={styles.loginButton}>
            <Text style={styles.loginButtonText}>{t('auth.login.title')}</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {/* Language Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('language.title')}</Text>
        
        <TouchableOpacity
          style={styles.settingRow}
          onPress={handleLanguageSettings}
        >
          <View style={styles.settingInfo}>
            <MaterialCommunityIcons name="translate" size={24} color={COLORS.primary} />
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>{t('language.title')}</Text>
              <Text style={styles.settingDescription}>
                {language === 'ar' ? t('language.arabic') : t('language.english')}
              </Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={COLORS.gray} />
        </TouchableOpacity>
      </View>


      {/* Emergency System Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('emergency.title')}</Text>
        
        <View style={styles.emergencyCard}>
          <TouchableOpacity
            style={styles.emergencyItem}
            onPress={handleEmergencyContacts}
          >
            <View style={styles.emergencyIconContainer}>
              <MaterialCommunityIcons name="account-group" size={24} color={COLORS.primary} />
            </View>
            <View style={styles.emergencyInfo}>
              <Text style={styles.emergencyTitle}>{t('emergency.contacts.title')}</Text>
              <Text style={styles.emergencyDescription}>
                {t('emergency.contacts.description')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={COLORS.gray} />
          </TouchableOpacity>
          
          <View style={styles.divider} />
          
          <TouchableOpacity
            style={styles.emergencyItem}
            onPress={handleEmergencySettings}
          >
            <View style={styles.emergencyIconContainer}>
              <MaterialCommunityIcons name="cog" size={24} color={COLORS.primary} />
            </View>
            <View style={styles.emergencyInfo}>
              <Text style={styles.emergencyTitle}>{t('emergency.settings.title')}</Text>
              <Text style={styles.emergencyDescription}>
                {t('emergency.settings.description')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={COLORS.gray} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Device Information Section */}
      {device && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.deviceInfo')}</Text>
          <View style={styles.deviceCard}>
            <View style={styles.deviceRow}>
              <MaterialCommunityIcons name="devices" size={24} color={COLORS.gray} />
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceTitle}>{t('settings.deviceInfo')}</Text>
                <Text style={styles.deviceId}>{device.device_id}</Text>
              </View>
              <View style={[styles.statusDot, { 
                backgroundColor: device.is_connected ? COLORS.success : COLORS.danger 
              }]} />
            </View>
            
            <View style={styles.deviceStats}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>{t('home.battery')}</Text>
                <Text style={styles.statValue}>
                  {device.battery_level?.toFixed(0) || '--'}%
                </Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>{t('system.lastSeen')}</Text>
                <Text style={styles.statValue}>
                  {new Date(device.last_seen).toLocaleTimeString()}
                </Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>{t('system.version')}</Text>
                <Text style={styles.statValue}>{device.firmware_version || '--'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* General Settings Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.generalSettings')}</Text>
        
        <View style={styles.settingsCard}>
          {Object.entries({
            notifications: t('settings.notifications'),
            vibration: t('settings.vibration'),
            sound: t('settings.sound'),
            autoConnect: t('settings.autoConnect'),
            fallDetection: t('settings.fallDetection'),
            vitalMonitoring: t('settings.vitalMonitoring'),
          }).map(([key, label]) => (
            <View key={key} style={styles.settingRow}>
              <Text style={styles.settingLabel}>{label}</Text>
              <Switch
                value={settings[key as keyof typeof settings]}
                onValueChange={(value) => 
                  handleSettingChange(key as keyof typeof settings, value)
                }
                trackColor={{ false: COLORS.lightGray, true: COLORS.primary }}
                thumbColor={COLORS.white}
              />
            </View>
          ))}
        </View>
      </View>

      {/* System Test Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.testSystem')}</Text>
        
        <View style={styles.testCard}>
          <TouchableOpacity style={styles.testButton} onPress={testNotification}>
            <MaterialCommunityIcons name="bell-ring" size={24} color={COLORS.warning} />
            <Text style={styles.testButtonText}>{t('settings.testNotifications')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.testButton} onPress={loadData}>
            <MaterialCommunityIcons name="refresh" size={24} color={COLORS.primary} />
            <Text style={styles.testButtonText}>{t('settings.refreshData')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Actions Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.actions')}</Text>
        
        <View style={styles.actionsCard}>
          <TouchableOpacity style={styles.actionButton} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={24} color={COLORS.gray} />
            <Text style={styles.actionButtonText}>{t('settings.logout')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={handleHelp}>
            <MaterialCommunityIcons name="help-circle" size={24} color={COLORS.info} />
            <Text style={styles.actionButtonText}>{t('settings.help')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={handlePrivacy}>
            <MaterialCommunityIcons name="shield-check" size={24} color={COLORS.success} />
            <Text style={styles.actionButtonText}>{t('settings.privacy')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={handleAbout}>
            <MaterialCommunityIcons name="information" size={24} color={COLORS.primary} />
            <Text style={styles.actionButtonText}>{t('settings.about')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* App Info */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('app.name')}</Text>
        <Text style={styles.footerSubtext}>{t('app.version')}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  section: {
    marginVertical: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  profileCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileText: {
    marginLeft: 16,
    flex: 1,
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 4,
  },
  userInfo: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: 4,
  },
  userContact: {
    fontSize: 14,
    color: COLORS.primary,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
  },
  editButtonText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: COLORS.dark,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.dark,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    marginLeft: 8,
  },
  saveButtonText: {
    color: COLORS.white,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: COLORS.lightGray,
    marginRight: 8,
  },
  cancelButtonText: {
    color: COLORS.dark,
    fontWeight: '600',
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  loginButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  emergencyCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    borderRadius: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  emergencyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
  },
  emergencyIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  emergencyInfo: {
    flex: 1,
  },
  emergencyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: 4,
  },
  emergencyDescription: {
    fontSize: 12,
    color: COLORS.gray,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.lightGray,
    marginHorizontal: 20,
  },
  settingsCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingText: {
    marginLeft: 12,
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: COLORS.dark,
  },
  settingDescription: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  deviceCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  deviceInfo: {
    flex: 1,
    marginLeft: 12,
  },
  deviceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
  },
  deviceId: {
    fontSize: 14,
    color: COLORS.gray,
    marginTop: 2,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  deviceStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.lightGray,
    paddingTop: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.gray,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
  },
  testCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  testButtonText: {
    fontSize: 16,
    color: COLORS.dark,
    marginLeft: 12,
    flex: 1,
  },
  actionsCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    borderRadius: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  actionButtonText: {
    fontSize: 16,
    color: COLORS.dark,
    marginLeft: 12,
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    padding: 32,
  },
  footerText: {
    fontSize: 16,
    color: COLORS.gray,
    marginBottom: 8,
  },
  footerSubtext: {
    fontSize: 14,
    color: COLORS.lightGray,
  },
});