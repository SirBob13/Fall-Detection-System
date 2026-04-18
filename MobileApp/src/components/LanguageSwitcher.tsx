import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLanguage } from './LanguageProvider';
import { useNavigation } from '@react-navigation/native';

export const GlobalLanguageSwitcher: React.FC = () => {
  const { language, t, isChanging } = useLanguage();
  const navigation = useNavigation();

  const handlePress = () => {
    navigation.navigate('LanguageSettings' as never);
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      disabled={isChanging}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        <View style={styles.iconBackground}>
          <MaterialIcons 
            name="language" 
            size={22} 
            color="#2196F3" 
          />
        </View>
        
        <View style={styles.textContainer}>
          <Text style={styles.languageLabel}>
            {language === 'ar' ? t('language.english') : t('language.arabic')}
          </Text>
          <Text style={styles.currentLanguageHint}>
            {t('language.title')}: {language === 'ar' ? t('language.arabic') : t('language.english')}
          </Text>
        </View>

        <MaterialIcons 
          name="chevron-right" 
          size={24} 
          color="#BDBDBD" 
        />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF', // خلفية بيضاء صريحة
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    // ظل خفيف يتناسب مع الثيم الفاتح
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F0F0F0', // إطار خفيف جداً لتحديد العنصر
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBackground: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
  },
  languageLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#212121', // أسود ناعم بدلاً من الأزرق لسهولة القراءة
  },
  currentLanguageHint: {
    fontSize: 13,
    color: '#757575', // رمادي متوسط
    marginTop: 2,
  },
});