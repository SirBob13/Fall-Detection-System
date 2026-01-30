import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLanguage } from '../components/LanguageProvider';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { COLORS } from '../utils/constants';
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
      description: t('language.arabic')
    },
    { 
      code: 'en', 
      name: t('language.english'), 
      nativeName: 'English',
      flag: '🇺🇸', 
      direction: 'ltr',
      description: t('language.english')
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
                Alert.alert(
                  t('success.updated'),
                  t('language.restartMessage'),
                  [
                    { 
                      text: t('common.ok'),
                      onPress: () => navigation.goBack()
                    }
                  ]
                );
              } else {
                Alert.alert(t('common.error'), t('errors.unknown'));
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
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <MaterialIcons name="language" size={60} color={COLORS.primary} />
          <Text style={styles.title}>{t('language.title')}</Text>
          <Text style={styles.subtitle}>
            {t('language.selectLanguage')}
          </Text>
        </View>

        <View style={styles.languagesList}>
          {languages.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={[
                styles.languageItem,
                selectedLang === lang.code && styles.languageItemActive,
                isChanging && styles.languageItemDisabled,
              ]}
              onPress={() => handleLanguageSelect(lang.code as 'ar' | 'en')}
              disabled={isChanging || language === lang.code}
            >
              <View style={styles.languageContent}>
                <Text style={styles.flag}>{lang.flag}</Text>
                <View style={styles.languageInfo}>
                  <Text style={styles.languageName}>{lang.name}</Text>
                  <Text style={styles.languageNativeName}>{lang.nativeName}</Text>
                  <Text style={styles.languageDirection}>
                    {lang.direction === 'rtl' ? '← ' + lang.description : lang.description + ' →'}
                  </Text>
                </View>
                {language === lang.code ? (
                  <MaterialIcons 
                    name="check-circle" 
                    size={24} 
                    color={COLORS.primary} 
                  />
                ) : (
                  <MaterialIcons 
                    name="radio-button-unchecked" 
                    size={24} 
                    color={COLORS.gray} 
                  />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.infoCard}>
          <MaterialIcons name="info" size={24} color={COLORS.info} />
          <Text style={styles.infoText}>
            {t('language.restartMessage')}
          </Text>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginTop: 20,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: 'center',
  },
  languagesList: {
    marginBottom: 30,
  },
  languageItem: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
  },
  languageItemActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(33, 150, 243, 0.05)',
  },
  languageItemDisabled: {
    opacity: 0.5,
  },
  languageContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flag: {
    fontSize: 30,
    marginRight: 15,
  },
  languageInfo: {
    flex: 1,
  },
  languageName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: 2,
  },
  languageNativeName: {
    fontSize: 14,
    color: COLORS.primary,
    marginBottom: 4,
  },
  languageDirection: {
    fontSize: 12,
    color: COLORS.gray,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    borderColor: COLORS.info,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.dark,
    marginLeft: 12,
    lineHeight: 20,
  },
});