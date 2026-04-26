import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useLanguage } from '../components/LanguageProvider';

export const PrivacyPolicyScreen: React.FC = () => {
  const { t } = useLanguage();

  return (
    <ScreenWrapper>
      {/* تم تثبيت الخلفية لتكون فاتحة دائماً في المكون الأب أو هنا */}
      <ScrollView 
        style={styles.container} 
        contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Section */}
        <Text style={styles.mainTitle}>
          {t('privacyPolicy.title')}
        </Text>
        <Text style={styles.updatedDate}>
          {t('privacyPolicy.updated')}
        </Text>

        <View style={styles.divider} />

        {/* Sections Wrapper */}
        <PolicySection 
          title={t('privacyPolicy.introTitle')} 
          body={t('privacyPolicy.introBody')} 
        />

        <PolicySection 
          title={t('privacyPolicy.collectTitle')} 
          body={t('privacyPolicy.collectBody')} 
        />

        <PolicySection 
          title={t('privacyPolicy.useTitle')} 
          body={t('privacyPolicy.useBody')} 
        />

        <PolicySection 
          title={t('privacyPolicy.shareTitle')} 
          body={t('privacyPolicy.shareBody')} 
        />

        <PolicySection 
          title={t('privacyPolicy.securityTitle')} 
          body={t('privacyPolicy.securityBody')} 
        />

        <PolicySection 
          title={t('privacyPolicy.rightsTitle')} 
          body={t('privacyPolicy.rightsBody')} 
        />

        <PolicySection 
          title={t('privacyPolicy.contactTitle')} 
          body={t('privacyPolicy.contactBody')} 
          isLast
        />

        {/* Footer info */}
        <View className="mt-8 items-center">
          <Text className="text-gray-400 text-xs">© 2026 {t('app.company')}</Text>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
};

// مكون فرعي للأقسام لتقليل تكرار الكود وضمان ثبات التنسيق
const PolicySection = ({ title, body, isLast }: { title: string, body: string, isLast?: boolean }) => (
  <View style={[styles.section, isLast && { borderBottomWidth: 0 }]}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <Text style={styles.sectionBody}>{body}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // خلفية بيضاء صريحة
  },
  mainTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827', // أسود داكن جداً
    marginBottom: 8,
  },
  updatedDate: {
    fontSize: 13,
    color: '#6B7280', // رمادي متوسط
    marginBottom: 20,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB', // فواصل ناعمة جداً
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 10,
  },
  sectionBody: {
    fontSize: 15,
    color: '#4B5563', // لون مريح للقراءة الطويلة
    lineHeight: 24, // زيادة المسافة بين الأسطر لراحة العين
    textAlign: 'left', // يعتمد على اللغة، يفضل تركه تلقائي
  }
});
