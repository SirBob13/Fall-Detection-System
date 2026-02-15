import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useLanguage } from '../components/LanguageProvider';
import { authService } from '../services/auth.service';
import { apiService } from '../services/api';
import { storageService } from '../services/storage';
import { CareLink, User } from '../types';

const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const CareManagementScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [monitoredUser, setMonitoredUser] = useState<User | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const sessionUser = await authService.getCurrentUser();
    const normalizedSessionUser = sessionUser
      ? ({
          id: Number(sessionUser.id ?? 0),
          name: sessionUser.name || '',
          email: sessionUser.email,
          phone: sessionUser.phone,
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

    if (normalizedSessionUser) {
      await storageService.saveUser(normalizedSessionUser);
    }
    setUser(normalizedSessionUser);

    const storedMonitored = await storageService.getMonitoredUser();
    setMonitoredUser(storedMonitored);

    if (normalizedSessionUser) {
      await fetchLinks(normalizedSessionUser.id);
    }
  };

  const fetchLinks = async (caregiverId: number) => {
    setLoading(true);
    try {
      const response = await apiService.getCareLinks(caregiverId);
      if (response.success && response.data) {
        setLinks(response.data);
      } else {
        setLinks([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!user) {
      Alert.alert(t('common.error'), t('errors.loginRequired'));
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!emailRegex.test(trimmedEmail)) {
      Alert.alert(t('common.error'), t('care.invalidEmail'));
      return;
    }

    if (user.email && trimmedEmail === user.email.toLowerCase()) {
      Alert.alert(t('common.error'), t('care.cannotSelf'));
      return;
    }

    setSaving(true);
    try {
      const response = await apiService.createCareLink({
        caregiver_id: user.id,
        patient_email: trimmedEmail,
        relationship: relationship.trim() || undefined,
      });

      if (response.success && response.data) {
        Alert.alert(t('success.updated'), t('care.linkSuccess'));
        setEmail('');
        setRelationship('');
        await fetchLinks(user.id);
      } else {
        Alert.alert(t('common.error'), response.message || t('care.linkFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = async (link: CareLink) => {
    if (!link.patient) return;
    await storageService.saveMonitoredUser(link.patient);
    setMonitoredUser(link.patient);
  };

  const handleChat = (link: CareLink) => {
    if (!link.patient) return;
    navigation.navigate('Chat', {
      patientId: link.patient.id,
      patientName: link.patient.name,
    });
  };

  const handleSwitchBack = async () => {
    await storageService.saveMonitoredUser(null);
    setMonitoredUser(null);
  };

  const handleUnlink = async (link: CareLink) => {
    Alert.alert(
      t('care.unlinkConfirmTitle'),
      t('care.unlinkConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('care.remove'),
          style: 'destructive',
          onPress: async () => {
            const response = await apiService.deleteCareLink(link.id);
            if (response.success) {
              if (monitoredUser && link.patient && monitoredUser.id === link.patient.id) {
                await storageService.saveMonitoredUser(null);
                setMonitoredUser(null);
              }
              Alert.alert(t('success.deleted'), t('care.unlinkSuccess'));
              if (user) {
                await fetchLinks(user.id);
              }
            } else {
              Alert.alert(t('common.error'), response.message || t('care.linkFailed'));
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView className="flex-1 bg-light" showsVerticalScrollIndicator={false}>
      <View className="mx-4 mt-4">
        <Text className="text-lg font-bold text-dark">{t('care.title')}</Text>
        <Text className="text-xs text-gray mt-1">{t('settings.careManagementDesc')}</Text>
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.selected')}</Text>
        {monitoredUser ? (
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-sm font-semibold text-dark">{monitoredUser.name}</Text>
              {monitoredUser.email ? (
                <Text className="text-xs text-gray mt-1">{monitoredUser.email}</Text>
              ) : null}
              <Text className="text-xs text-gray mt-1">{t('care.monitoring')}</Text>
            </View>
            <TouchableOpacity
              className="px-3 py-2 rounded-lg bg-lightGray"
              onPress={handleSwitchBack}
            >
              <Text className="text-xs text-dark">{t('care.switchBack')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text className="text-xs text-gray">{t('care.selfMonitoring')}</Text>
        )}
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.addTitle')}</Text>

        <Text className="input-label">{t('care.emailLabel')}</Text>
        <TextInput
          className="input-field"
          value={email}
          onChangeText={setEmail}
          placeholder={t('care.emailPlaceholder')}
          placeholderTextColor="#BDBDBD"
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text className="input-label mt-4">{t('care.relationshipLabel')}</Text>
        <TextInput
          className="input-field"
          value={relationship}
          onChangeText={setRelationship}
          placeholder={t('care.relationshipPlaceholder')}
          placeholderTextColor="#BDBDBD"
        />

        <TouchableOpacity
          className="mt-4 bg-primary rounded-xl py-3 items-center"
          onPress={handleAdd}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text className="text-white font-semibold">{t('care.addButton')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <View className="mx-4 mt-4 mb-6">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.listTitle')}</Text>

        {loading ? (
          <ActivityIndicator color="#2196F3" />
        ) : links.length === 0 ? (
          <Text className="text-xs text-gray">{t('care.noLinked')}</Text>
        ) : (
          links.map((link) => (
            <View
              key={link.id}
              className="bg-white rounded-2xl shadow-lg border border-lightGray p-4 mb-3"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-dark">
                    {link.patient?.name || t('common.unknown')}
                  </Text>
                  {link.patient?.email ? (
                    <Text className="text-xs text-gray mt-1">{link.patient.email}</Text>
                  ) : null}
                  {link.relationship ? (
                    <Text className="text-xs text-gray mt-1">{link.relationship}</Text>
                  ) : null}
                </View>
                <View className="flex-row items-center">
                  <TouchableOpacity
                    className="px-3 py-2 rounded-lg bg-blue-50 mr-2"
                    onPress={() => handleSelect(link)}
                  >
                    <Text className="text-xs text-primary">{t('care.select')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="px-3 py-2 rounded-lg bg-primary/10 mr-2"
                    onPress={() => handleChat(link)}
                  >
                    <Text className="text-xs text-primary">{t('chat.open')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="px-3 py-2 rounded-lg bg-red-50"
                    onPress={() => handleUnlink(link)}
                  >
                    <Text className="text-xs text-danger">{t('care.remove')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
};
