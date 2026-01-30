import React, { createContext, useContext, useEffect, useState } from 'react';
import { I18nManager, Platform, View, Text } from 'react-native';
import i18n from '../i18n';
import { changeLanguage, getCurrentLanguage, isArabic } from '../i18n';

interface LanguageContextType {
  language: string;
  isRTL: boolean;
  changeLanguage: (lng: 'ar' | 'en') => Promise<boolean>;
  t: (key: string, options?: any) => string;
  isChanging: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};

interface LanguageProviderProps {
  children: React.ReactNode;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const [language, setLanguage] = useState(getCurrentLanguage());
  const [isRTL, setIsRTL] = useState(isArabic());
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    const handleLanguageChange = () => {
      const currentLang = getCurrentLanguage();
      const currentIsRTL = isArabic();
      
      setLanguage(currentLang);
      setIsRTL(currentIsRTL);
      
      // Force RTL/LTR changes
      I18nManager.forceRTL(currentIsRTL);
      I18nManager.allowRTL(true);
      
      // For Android, swap left and right in RTL
      if (Platform.OS === 'android') {
        I18nManager.swapLeftAndRightInRTL(currentIsRTL);
      }
      
      console.log(`🌐 Language changed to: ${currentLang}, RTL: ${currentIsRTL}`);
      setIsChanging(false);
    };

    // Listen for language changes
    i18n.on('languageChanged', handleLanguageChange);
    
    // Initial setup
    handleLanguageChange();

    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  const handleChangeLanguage = async (lng: 'ar' | 'en'): Promise<boolean> => {
    setIsChanging(true);
    const success = await changeLanguage(lng);
    
    if (success) {
      setLanguage(lng);
      setIsRTL(lng === 'ar');
      setIsChanging(false);
    } else {
      setIsChanging(false);
    }
    
    return success;
  };

  const t = (key: string, options?: any): string => {
    return i18n.t(key, options);
  };

  return (
    <LanguageContext.Provider 
      value={{ 
        language, 
        isRTL, 
        changeLanguage: handleChangeLanguage,
        t,
        isChanging
      }}
    >
      <View 
        style={{ 
          flex: 1,
          direction: isRTL ? 'rtl' : 'ltr'
        }}
      >
        {children}
      </View>
    </LanguageContext.Provider>
  );
};