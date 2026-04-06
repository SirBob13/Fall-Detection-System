import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useLanguage } from '../components/LanguageProvider';
import { authService } from '../services/auth.service';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { User } from '../types';
import { transliterateArabic } from '../utils/transliteration';
import { realtimeService } from '../services/realtime.service';

const ARABIC_DIGITS_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

const EASTERN_ARABIC_DIGITS_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

const normalizeToEnglishDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS_MAP[digit] ?? digit)
    .replace(/[۰-۹]/g, (digit) => EASTERN_ARABIC_DIGITS_MAP[digit] ?? digit);

const normalizeTextInput = (value: string): string =>
  normalizeToEnglishDigits(transliterateArabic(value));

const normalizeNumericInput = (value: string): string =>
  normalizeToEnglishDigits(value).replace(/[^0-9]/g, '');

const normalizePhoneInput = (value: string): string => {
  let normalized = normalizeToEnglishDigits(value).replace(/[^\d+]/g, '');
  if (normalized.includes('+')) {
    normalized = normalized.replace(/(?!^)\+/g, '');
  }
  return normalized;
};

const validateEgyptianPhone = (phone: string): boolean => {
  if (!phone) return false;
  const normalized = normalizePhoneInput(phone);
  const phoneRegex = /^(?:\+20|0)?1[0125]\d{8}$/;
  return phoneRegex.test(normalized);
};

export const PersonalInfoScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const isOnboarding = route?.params?.mode === 'onboarding';
  const [user, setUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    age: '',
    gender: '' as User['gender'] | '',
    weight: '',
    height: '',
    emergency_contact: '',
    medical_conditions: '',
  });

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (!isOnboarding) return;
    const listener = navigation.addListener('beforeRemove', (e: any) => {
      if (e?.data?.action?.type === 'GO_BACK') {
        e.preventDefault();
      }
    });
    return () => listener?.();
  }, [isOnboarding, navigation]);

  const loadUser = async () => {
    const sessionUser = await authService.getCurrentUser();
    const normalizedSessionUser = sessionUser
      ? ({
          id: Number(sessionUser.id ?? 0),
          name: sessionUser.name || '',
          phone: sessionUser.phone || '',
          age: sessionUser.age ?? 0,
          gender: (sessionUser.gender as User['gender']) || 'other',
          weight: sessionUser.weight,
          height: sessionUser.height,
          medical_conditions: sessionUser.medical_conditions,
          emergency_contact: sessionUser.emergency_contact,
          is_active: sessionUser.is_active ?? true,
          created_at: sessionUser.created_at || new Date().toISOString(),
        } as User)
      : null;

    const storedUser = normalizedSessionUser || (await storageService.getUser());
    if (normalizedSessionUser) {
      await storageService.saveUser(normalizedSessionUser);
    }

    if (storedUser) {
      setUser(storedUser);
      setForm({
        name: storedUser.name || '',
        phone: storedUser.phone || '',
        age: storedUser.age ? String(storedUser.age) : '',
        gender: storedUser.gender || '',
        weight: storedUser.weight ? String(storedUser.weight) : '',
        height: storedUser.height ? String(storedUser.height) : '',
        emergency_contact: storedUser.emergency_contact || '',
        medical_conditions: storedUser.medical_conditions || '',
      });
    }
  };

  useEffect(() => {
    if (isOnboarding) return;
    const unsubscribe = realtimeService.subscribe('profile', (event) => {
      if (!event.payload) return;
      setUser((prev) => {
        if (!prev) return prev;
        if (event.payload?.id !== prev.id) return prev;
        const next = { ...prev, ...event.payload };
        setForm({
          name: next.name || '',
          phone: next.phone || '',
          age: next.age ? String(next.age) : '',
          gender: next.gender || '',
          weight: next.weight ? String(next.weight) : '',
          height: next.height ? String(next.height) : '',
          emergency_contact: next.emergency_contact || '',
          medical_conditions: next.medical_conditions || '',
        });
        return next;
      });
    });

    return unsubscribe;
  }, [isOnboarding]);

  const handleSave = async () => {
    if (!user) return;

    const normalized = {
      name: normalizeTextInput(form.name).trim(),
      phone: normalizePhoneInput(form.phone || ''),
      age: form.age ? Number(normalizeNumericInput(form.age)) : undefined,
      gender: form.gender || undefined,
      weight: form.weight ? Number(normalizeNumericInput(form.weight)) : undefined,
      height: form.height ? Number(normalizeNumericInput(form.height)) : undefined,
      emergency_contact: normalizePhoneInput(form.emergency_contact || ''),
      medical_conditions: normalizeTextInput(form.medical_conditions || '').trim(),
    };

    if (isOnboarding) {
      const missing: string[] = [];
      if (!normalized.name) missing.push('name');
      if (!normalized.phone || !validateEgyptianPhone(normalized.phone)) missing.push('phone');
      if (!normalized.age || normalized.age < 18) missing.push('age');
      if (normalized.gender !== 'male' && normalized.gender !== 'female') missing.push('gender');

      if (missing.length > 0) {
        Alert.alert(t('common.warning'), t('auth.completeProfile.required'));
        return;
      }
    }

    setSaving(true);
    try {
      const response = await apiService.updateUser(user.id, normalized);
      if (response.success && response.data) {
        setUser(response.data);
        await storageService.saveUser(response.data);
        await authService.updateCurrentUser({
          ...response.data,
          id: String(response.data.id),
        });
        if (isOnboarding) {
          navigation.reset({
            index: 0,
            routes: [{ name: 'MainTabs' as never }],
          });
        } else {
          Alert.alert(t('success.updated'), t('success.saved'), [
            {
              text: t('common.ok'),
              onPress: () => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                }
              },
            },
          ]);
        }
      } else {
        Alert.alert(t('common.error'), response.message || t('errors.unknown'));
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('errors.unknown'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-light dark:bg-darkTheme-background" contentContainerStyle={{ padding: 16 }}>
      <View className="card mb-4">
        <Text className="section-title mb-1">
          {isOnboarding ? t('auth.completeProfile.title') : t('settings.personalInfo')}
        </Text>
        {isOnboarding ? (
          <Text className="text-sm text-gray dark:text-darkTheme-muted-500 mb-4">{t('auth.completeProfile.subtitle')}</Text>
        ) : (
          <View className="mb-4" />
        )}

        <View className="mb-4">
          <Text className="input-label">{t('auth.register.name')}</Text>
          <TextInput
            className="input-field"
            value={form.name}
            onChangeText={(text) => setForm({ ...form, name: normalizeTextInput(text) })}
            placeholder={t('auth.register.name')}
            placeholderTextColor="#BDBDBD"
          />
        </View>

        <View className="mb-4">
          <Text className="input-label">{t('auth.register.phone')}</Text>
          <TextInput
            className="input-field"
            value={form.phone}
            onChangeText={(text) => setForm({ ...form, phone: normalizePhoneInput(text) })}
            placeholder="+201234567890"
            placeholderTextColor="#BDBDBD"
            keyboardType="phone-pad"
          />
        </View>

        <View className="mb-4">
          <Text className="input-label">{t('settings.age')}</Text>
          <TextInput
            className="input-field"
            value={form.age}
            onChangeText={(text) => setForm({ ...form, age: normalizeNumericInput(text) })}
            placeholder="30"
            placeholderTextColor="#BDBDBD"
            keyboardType="number-pad"
            maxLength={3}
          />
        </View>

        <View className="mb-4">
          <Text className="input-label">{t('settings.gender')}</Text>
          <View className="flex-row">
            {(['male', 'female'] as const).map((gender) => (
              <TouchableOpacity
                key={gender}
                className={`flex-1 flex-row items-center justify-center py-3 mx-1 rounded-lg border ${
                  form.gender === gender ? 'bg-primary border-primary' : 'bg-white dark:bg-darkTheme-surface border-lightGray dark:border-darkTheme-border'
                }`}
                onPress={() => setForm({ ...form, gender })}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={gender === 'male' ? 'gender-male' : 'gender-female'}
                  size={18}
                  color={form.gender === gender ? '#FFFFFF' : '#757575'}
                />
                <Text className={`ml-2 text-sm font-medium ${
                  form.gender === gender ? 'text-white' : 'text-dark dark:text-darkTheme-text'
                }`}>
                  {gender === 'male' ? t('common.male') : t('common.female')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="flex-row mb-4">
          <View className="flex-1 mr-2">
            <Text className="input-label">{t('settings.height')}</Text>
            <TextInput
              className="input-field"
              value={form.height}
              onChangeText={(text) => setForm({ ...form, height: normalizeNumericInput(text) })}
              placeholder="170"
              placeholderTextColor="#BDBDBD"
              keyboardType="numeric"
            />
          </View>
          <View className="flex-1 ml-2">
            <Text className="input-label">{t('settings.weight')}</Text>
            <TextInput
              className="input-field"
              value={form.weight}
              onChangeText={(text) => setForm({ ...form, weight: normalizeNumericInput(text) })}
              placeholder="70"
              placeholderTextColor="#BDBDBD"
              keyboardType="numeric"
            />
          </View>
        </View>

        <View className="mb-4">
          <Text className="input-label">{t('settings.emergencyContact')}</Text>
          <TextInput
            className="input-field"
            value={form.emergency_contact}
            onChangeText={(text) => setForm({ ...form, emergency_contact: normalizePhoneInput(text) })}
            placeholder="+201234567890"
            placeholderTextColor="#BDBDBD"
            keyboardType="phone-pad"
          />
        </View>

        <View className="mb-2">
          <Text className="input-label">{t('settings.medicalConditions')}</Text>
          <TextInput
            className="input-field h-24 text-align-top"
            value={form.medical_conditions}
            onChangeText={(text) => setForm({ ...form, medical_conditions: normalizeTextInput(text) })}
            placeholder={t('settings.medicalConditionsPlaceholder')}
            placeholderTextColor="#BDBDBD"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>
      </View>

      <TouchableOpacity
        className={`btn-primary py-4 items-center ${saving ? 'opacity-60' : ''}`}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.7}
      >
        <Text className="text-white font-bold text-lg">{t('common.save')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default PersonalInfoScreen;
