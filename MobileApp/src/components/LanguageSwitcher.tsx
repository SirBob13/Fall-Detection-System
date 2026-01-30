import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  View,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLanguage } from './LanguageProvider';
import { useNavigation } from '@react-navigation/native';

export const LanguageSwitcher: React.FC = () => {
  const { language, changeLanguage, t } = useLanguage();
  const navigation = useNavigation();
  const [isChanging, setIsChanging] = useState(false);

  const handleLanguageChange = () => {
    const newLang = language === 'ar' ? 'en' : 'ar';
    const langName = newLang === 'ar' ? t('language.arabic') : t('language.english');
    
    Alert.alert(
      t('language.changeTitle'),
      t('language.changeMessage', { language: langName }),
      [
        { 
          text: t('common.cancel'), 
          style: 'cancel' 
        },
        { 
          text: t('common.confirm'), 
          onPress: async () => {
            setIsChanging(true);
            const success = await changeLanguage(newLang as 'ar' | 'en');
            setIsChanging(false);
            
            if (success) {
              // على iOS، نعيد توجيه المستخدم للشاشة الرئيسية
              // على Android، نطلب إعادة فتح التطبيق
              if (Platform.OS === 'ios') {
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Home' }],
                });
              } else {
                Alert.alert(
                  t('language.changeTitle'),
                  t('language.restartMessage'),
                  [
                    { 
                      text: t('common.ok'),
                      style: 'default'
                    }
                  ]
                );
              }
            }
          }
        },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handleLanguageChange}
      disabled={isChanging}
    >
      <View style={styles.content}>
        <MaterialIcons 
          name="language" 
          size={24} 
          color="#2196F3" 
        />
        <View style={styles.textContainer}>
          <Text style={styles.languageName}>
            {language === 'ar' ? t('language.english') : t('language.arabic')}
          </Text>
          <Text style={styles.currentLanguage}>
            {t('language.title')}: {language === 'ar' ? t('language.arabic') : t('language.english')}
          </Text>
        </View>
        <MaterialIcons 
          name="arrow-forward-ios" 
          size={16} 
          color="#666" 
          style={styles.arrow}
        />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
  },
  languageName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  currentLanguage: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  arrow: {
    marginLeft: 8,
  },
});