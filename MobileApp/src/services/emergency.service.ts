import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Linking, Alert, AppState } from 'react-native';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import * as Contacts from 'expo-contacts';
import * as Notifications from 'expo-notifications';
import { 
  EmergencyContact, 
  EmergencyMessage, 
  EmergencySettings,
  EmergencyResponse,
  EmergencyHistoryItem
} from './emergency.types';

// Import notification service if available
// import { notificationService } from './notification.service';

const EMERGENCY_STORAGE_KEYS = {
  CONTACTS: '@emergency_contacts',
  SETTINGS: '@emergency_settings',
  HISTORY: '@emergency_history',
  LAST_EMERGENCY: '@last_emergency_timestamp',
};

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export class EmergencyService {
  private static instance: EmergencyService;
  private isEmergencyActive = false;
  private emergencyTimeout: NodeJS.Timeout | null = null;
  private appStateSubscription: any = null;
  private emergencyInProgress = false;
  private readonly MAX_CONSECUTIVE_EMERGENCIES = 3;
  private readonly EMERGENCY_COOLDOWN_MINUTES = 15;

  static getInstance(): EmergencyService {
    if (!EmergencyService.instance) {
      EmergencyService.instance = new EmergencyService();
    }
    return EmergencyService.instance;
  }

  private getDefaultSettings(): EmergencySettings {
    return {
      auto_call_emergency: true,
      send_sms: true,
      send_location: true,
      call_after_fall: true,
      sos_countdown: 5,
      max_retries: 3,
      enable_vibration: true,
      enable_sound: true,
      notification_preview: 'show_all',
      emergency_numbers: {
        fire: '911',
      },
    };
  }

  // ==================== Settings Management ====================

  async getEmergencySettings(): Promise<EmergencySettings> {
    try {
      const settingsJson = await AsyncStorage.getItem(EMERGENCY_STORAGE_KEYS.SETTINGS);
      if (settingsJson) {
        return JSON.parse(settingsJson);
      }
      return this.getDefaultSettings();
    } catch (error) {
      console.error('❌ [Emergency] Error getting emergency settings:', error);
      return this.getDefaultSettings();
    }
  }

  async updateEmergencySettings(settings: Partial<EmergencySettings>): Promise<boolean> {
    try {
      console.log('⚙️ [Emergency] Updating settings:', settings);
      const currentSettings = await this.getEmergencySettings();
      const updatedSettings = { ...currentSettings, ...settings };
      await AsyncStorage.setItem(
        EMERGENCY_STORAGE_KEYS.SETTINGS,
        JSON.stringify(updatedSettings)
      );
      console.log('✅ [Emergency] Settings updated successfully');
      return true;
    } catch (error) {
      console.error('❌ [Emergency] Error updating emergency settings:', error);
      return false;
    }
  }

  // ==================== Contacts Management ====================

  async getEmergencyContacts(): Promise<EmergencyContact[]> {
    try {
      const contactsJson = await AsyncStorage.getItem(EMERGENCY_STORAGE_KEYS.CONTACTS);
      if (contactsJson) {
        return JSON.parse(contactsJson);
      }
      // Default emergency contacts
      return [];
    } catch (error) {
      console.error('❌ [Emergency] Error getting emergency contacts:', error);
      return [];
    }
  }

  async saveEmergencyContacts(contacts: EmergencyContact[]): Promise<boolean> {
    try {
      console.log('💾 [Emergency] Saving contacts:', contacts.length);
      await AsyncStorage.setItem(
        EMERGENCY_STORAGE_KEYS.CONTACTS,
        JSON.stringify(contacts)
      );
      console.log('✅ [Emergency] Contacts saved successfully');
      return true;
    } catch (error) {
      console.error('❌ [Emergency] Error saving emergency contacts:', error);
      return false;
    }
  }

  async addEmergencyContact(contact: Omit<EmergencyContact, 'id'>): Promise<string> {
    try {
      console.log('➕ [Emergency] Adding new contact:', contact.name);
      const contacts = await this.getEmergencyContacts();
      const newContact: EmergencyContact = {
        ...contact,
        id: Date.now().toString(),
      };
      contacts.push(newContact);
      await this.saveEmergencyContacts(contacts);
      console.log('✅ [Emergency] Contact added successfully:', newContact.id);
      return newContact.id;
    } catch (error) {
      console.error('❌ [Emergency] Error adding emergency contact:', error);
      throw error;
    }
  }

  async updateEmergencyContact(id: string, updates: Partial<EmergencyContact>): Promise<boolean> {
    try {
      const contacts = await this.getEmergencyContacts();
      const index = contacts.findIndex(c => c.id === id);
      
      if (index === -1) {
        console.warn(`⚠️ [Emergency] Contact not found: ${id}`);
        return false;
      }
      
      contacts[index] = { ...contacts[index], ...updates };
      await this.saveEmergencyContacts(contacts);
      console.log('✅ [Emergency] Contact updated successfully:', id);
      return true;
    } catch (error) {
      console.error('❌ [Emergency] Error updating contact:', error);
      return false;
    }
  }

  async removeEmergencyContact(id: string): Promise<boolean> {
    try {
      const contacts = await this.getEmergencyContacts();
      const filteredContacts = contacts.filter(c => c.id !== id);
      await this.saveEmergencyContacts(filteredContacts);
      console.log('✅ [Emergency] Contact removed successfully:', id);
      return true;
    } catch (error) {
      console.error('❌ [Emergency] Error removing contact:', error);
      return false;
    }
  }

  async importPhoneContacts(): Promise<{
    contacts: EmergencyContact[];
    permissionStatus: 'granted' | 'limited' | 'denied' | 'unknown';
  }> {
    try {
      console.log('📱 [Emergency] Importing phone contacts...');

      let permissionStatus: 'granted' | 'limited' | 'denied' | 'unknown' = 'unknown';

      const perm = await Contacts.getPermissionsAsync();
      let status = (perm as any).status;
      let access = (perm as any).accessPrivileges;
      let granted = (perm as any).granted === true || status === 'granted' || status === 'limited';

      if (!granted) {
        const req = await Contacts.requestPermissionsAsync();
        status = (req as any).status;
        access = (req as any).accessPrivileges;
        granted = (req as any).granted === true || status === 'granted' || status === 'limited';
      }

      const allowedByAccess = access === 'all' || access === 'limited';
      if (granted || allowedByAccess) {
        permissionStatus = access === 'limited' || status === 'limited' ? 'limited' : 'granted';
      }

      if (!granted && !allowedByAccess) {
        console.warn('⚠️ [Emergency] Contacts permission denied');
        permissionStatus = 'denied';
        return { contacts: [], permissionStatus };
      }

      const firstPage = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
        pageSize: 500,
        pageOffset: 0,
        sort: Contacts.SortTypes.FirstName,
      });

      let allContacts = firstPage.data || [];
      let pageOffset = allContacts.length;
      let hasNextPage = firstPage.hasNextPage === true;

      while (hasNextPage) {
        const page = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
          pageSize: 500,
          pageOffset,
          sort: Contacts.SortTypes.FirstName,
        });
        allContacts = allContacts.concat(page.data || []);
        hasNextPage = page.hasNextPage === true && (page.data?.length ?? 0) > 0;
        pageOffset += page.data?.length ?? 0;
      }

      console.log(`📱 [Emergency] Found ${allContacts.length} contacts`);

      const importedContacts: EmergencyContact[] = allContacts.map(contact => {
        const primaryNumber =
          contact.phoneNumbers?.find((item: any) => item?.isPrimary)?.number ||
          contact.phoneNumbers?.[0]?.number ||
          '';
        return {
          id: contact.id || `${Date.now()}-${Math.random()}`,
          name: contact.name || 'Contact',
          phone: primaryNumber,
          email: contact.emails?.[0]?.email || '',
          relationship: 'friend',
          priority: 3,
          is_active: false,
          notification_enabled: true,
          can_receive_location: true,
        };
      });

      console.log(`✅ [Emergency] Imported ${importedContacts.length} contacts`);
      return { contacts: importedContacts, permissionStatus };
    } catch (error) {
      console.error('❌ [Emergency] Error importing phone contacts:', error);
      return { contacts: [], permissionStatus: 'unknown' };
    }
  }

  // ==================== Emergency Trigger ====================

  async triggerEmergency(
    type: 'fall' | 'manual' | 'vital_abnormal' | 'inactivity',
    fallData?: any
  ): Promise<boolean> {
    try {
      // Check if emergency is already active
      if (this.isEmergencyActive || this.emergencyInProgress) {
        console.warn('⚠️ [Emergency] Emergency already active or in progress');
        return false;
      }

      // Check for consecutive emergencies (prevent abuse)
      const canTrigger = await this.canTriggerEmergency();
      if (!canTrigger) {
        console.warn('⚠️ [Emergency] Too many consecutive emergencies');
        this.showRateLimitWarning();
        return false;
      }

      this.emergencyInProgress = true;
      this.isEmergencyActive = true;
      
      console.log(`🚨 [Emergency] ${type.toUpperCase()} emergency triggered`);

      // Get settings and contacts
      const settings = await this.getEmergencySettings();
      const contacts = await this.getEmergencyContacts();
      const targetContacts = (type === 'manual' ? contacts : contacts.filter(c => c.is_active))
        .filter((contact) => contact.phone && contact.phone.trim().length > 0);

      if (targetContacts.length === 0) {
        Alert.alert(
          '⚠️ No Emergency Contacts',
          'Please add emergency contacts in settings before triggering an emergency.',
          [{ text: 'OK', style: 'default' }]
        );
        this.isEmergencyActive = false;
        this.emergencyInProgress = false;
        return false;
      }

      // Get current location if enabled
      let location = null;
      if (settings.send_location) {
        location = await this.getCurrentLocation();
      }

      // Create emergency message
      const emergencyMessage = this.createEmergencyMessage(type, location, fallData);
      
      // Process emergency notifications
      const effectiveSettings =
        type === 'manual'
          ? { ...settings, send_sms: true, auto_call_emergency: false }
          : settings;
      const responses = await this.processEmergencyNotifications(
        emergencyMessage,
        targetContacts,
        effectiveSettings
      );

      // Log the emergency
      await this.logEmergency(emergencyMessage, responses);

      // Update last emergency timestamp
      await this.updateLastEmergencyTimestamp();

      // Send push notifications to app contacts
      await this.sendPushNotificationToContacts(targetContacts, emergencyMessage);

      this.isEmergencyActive = false;
      this.emergencyInProgress = false;
      
      console.log('✅ [Emergency] Emergency processed successfully');
      return true;

    } catch (error) {
      console.error('❌ [Emergency] Error triggering emergency:', error);
      this.isEmergencyActive = false;
      this.emergencyInProgress = false;
      return false;
    }
  }

  private async canTriggerEmergency(): Promise<boolean> {
    try {
      const history = await this.getEmergencyHistory();
      const recentEmergencies = history.filter(entry => {
        const emergencyTime = new Date(entry.timestamp);
        const now = new Date();
        const minutesDiff = (now.getTime() - emergencyTime.getTime()) / (1000 * 60);
        return minutesDiff < this.EMERGENCY_COOLDOWN_MINUTES;
      });

      return recentEmergencies.length < this.MAX_CONSECUTIVE_EMERGENCIES;
    } catch (error) {
      console.warn('⚠️ [Emergency] Error checking emergency rate limit:', error);
      return true; // Allow emergency if check fails
    }
  }

  private showRateLimitWarning(): void {
    Alert.alert(
      '⚠️ Emergency Rate Limit',
      `Too many emergencies triggered recently. Please wait ${this.EMERGENCY_COOLDOWN_MINUTES} minutes before trying again.`,
      [{ text: 'OK', style: 'default' }]
    );
  }

  private async getCurrentLocation(): Promise<Location.LocationObject | null> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        console.warn('⚠️ [Emergency] Location permission not granted');
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
      });

      console.log('📍 [Emergency] Location obtained');
      return location;
    } catch (error) {
      console.warn('⚠️ [Emergency] Error getting location:', error);
      return null;
    }
  }

  private createEmergencyMessage(
    type: 'fall' | 'manual' | 'vital_abnormal' | 'inactivity',
    location: Location.LocationObject | null,
    fallData?: any
  ): EmergencyMessage {
    const now = new Date();
    const user = 'User'; // Replace with actual user name
    
    let message = '';
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    
    switch (type) {
      case 'fall':
        message = `🚨 EMERGENCY: ${user} may have fallen!`;
        severity = 'critical';
        if (fallData?.confidence) {
          message += ` Confidence: ${Math.round(fallData.confidence * 100)}%`;
        }
        break;
      case 'manual':
        message = `🆘 ${user} is requesting immediate help!`;
        severity = 'high';
        break;
      case 'vital_abnormal':
        message = `📊 ${user}: Abnormal vital signs detected!`;
        severity = 'high';
        break;
      case 'inactivity':
        message = `⏰ ${user}: No activity detected for extended period!`;
        severity = 'medium';
        break;
    }

    // Add location if available
    if (location) {
      const lat = location.coords.latitude.toFixed(6);
      const lon = location.coords.longitude.toFixed(6);
      message += `\n📍 Location: https://maps.google.com/?q=${lat},${lon}`;
    }

    message += `\n🕒 Time: ${now.toLocaleTimeString()}`;
    message += `\n📱 Sent from Fall Detection App`;

    return {
      id: Date.now().toString(),
      type,
      timestamp: now.toISOString(),
      location: location ? {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
      } : null,
      message,
      severity,
      sent_to: [],
      status: 'pending',
    };
  }

  private async processEmergencyNotifications(
    emergencyMessage: EmergencyMessage,
    contacts: EmergencyContact[],
    settings: EmergencySettings
  ): Promise<EmergencyResponse[]> {
    const responses: EmergencyResponse[] = [];
    
    console.log(`📨 [Emergency] Processing notifications for ${contacts.length} contacts`);

    // Group contacts by priority
    const highPriority = contacts.filter(c => c.priority === 1);
    const mediumPriority = contacts.filter(c => c.priority === 2);
    const lowPriority = contacts.filter(c => c.priority === 3);

    // Process in order of priority
    await this.processContactGroup(highPriority, emergencyMessage, settings, responses);
    await this.processContactGroup(mediumPriority, emergencyMessage, settings, responses);
    await this.processContactGroup(lowPriority, emergencyMessage, settings, responses);

    return responses;
  }

  private async processContactGroup(
    contacts: EmergencyContact[],
    emergencyMessage: EmergencyMessage,
    settings: EmergencySettings,
    responses: EmergencyResponse[]
  ): Promise<void> {
    for (const contact of contacts) {
      if (!contact.is_active) continue;

      try {
        let response: EmergencyResponse = {
          contact_id: contact.id,
          contact_name: contact.name,
          response_type: 'pending',
          timestamp: new Date().toISOString(),
          attempts: 1,
        };

        // Send SMS if enabled
        if (settings.send_sms) {
          const smsSent = await this.sendSMS(contact.phone, emergencyMessage.message);
          response.response_type = smsSent ? 'sms_sent' : 'sms_failed';
        }

        // Make phone call if enabled and high priority
        if (settings.auto_call_emergency && contact.priority === 1) {
          const callInitiated = await this.makeEmergencyCall(contact.phone);
          if (callInitiated) {
            response.response_type = response.response_type === 'sms_sent' 
              ? 'sms_and_call_sent' 
              : 'call_initiated';
          }
        }

        responses.push(response);
        console.log(`✅ [Emergency] Notification sent to ${contact.name}: ${response.response_type}`);

        // Track who the message was sent to
        emergencyMessage.sent_to.push(contact.id);

      } catch (error) {
        console.error(`❌ [Emergency] Error contacting ${contact.name}:`, error);
        responses.push({
          contact_id: contact.id,
          contact_name: contact.name,
          response_type: 'failed',
          timestamp: new Date().toISOString(),
          attempts: 1,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Small delay between contacts
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private async sendSMS(phoneNumber: string, message: string): Promise<boolean> {
    try {
      const isAvailable = await SMS.isAvailableAsync();
      if (!isAvailable) {
        console.warn('⚠️ [Emergency] SMS not available on this device');
        return false;
      }

      const { result } = await SMS.sendSMSAsync(
        [phoneNumber],
        message
      );

      console.log(`📱 [Emergency] SMS send result for ${phoneNumber}:`, result);
      return result === 'sent' || result === 'unknown';
    } catch (error) {
      console.error(`❌ [Emergency] Error sending SMS to ${phoneNumber}:`, error);
      return false;
    }
  }

  private async makeEmergencyCall(phoneNumber: string): Promise<boolean> {
    try {
      const url = `tel:${phoneNumber}`;
      const supported = await Linking.canOpenURL(url);
      
      if (supported) {
        await Linking.openURL(url);
        console.log(`📞 [Emergency] Call initiated to ${phoneNumber}`);
        return true;
      } else {
        console.warn(`⚠️ [Emergency] Cannot make calls to ${phoneNumber}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ [Emergency] Error making call to ${phoneNumber}:`, error);
      return false;
    }
  }

  private async sendPushNotificationToContacts(
    contacts: EmergencyContact[],
    emergencyMessage: EmergencyMessage
  ): Promise<void> {
    try {
      console.log('📲 [Emergency] Sending push notifications to app users...');
      
      // Filter contacts that have notification enabled
      const contactsWithNotifications = contacts.filter(c => c.notification_enabled);
      
      for (const contact of contactsWithNotifications) {
        try {
          // This would typically call your backend notification service
          await this.sendPushNotification(contact.id, emergencyMessage);
          console.log(`📲 [Emergency] Push notification sent to ${contact.name}`);
        } catch (error) {
          console.warn(`⚠️ [Emergency] Error sending push to ${contact.name}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ [Emergency] Error sending push notifications:', error);
    }
  }

  // ==================== Push Notification ====================

  async sendPushNotification(contactId: string, emergencyMessage: EmergencyMessage): Promise<boolean> {
    try {
      console.log(`📲 [Emergency] Sending push notification to contact ${contactId}`);
      
      // Local notification for demo purposes
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🚨 Emergency Alert',
          body: emergencyMessage.message,
          data: { 
            emergencyId: emergencyMessage.id,
            type: emergencyMessage.type,
            contactId: contactId 
          },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          vibrate: [0, 250, 250, 250],
        },
        trigger: null, // Send immediately
      });

      // In a real app, you would send to your backend service:
      // await notificationService.sendFallAlert({
      //   id: parseInt(emergencyMessage.id),
      //   user_id: 1, // Replace with actual user ID
      //   timestamp: emergencyMessage.timestamp,
      //   alert_type: emergencyMessage.type,
      //   severity: emergencyMessage.severity,
      //   message: emergencyMessage.message,
      //   status: 'sent',
      // });

      return true;
    } catch (error) {
      console.error('❌ [Emergency] Error sending push notification:', error);
      return false;
    }
  }

  // ==================== History Management ====================

  private async logEmergency(
    message: EmergencyMessage,
    responses: EmergencyResponse[]
  ): Promise<void> {
    try {
      const historyJson = await AsyncStorage.getItem(EMERGENCY_STORAGE_KEYS.HISTORY);
      const history = historyJson ? JSON.parse(historyJson) : [];
      
      // Determine overall status based on responses
      const hasSuccessfulResponse = responses.some(r => 
        r.response_type.includes('sent') || 
        r.response_type.includes('call') ||
        r.response_type === 'replied'
      );

      const logEntry: EmergencyHistoryItem = {
        ...message,
        responses,
        status: hasSuccessfulResponse ? 'sent' : 'failed',
        read: false,
      };

      history.unshift(logEntry);
      const limitedHistory = history.slice(0, 100); // Keep last 100 entries
      
      await AsyncStorage.setItem(
        EMERGENCY_STORAGE_KEYS.HISTORY,
        JSON.stringify(limitedHistory)
      );

      console.log('📝 [Emergency] Emergency logged to history:', logEntry.id);
    } catch (error) {
      console.error('❌ [Emergency] Error logging emergency:', error);
    }
  }

  async getEmergencyHistory(): Promise<EmergencyHistoryItem[]> {
    try {
      const historyJson = await AsyncStorage.getItem(EMERGENCY_STORAGE_KEYS.HISTORY);
      return historyJson ? JSON.parse(historyJson) : [];
    } catch (error) {
      console.error('❌ [Emergency] Error getting emergency history:', error);
      return [];
    }
  }

  async markHistoryAsRead(emergencyId: string): Promise<boolean> {
    try {
      const history = await this.getEmergencyHistory();
      const index = history.findIndex(entry => entry.id === emergencyId);
      
      if (index !== -1) {
        history[index].read = true;
        await AsyncStorage.setItem(
          EMERGENCY_STORAGE_KEYS.HISTORY,
          JSON.stringify(history)
        );
        console.log('✅ [Emergency] History item marked as read:', emergencyId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('❌ [Emergency] Error marking history as read:', error);
      return false;
    }
  }

  async clearEmergencyHistory(): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(EMERGENCY_STORAGE_KEYS.HISTORY);
      console.log('✅ [Emergency] History cleared');
      return true;
    } catch (error) {
      console.error('❌ [Emergency] Error clearing emergency history:', error);
      return false;
    }
  }

  private async updateLastEmergencyTimestamp(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        EMERGENCY_STORAGE_KEYS.LAST_EMERGENCY,
        Date.now().toString()
      );
    } catch (error) {
      console.warn('⚠️ [Emergency] Error updating last emergency timestamp:', error);
    }
  }

  // ==================== SOS Countdown ====================

  startSOSCountdown(onComplete: () => void, onCancel?: () => void): void {
    Alert.alert(
      '🆘 SOS Emergency Request',
      `Emergency help will be requested in 5 seconds...\n\nPress Cancel to stop the countdown.`,
      [
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: () => {
            if (this.emergencyTimeout) {
              clearTimeout(this.emergencyTimeout);
              this.emergencyTimeout = null;
            }
            onCancel?.();
            console.log('⏹️ [Emergency] SOS countdown cancelled');
          },
        },
      ]
    );

    console.log('⏱️ [Emergency] SOS countdown started (5 seconds)');
    
    this.emergencyTimeout = setTimeout(() => {
      console.log('✅ [Emergency] SOS countdown completed');
      onComplete();
      this.emergencyTimeout = null;
    }, 5000);
  }

  cancelSOSCountdown(): void {
    if (this.emergencyTimeout) {
      clearTimeout(this.emergencyTimeout);
      this.emergencyTimeout = null;
      console.log('⏹️ [Emergency] SOS countdown cancelled');
    }
  }

  // ==================== Test Emergency ====================

  async testEmergencySystem(): Promise<boolean> {
    try {
      console.log('🧪 [Emergency] Testing emergency system...');
      
      // Create test emergency
      const testEmergency: EmergencyMessage = {
        id: `test-${Date.now()}`,
        type: 'manual',
        timestamp: new Date().toISOString(),
        location: null,
        message: '⚠️ TEST EMERGENCY: This is a test of the emergency alert system.',
        severity: 'low',
        sent_to: ['test-contact'],
        status: 'test',
      };

      const testResponses: EmergencyResponse[] = [{
        contact_id: 'test-contact',
        contact_name: 'Test Contact',
        response_type: 'test_sent',
        timestamp: new Date().toISOString(),
        attempts: 1,
      }];

      // Log test emergency
      await this.logEmergency(testEmergency, testResponses);

      // Show test notification
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '✅ Test Successful',
          body: 'Emergency system test completed successfully',
          data: { test: true },
        },
        trigger: null,
      });

      console.log('✅ [Emergency] Test completed successfully');
      return true;
    } catch (error) {
      console.error('❌ [Emergency] Test failed:', error);
      return false;
    }
  }

  // ==================== Emergency Status ====================

  isEmergencyInProgress(): boolean {
    return this.emergencyInProgress;
  }

  getEmergencyStatus(): {
    isActive: boolean;
    lastEmergency?: string;
    contactsCount: number;
  } {
    return {
      isActive: this.isEmergencyActive,
      contactsCount: 0, // Will be populated from async call
    };
  }

  // ==================== Cleanup ====================

  cleanup(): void {
    this.cancelSOSCountdown();
    this.isEmergencyActive = false;
    this.emergencyInProgress = false;
    
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
    
    console.log('🧹 [Emergency] Service cleaned up');
  }
}

export const emergencyService = EmergencyService.getInstance();
