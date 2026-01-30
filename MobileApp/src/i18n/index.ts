import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager, Platform } from 'react-native';

// استيراد ملفات الترجمة
import arTranslations from './locales/ar';
import enTranslations from './locales/en';

// مفتاح التخزين المحلي للغة
const LANGUAGE_STORAGE_KEY = '@FallDetection:language';

// دالة للحصول على اللغة المحفوظة
export const getSavedLanguage = async (): Promise<string> => {
  try {
    const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (savedLanguage) return savedLanguage;
    
    // إذا لم تكن هناك لغة محفوظة، استخدم لغة الجهاز
    try {
      // التحقق من وجود Localization.locale
      if (!Localization.locale) {
        console.warn('Localization.locale is undefined, using default language');
        return 'ar';
      }
      
      const deviceLanguage = Localization.locale.split('-')[0];
      const isRTL = Localization.isRTL;
      
      return isRTL ? 'ar' : 'en';
    } catch (localeError) {
      console.warn('Error getting device locale, using default:', localeError);
      return 'ar';
    }
  } catch (error) {
    console.error('Error getting saved language:', error);
    return 'ar';
  }
};

// تهيئة i18n
export const initI18n = async (platform?: any) => {
  try {
    const lng = await getSavedLanguage();
    
    // استخدام platform إذا تم تمريره
    const currentPlatform = platform || Platform;
    
    // ضبط اتجاه النص
    I18nManager.forceRTL(lng === 'ar');
    I18nManager.allowRTL(true);
    
    // For Android، تغيير اتجاه اليسار واليمين في RTL
    if (currentPlatform.OS === 'android') {
      I18nManager.swapLeftAndRightInRTL(lng === 'ar');
    }
    
    await i18n
      .use(initReactI18next)
      .init({
        resources: {
          ar: { translation: arTranslations },
          en: { translation: enTranslations },
        },
        lng,
        fallbackLng: 'ar',
        interpolation: {
          escapeValue: false,
        },
        compatibilityJSON: 'v3',
        react: {
          useSuspense: false,
        },
      });
    
    console.log(`🌐 i18n initialized with language: ${lng}`);
    return i18n;
  } catch (error) {
    console.error('Error initializing i18n:', error);
    
    // استخدام الإعدادات الافتراضية في حالة الخطأ
    await i18n
      .use(initReactI18next)
      .init({
        resources: {
          ar: { translation: arTranslations },
          en: { translation: enTranslations },
        },
        lng: 'ar',
        fallbackLng: 'ar',
        interpolation: {
          escapeValue: false,
        },
        compatibilityJSON: 'v3',
        react: {
          useSuspense: false,
        },
      });
    
    return i18n;
  }
};

// دالة لتغيير اللغة
export const changeLanguage = async (lng: 'ar' | 'en'): Promise<boolean> => {
  try {
    await i18n.changeLanguage(lng);
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
    
    // تغيير اتجاه النص
    I18nManager.forceRTL(lng === 'ar');
    
    // For Android، تغيير اتجاه اليسار واليمين في RTL
    if (Platform.OS === 'android') {
      I18nManager.swapLeftAndRightInRTL(lng === 'ar');
    }
    
    console.log(`🌐 Language changed to: ${lng}`);
    return true;
  } catch (error) {
    console.error('Error changing language:', error);
    return false;
  }
};

// الحصول على اللغة الحالية
export const getCurrentLanguage = (): string => {
  return i18n.language || 'ar';
};

// التحقق إذا كانت اللغة العربية
export const isArabic = (): boolean => {
  return (i18n.language || 'ar') === 'ar';
};

// دالة للحصول على اتجاه النص
export const getTextDirection = (): 'rtl' | 'ltr' => {
  return isArabic() ? 'rtl' : 'ltr';
};

export default i18n;