import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLanguage } from '../components/LanguageProvider';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useNavigation } from '@react-navigation/native';

export const LanguageSettingsScreen: React.FC = () => {
  const { language, changeLanguage, t, isRTL, isChanging } = useLanguage();
  const navigation = useNavigation();
  const [selectedLang, setSelectedLang] = useState(language);

  const languages = [
    { 
      code: 'ar', 
      name: t('language.arabic'), 
      nativeName: 'العربية',
      flag: '🇸🇦', 
      direction: 'rtl',
      description: t('language.arabicDesc')
    },
    { 
      code: 'en', 
      name: t('language.english'), 
      nativeName: 'English',
      flag: '🇺🇸', 
      direction: 'ltr',
      description: t('language.englishDesc')
    },
  ];

  const handleLanguageSelect = async (langCode: 'ar' | 'en') => {
    if (langCode === language) return;

    setSelectedLang(langCode);
    const langName = langCode === 'ar' ? t('language.arabic') : t('language.english');
    
    Alert.alert(
      t('language.changeTitle'),
      t('language.changeMessage', { language: langName }),
      [
        { 
          text: t('common.cancel'), 
          style: 'cancel',
          onPress: () => setSelectedLang(language)
        },
        { 
          text: t('common.confirm'), 
          onPress: async () => {
            try {
              const success = await changeLanguage(langCode);
              
              if (success) {
                // لا نعيد تحميل الشاشة، التغيير فوري
                Alert.alert(
                  t('success.updated'),
                  t('language.successMessage'),
                  [
                    { 
                      text: t('common.ok'),
                      onPress: () => navigation.goBack()
                    }
                  ]
                );
              } else {
                Alert.alert(t('common.error'), t('errors.languageChangeFailed'));
                setSelectedLang(language);
              }
            } catch (error) {
              Alert.alert(t('common.error'), t('errors.unknown'));
              setSelectedLang(language);
            }
          }
        },
      ]
    );
  };

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View className="items-center mb-8">
          <View className="w-20 h-20 rounded-full bg-blue-50 justify-center items-center mb-4">
            <MaterialIcons name="language" size={40} color="#2196F3" />
          </View>
          <Text className="text-2xl font-bold text-dark dark:text-darkTheme-text mb-2">
            {t('language.title')}
          </Text>
          <Text className="text-base text-gray dark:text-darkTheme-muted text-center">
            {t('language.selectLanguage')}
          </Text>
        </View>

        <View className="mb-8">
          {languages.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              className={`
                bg-white dark:bg-darkTheme-surface rounded-xl p-5 mb-4 border-2
                ${selectedLang === lang.code 
                  ? 'border-primary bg-blue-50' 
                  : 'border-lightGray dark:border-darkTheme-border'
                }
                ${(isChanging || language === lang.code) ? 'opacity-60' : 'active:opacity-80'}
              `}
              onPress={() => handleLanguageSelect(lang.code as 'ar' | 'en')}
              disabled={isChanging}
              activeOpacity={0.7}
            >
              <View className="flex-row items-center">
                <View className="mr-4">
                  <Text className="text-4xl">{lang.flag}</Text>
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center justify-between mb-1">
                    <Text className="text-lg font-semibold text-dark dark:text-darkTheme-text">
                      {lang.name}
                    </Text>
                    {language === lang.code && (
                      <View className="flex-row items-center bg-primary/10 py-1 px-2 rounded-full">
                        <MaterialIcons name="check" size={14} color="#2196F3" />
                        <Text className="text-xs text-primary ml-1">
                          {t('common.current')}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-sm text-primary mb-2">
                    {lang.nativeName}
                  </Text>
                </View>
                <MaterialIcons 
                  name={language === lang.code ? "radio-button-checked" : "radio-button-unchecked"} 
                  size={24} 
                  color={language === lang.code ? "#2196F3" : "#BDBDBD"} 
                />
              </View>
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>
    </ScreenWrapper>
  );
};
