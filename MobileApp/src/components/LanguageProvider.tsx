import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View } from 'react-native';
import i18n, { getCurrentLanguage, changeLanguage as i18nChangeLanguage } from '../i18n';

type AppLanguage = 'ar' | 'en';

interface LanguageContextType {
  language: AppLanguage;
  isRTL: boolean;
  isChanging: boolean;
  t: (key: string, options?: any) => string;
  changeLanguage: (lang: AppLanguage) => Promise<boolean>;
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
  const [language, setLanguage] = useState<AppLanguage>((getCurrentLanguage() as AppLanguage) || 'en');
  const [isRTL, setIsRTL] = useState(getCurrentLanguage() === 'ar');
  const [isChanging, setIsChanging] = useState(false);

  const changeLanguage = useCallback(async (lang: AppLanguage) => {
    console.log(`🌐 Changing language to: ${lang}`);
    setIsChanging(true);
    try {
      return await i18nChangeLanguage(lang);
    } finally {
      setIsChanging(false);
    }
  }, []);

  useEffect(() => {
    const handleLanguageChange = () => {
      const currentLang = (getCurrentLanguage() as AppLanguage) || 'en';
      
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
    return String(i18n.t(key, options));
  }, []);

  const contextValue: LanguageContextType = {
    language,
    isRTL,
    isChanging,
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
