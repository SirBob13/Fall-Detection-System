import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View } from 'react-native';
import i18n, { getCurrentLanguage, changeLanguage as i18nChangeLanguage } from '../i18n';

interface LanguageContextType {
  language: string;
  isRTL: boolean;
  t: (key: string, options?: any) => string;
  changeLanguage: (lang: string) => void;
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
  const [isRTL, setIsRTL] = useState(getCurrentLanguage() === 'ar');

  const changeLanguage = useCallback((lang: string) => {
    console.log(`🌐 Changing language to: ${lang}`);
    i18nChangeLanguage(lang);
  }, []);

  useEffect(() => {
    const handleLanguageChange = () => {
      const currentLang = getCurrentLanguage();
      
      setLanguage(currentLang);
      setIsRTL(currentLang === 'ar');
      
      console.log(`🌐 Language set to: ${currentLang}`);
    };

    // Listen for language changes
    i18n.on('languageChanged', handleLanguageChange);
    
    // Initial setup
    handleLanguageChange();

    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  const t = useCallback((key: string, options?: any): string => {
    return i18n.t(key, options);
  }, []);

  const contextValue: LanguageContextType = {
    language,
    isRTL,
    t,
    changeLanguage,
  };

  return (
    <LanguageContext.Provider value={contextValue}>
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
