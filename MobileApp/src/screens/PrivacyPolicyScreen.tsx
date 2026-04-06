import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useLanguage } from '../components/LanguageProvider';

export const PrivacyPolicyScreen: React.FC = () => {
  const { t } = useLanguage();

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text className="text-2xl font-bold text-dark dark:text-darkTheme-text mb-2">
          {t('privacyPolicy.title')}
        </Text>
        <Text className="text-sm text-gray dark:text-darkTheme-muted mb-6">
          {t('privacyPolicy.updated')}
        </Text>

        <View className="mb-5">
          <Text className="text-lg font-semibold text-dark dark:text-darkTheme-text mb-2">
            {t('privacyPolicy.introTitle')}
          </Text>
          <Text className="text-sm text-gray dark:text-darkTheme-muted leading-5">
            {t('privacyPolicy.introBody')}
          </Text>
        </View>

        <View className="mb-5">
          <Text className="text-lg font-semibold text-dark dark:text-darkTheme-text mb-2">
            {t('privacyPolicy.collectTitle')}
          </Text>
          <Text className="text-sm text-gray dark:text-darkTheme-muted leading-5">
            {t('privacyPolicy.collectBody')}
          </Text>
        </View>

        <View className="mb-5">
          <Text className="text-lg font-semibold text-dark dark:text-darkTheme-text mb-2">
            {t('privacyPolicy.useTitle')}
          </Text>
          <Text className="text-sm text-gray dark:text-darkTheme-muted leading-5">
            {t('privacyPolicy.useBody')}
          </Text>
        </View>

        <View className="mb-5">
          <Text className="text-lg font-semibold text-dark dark:text-darkTheme-text mb-2">
            {t('privacyPolicy.shareTitle')}
          </Text>
          <Text className="text-sm text-gray dark:text-darkTheme-muted leading-5">
            {t('privacyPolicy.shareBody')}
          </Text>
        </View>

        <View className="mb-5">
          <Text className="text-lg font-semibold text-dark dark:text-darkTheme-text mb-2">
            {t('privacyPolicy.securityTitle')}
          </Text>
          <Text className="text-sm text-gray dark:text-darkTheme-muted leading-5">
            {t('privacyPolicy.securityBody')}
          </Text>
        </View>

        <View className="mb-5">
          <Text className="text-lg font-semibold text-dark dark:text-darkTheme-text mb-2">
            {t('privacyPolicy.rightsTitle')}
          </Text>
          <Text className="text-sm text-gray dark:text-darkTheme-muted leading-5">
            {t('privacyPolicy.rightsBody')}
          </Text>
        </View>

        <View className="mb-2">
          <Text className="text-lg font-semibold text-dark dark:text-darkTheme-text mb-2">
            {t('privacyPolicy.contactTitle')}
          </Text>
          <Text className="text-sm text-gray dark:text-darkTheme-muted leading-5">
            {t('privacyPolicy.contactBody')}
          </Text>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
};
