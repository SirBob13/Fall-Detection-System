import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, StyleSheet, ActivityIndicator, Keyboard, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, InputAccessoryView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useLanguage } from '../components/LanguageProvider';
import { authService } from '../services/auth.service';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { User } from '../types';
import { transliterateArabic } from '../utils/transliteration';
import { realtimeService } from '../services/realtime.service';
import type { SettingsStackParamList } from '../navigation/AppNavigator';

// دالة التطبيع لتحويل الأرقام العربية إلى إنجليزية
const normalizeToEnglishDigits = (value: string): string =>
  value.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
       .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d).toString());

const normalizeTextInput = (value: string): string => normalizeToEnglishDigits(transliterateArabic(value));
const normalizeNumericInput = (value: string): string => normalizeToEnglishDigits(value).replace(/[^0-9]/g, '');
const normalizePhoneInput = (value: string): string => {
  let normalized = normalizeToEnglishDigits(value).replace(/[^\d+]/g, '');
  if (normalized.includes('+')) normalized = normalized.replace(/(?!^)\+/g, '');
  return normalized;
};

const IOS_KEYBOARD_ACCESSORY_ID = 'personal-info-keyboard-accessory';

export const PersonalInfoScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const route = useRoute<any>();
  const isOnboarding = route?.params?.mode === 'onboarding';
  
  const [user, setUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', age: '', gender: '' as User['gender'] | '',
    weight: '', height: '', emergency_contact: '', medical_conditions: '',
  });

  useEffect(() => { loadUser(); }, []);

  const loadUser = async () => {
    const sessionUser = await authService.getCurrentUser();
    const storedUser = sessionUser || (await storageService.getUser());
    if (storedUser) {
      setUser(storedUser as User);
      setForm({
        name: storedUser.name || '',
        phone: (storedUser as User).phone || '',
        age: storedUser.age ? String(storedUser.age) : '',
        gender: (storedUser as User).gender || '',
        weight: storedUser.weight ? String(storedUser.weight) : '',
        height: storedUser.height ? String(storedUser.height) : '',
        emergency_contact: (storedUser as User).emergency_contact || '',
        medical_conditions: (storedUser as User).medical_conditions || '',
      });
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload: Partial<User> = {
        name: form.name,
        phone: form.phone || undefined,
        age: form.age ? Number(form.age) : undefined,
        gender: form.gender || undefined,
        height: form.height ? Number(form.height) : undefined,
        weight: form.weight ? Number(form.weight) : undefined,
        emergency_contact: form.emergency_contact || undefined,
        medical_conditions: form.medical_conditions || undefined,
      };
      const response = await apiService.updateUser(user.id, payload);
      if (response.success && response.data) {
        const updatedUser = response.data;
        setUser(updatedUser);

        setForm({
          name: updatedUser.name || '',
          phone: updatedUser.phone || '',
          age: updatedUser.age ? String(updatedUser.age) : '',
          gender: updatedUser.gender || '',
          weight: updatedUser.weight ? String(updatedUser.weight) : '',
          height: updatedUser.height ? String(updatedUser.height) : '',
          emergency_contact: updatedUser.emergency_contact || '',
          medical_conditions: updatedUser.medical_conditions || '',
        });

        await storageService.saveUser(updatedUser);
        await authService.updateCurrentUser({
          ...updatedUser,
          id: String(updatedUser.id),
        });

        if (isOnboarding) {
          navigation.reset({ index: 0, routes: [{ name: 'MainTabs' as any }] });
        } else {
          Alert.alert(t('success.updated'), t('success.saved'));
          navigation.goBack();
        }
      } else {
        Alert.alert(t('common.error'), response.message || t('errors.unknown'));
      }
    } catch (e) {
      Alert.alert(t('common.error'), t('errors.unknown'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={{ padding: 20 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.title}>
              {isOnboarding ? t('auth.completeProfile.title') : t('settings.personalInfo')}
            </Text>
            
            <Label>{t('auth.register.name')}</Label>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => setForm({...form, name: normalizeTextInput(v)})}
              placeholder="John Doe"
              placeholderTextColor="#9CA3AF"
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />

            <Label>{t('auth.register.phone')}</Label>
            <TextInput
              style={styles.input}
              value={form.phone}
              onChangeText={(v) => setForm({...form, phone: normalizePhoneInput(v)})}
              keyboardType="phone-pad"
              inputAccessoryViewID={Platform.OS === 'ios' ? IOS_KEYBOARD_ACCESSORY_ID : undefined}
              placeholder="+201234567890"
              placeholderTextColor="#9CA3AF"
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />

            <View className="flex-row mb-4">
              <View className="flex-1 mr-2">
                  <Label>{t('settings.age')}</Label>
                  <TextInput
                  style={styles.input}
                  value={form.age}
                  onChangeText={(v) => setForm({...form, age: normalizeNumericInput(v)})}
                  keyboardType="number-pad"
                  inputAccessoryViewID={Platform.OS === 'ios' ? IOS_KEYBOARD_ACCESSORY_ID : undefined}
                  maxLength={3}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  />
              </View>
              <View className="flex-1 ml-2">
                  <Label>{t('settings.gender')}</Label>
                  <View className="flex-row h-[50px]">
                      {['male', 'female'].map((g) => (
                          <TouchableOpacity
                              key={g}
                              onPress={() => {
                                Keyboard.dismiss();
                                setForm({...form, gender: g as any});
                              }}
                              style={[styles.genderBtn, form.gender === g && styles.genderBtnActive]}
                              className="flex-1 flex-row items-center justify-center mx-1 rounded-xl"
                          >
                              <MaterialCommunityIcons 
                                  name={g === 'male' ? 'gender-male' : 'gender-female'} 
                                  size={18} 
                                  color={form.gender === g ? '#FFF' : '#6B7280'} 
                              />
                          </TouchableOpacity>
                      ))}
                  </View>
              </View>
          </View>

          <View className="flex-row mb-4">
            <View className="flex-1 mr-2">
              <Label>{t('settings.height')} (cm)</Label>
              <TextInput
                style={styles.input}
                value={form.height}
                keyboardType="numeric"
                inputAccessoryViewID={Platform.OS === 'ios' ? IOS_KEYBOARD_ACCESSORY_ID : undefined}
                onChangeText={(v) => setForm({...form, height: normalizeNumericInput(v)})}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
            <View className="flex-1 ml-2">
              <Label>{t('settings.weight')} (kg)</Label>
              <TextInput
                style={styles.input}
                value={form.weight}
                keyboardType="numeric"
                inputAccessoryViewID={Platform.OS === 'ios' ? IOS_KEYBOARD_ACCESSORY_ID : undefined}
                onChangeText={(v) => setForm({...form, weight: normalizeNumericInput(v)})}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
          </View>

          <Label>{t('settings.emergencyContact')}</Label>
          <TextInput
            style={styles.input}
            value={form.emergency_contact}
            onChangeText={(v) => setForm({...form, emergency_contact: normalizePhoneInput(v)})}
            keyboardType="phone-pad"
            inputAccessoryViewID={Platform.OS === 'ios' ? IOS_KEYBOARD_ACCESSORY_ID : undefined}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />

          <Label>{t('settings.medicalConditions')}</Label>
          <TextInput
            style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
            value={form.medical_conditions}
            multiline
            onChangeText={(v) => setForm({...form, medical_conditions: v})}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>

        <TouchableOpacity 
          style={styles.saveBtn} 
          onPress={() => {
            Keyboard.dismiss();
            handleSave();
          }}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>{t('common.save')}</Text>}
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <InputAccessoryView nativeID={IOS_KEYBOARD_ACCESSORY_ID}>
            <View style={styles.keyboardAccessory}>
              <View style={styles.keyboardAccessorySpacer} />
              <TouchableOpacity onPress={Keyboard.dismiss} style={styles.keyboardDoneButton}>
                <Text style={styles.keyboardDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        )}
      </ScrollView>
    </TouchableWithoutFeedback>
  </KeyboardAvoidingView>
  );
};

// مكون صغير للعنوان (Label)
const Label = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ fontSize: 13, fontWeight: '700', color: '#4B5563', marginBottom: 8, marginLeft: 4 }}>{children}</Text>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 50,
    fontSize: 15,
    color: '#1F2937',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  genderBtn: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  genderBtnActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  saveBtn: {
    backgroundColor: '#2196F3',
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  keyboardAccessory: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  keyboardAccessorySpacer: {
    flex: 1,
  },
  keyboardDoneButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  keyboardDoneText: {
    color: '#2196F3',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default PersonalInfoScreen;
