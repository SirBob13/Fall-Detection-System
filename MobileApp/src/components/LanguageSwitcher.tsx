import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLanguage } from './LanguageProvider';
import { useNavigation } from '@react-navigation/native';

export const GlobalLanguageSwitcher: React.FC = () => {
  const { language, changeLanguage, t, isChanging } = useLanguage();
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(false);

  const handlePress = () => {
    navigation.navigate('LanguageSettings' as never);
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      disabled={isLoading || isChanging}
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
          name="chevron-right" 
          size={20} 
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