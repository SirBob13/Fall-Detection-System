import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Linking, Alert } from 'react-native';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import * as Contacts from 'expo-contacts';
import { 
  EmergencyContact, 
  EmergencyMessage, 
  EmergencySettings,
  EmergencyResponse 
} from './emergency.types';

const EMERGENCY_STORAGE_KEYS = {
  CONTACTS: '@emergency_contacts',
  SETTINGS: '@emergency_settings',
  HISTORY: '@emergency_history',
};

export class EmergencyService {
  private static instance: EmergencyService;
  private isEmergencyActive = false;
  private emergencyTimeout: NodeJS.Timeout | null = null;

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
    };
  }

  async getEmergencySettings(): Promise<EmergencySettings> {
    try {
      const settingsJson = await AsyncStorage.getItem(EMERGENCY_STORAGE_KEYS.SETTINGS);
      if (settingsJson) {
        return JSON.parse(settingsJson);
      }
      return this.getDefaultSettings();
    } catch (error) {
      console.error('Error getting emergency settings:', error);
      return this.getDefaultSettings();
    }
  }

  async updateEmergencySettings(settings: Partial<EmergencySettings>): Promise<boolean> {
    try {
      const currentSettings = await this.getEmergencySettings();
      const updatedSettings = { ...currentSettings, ...settings };
      await AsyncStorage.setItem(
        EMERGENCY_STORAGE_KEYS.SETTINGS,
        JSON.stringify(updatedSettings)
      );
      return true;
    } catch (error) {
      console.error('Error updating emergency settings:', error);
      return false;
    }
  }

  async getEmergencyContacts(): Promise<EmergencyContact[]> {
    try {
      const contactsJson = await AsyncStorage.getItem(EMERGENCY_STORAGE_KEYS.CONTACTS);
      if (contactsJson) {
        return JSON.parse(contactsJson);
      }
      return [
        {
          id: '1',
          name: 'الإسعاف',
          phone: '123',
          relationship: 'emergency',
          priority: 1,
          is_active: true,
        },
        {
          id: '2',
          name: 'الشرطة',
          phone: '122',
          relationship: 'emergency',
          priority: 1,
          is_active: true,
        },
      ];
    } catch (error) {
      console.error('Error getting emergency contacts:', error);
      return [];
    }
  }

  async saveEmergencyContacts(contacts: EmergencyContact[]): Promise<boolean> {
    try {
      await AsyncStorage.setItem(
        EMERGENCY_STORAGE_KEYS.CONTACTS,
        JSON.stringify(contacts)
      );
      return true;
    } catch (error) {
      console.error('Error saving emergency contacts:', error);
      return false;
    }
  }

  async addEmergencyContact(contact: Omit<EmergencyContact, 'id'>): Promise<string> {
    try {
      const contacts = await this.getEmergencyContacts();
      const newContact: EmergencyContact = {
        ...contact,
        id: Date.now().toString(),
      };
      contacts.push(newContact);
      await this.saveEmergencyContacts(contacts);
      return newContact.id;
    } catch (error) {
      console.error('Error adding emergency contact:', error);
      throw error;
    }
  }

  async importPhoneContacts(): Promise<EmergencyContact[]> {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Contacts permission denied');
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });

      const importedContacts: EmergencyContact[] = data
        .filter(contact => contact.phoneNumbers && contact.phoneNumbers.length > 0)
        .slice(0, 20)
        .map(contact => ({
          id: contact.id || Date.now().toString(),
          name: contact.name || 'جهة اتصال',
          phone: contact.phoneNumbers![0].number || '',
          relationship: 'friend',
          priority: 3,
          is_active: false,
        }));

      return importedContacts;
    } catch (error) {
      console.error('Error importing phone contacts:', error);
      return [];
    }
  }

  async triggerEmergency(
    type: 'fall' | 'manual' | 'vital_abnormal',
    fallData?: any
  ): Promise<boolean> {
    try {
      if (this.isEmergencyActive) {
        console.log('Emergency already active');
        return false;
      }

      this.isEmergencyActive = true;
      
      // محاكاة العملية
      console.log(`🚨 Emergency triggered: ${type}`);
      
      // الحصول على الإعدادات
      const settings = await this.getEmergencySettings();
      
      // الحصول على جهات الاتصال
      const contacts = await this.getEmergencyContacts();
      const activeContacts = contacts.filter(c => c.is_active);
      
      if (activeContacts.length === 0) {
        Alert.alert('⚠️ تحذير', 'لا توجد جهات اتصال طارئة');
        this.isEmergencyActive = false;
        return false;
      }

      // إنشاء رسالة الطوارئ
      const emergencyMessage = this.createEmergencyMessage(type, null, fallData);
      
      // تسجيل العملية
      await this.logEmergency(emergencyMessage, []);

      // محاكاة إرسال الإشعارات
      if (settings.send_sms) {
        console.log('📱 Simulating SMS sending...');
      }

      // محاكاة الاتصال الهاتفي
      if (settings.auto_call_emergency) {
        console.log('📞 Simulating emergency calls...');
      }

      this.isEmergencyActive = false;
      return true;

    } catch (error) {
      console.error('Error triggering emergency:', error);
      this.isEmergencyActive = false;
      return false;
    }
  }

  private createEmergencyMessage(
    type: 'fall' | 'manual' | 'vital_abnormal',
    location: any,
    fallData?: any
  ): EmergencyMessage {
    const now = new Date();
    const user = 'المستخدم';
    
    let message = '';
    switch (type) {
      case 'fall':
        message = `🚨 حالة طارئة: ${user} تعرض للسقوط!`;
        if (fallData?.confidence) {
          message += ` الثقة: ${Math.round(fallData.confidence * 100)}%`;
        }
        break;
      case 'manual':
        message = `🆘 ${user} يطلب المساعدة العاجلة!`;
        break;
      case 'vital_abnormal':
        message = `📊 ${user}: مؤشرات حيوية غير طبيعية!`;
        break;
    }

    message += `\n🕒 الوقت: ${now.toLocaleTimeString('ar-EG')}`;
    message += `\n📱 تم الإرسال من تطبيق كشف السقوط`;

    return {
      id: Date.now().toString(),
      type,
      timestamp: now.toISOString(),
      location,
      message,
      sent_to: [],
      status: 'pending',
    };
  }

  private async logEmergency(
    message: EmergencyMessage,
    responses: EmergencyResponse[]
  ): Promise<void> {
    try {
      const historyJson = await AsyncStorage.getItem(EMERGENCY_STORAGE_KEYS.HISTORY);
      const history = historyJson ? JSON.parse(historyJson) : [];
      
      const logEntry = {
        ...message,
        responses,
        status: responses.some(r => r.response_type === 'replied') ? 'sent' : 'failed',
      };

      history.unshift(logEntry);
      const limitedHistory = history.slice(0, 50);
      
      await AsyncStorage.setItem(
        EMERGENCY_STORAGE_KEYS.HISTORY,
        JSON.stringify(limitedHistory)
      );

    } catch (error) {
      console.error('Error logging emergency:', error);
    }
  }

  async getEmergencyHistory(): Promise<any[]> {
    try {
      const historyJson = await AsyncStorage.getItem(EMERGENCY_STORAGE_KEYS.HISTORY);
      return historyJson ? JSON.parse(historyJson) : [];
    } catch (error) {
      console.error('Error getting emergency history:', error);
      return [];
    }
  }

  async clearEmergencyHistory(): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(EMERGENCY_STORAGE_KEYS.HISTORY);
      return true;
    } catch (error) {
      console.error('Error clearing emergency history:', error);
      return false;
    }
  }

  startSOSCountdown(onComplete: () => void): void {
    Alert.alert(
      '🆘 طلب مساعدة عاجل',
      `سيتم إرسال طلب المساعدة خلال 5 ثواني...\n\nاضغط إلغاء لإيقاف العد التنازلي.`,
      [
        {
          text: 'إلغاء',
          style: 'destructive',
          onPress: () => {
            if (this.emergencyTimeout) {
              clearTimeout(this.emergencyTimeout);
              this.emergencyTimeout = null;
            }
          },
        },
      ]
    );

    this.emergencyTimeout = setTimeout(() => {
      onComplete();
      this.emergencyTimeout = null;
    }, 5000);
  }

  cancelSOSCountdown(): void {
    if (this.emergencyTimeout) {
      clearTimeout(this.emergencyTimeout);
      this.emergencyTimeout = null;
    }
  }
}

export const emergencyService = EmergencyService.getInstance();