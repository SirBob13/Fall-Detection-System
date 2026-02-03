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
          <Text className="text-2xl font-bold text-dark mb-2">
            {t('language.title')}
          </Text>
          <Text className="text-base text-gray text-center">
            {t('language.selectLanguage')}
          </Text>
        </View>

        <View className="mb-8">
          {languages.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              className={`
                bg-white rounded-xl p-5 mb-4 border-2
                ${selectedLang === lang.code 
                  ? 'border-primary bg-blue-50' 
                  : 'border-lightGray'
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
                    <Text className="text-lg font-semibold text-dark">
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
                  <Text className="text-xs text-gray">
                    {lang.description}
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

        <View className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <View className="flex-row items-start">
            <MaterialIcons name="info" size={20} color="#2196F3" className="mt-0.5" />
            <View className="ml-3 flex-1">
              <Text className="text-sm font-medium text-dark mb-1">
                {t('language.note')}
              </Text>
              <Text className="text-xs text-gray leading-5">
                {t('language.languageChangeInfo')}
              </Text>
            </View>
          </View>
        </View>

        <View className="bg-green-50 border border-green-200 rounded-xl p-4">
          <View className="flex-row items-start">
            <MaterialIcons name="translate" size={20} color="#4CAF50" className="mt-0.5" />
            <View className="ml-3 flex-1">
              <Text className="text-sm font-medium text-dark mb-1">
                {t('language.currentLanguage')}
              </Text>
              <Text className="text-xs text-gray leading-5">
                {language === 'ar' 
                  ? t('language.arabicSelected')
                  : t('language.englishSelected')
                }
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
};