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
import { CareLink, CareLinkRequest, User } from '../types';
import { realtimeService } from '../services/realtime.service';
import { ScreenHeader } from '../components/ScreenHeader';

const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const phoneDigitsRegex = /^\+?[0-9]{6,15}$/;

export const CareManagementScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [reverseLinks, setReverseLinks] = useState<CareLink[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<CareLinkRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<CareLinkRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [identifier, setIdentifier] = useState('');
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
      await Promise.all([
        fetchLinks(normalizedSessionUser.id),
        fetchReverseLinks(normalizedSessionUser.id),
        fetchRequests(normalizedSessionUser.id),
      ]);
    }
  };

  useEffect(() => {
    const unsubscribe = realtimeService.subscribe('care', (event) => {
      if (!user?.id) return;
      if (!event.payload) return;

      const payload = event.payload as any;
      const isRequest = typeof payload.status === 'string';
      const isCaregiver = payload.caregiver_id === user.id;
      const isPatient = payload.patient_id === user.id;

      if (isRequest) {
        if (isPatient) {
          setApprovalRequests((prev) => {
            const exists = prev.find((item) => item.id === payload.id);
            if (payload.status !== 'pending') {
              return prev.filter((item) => item.id !== payload.id);
            }
            const next = exists
              ? prev.map((item) => (item.id === payload.id ? { ...item, ...payload } : item))
              : [payload, ...prev];
            return next;
          });
        }

        if (isCaregiver) {
          setSentRequests((prev) => {
            const exists = prev.find((item) => item.id === payload.id);
            if (payload.status !== 'pending') {
              return prev.filter((item) => item.id !== payload.id);
            }
            const next = exists
              ? prev.map((item) => (item.id === payload.id ? { ...item, ...payload } : item))
              : [payload, ...prev];
            return next;
          });
        }
      } else {
        if (isCaregiver) {
          setLinks((prev) => {
            const exists = prev.find((item) => item.id === payload.id);
            if (payload.is_active === false) {
              return prev.filter((item) => item.id !== payload.id);
            }
            const next = exists
              ? prev.map((item) => (item.id === payload.id ? { ...item, ...payload } : item))
              : [payload, ...prev];
            return next;
          });
        }
        if (isPatient) {
          setReverseLinks((prev) => {
            const exists = prev.find((item) => item.id === payload.id);
            if (payload.is_active === false) {
              return prev.filter((item) => item.id !== payload.id);
            }
            const next = exists
              ? prev.map((item) => (item.id === payload.id ? { ...item, ...payload } : item))
              : [payload, ...prev];
            return next;
          });
        }
      }
    });

    return unsubscribe;
  }, [user?.id]);

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

  const fetchReverseLinks = async (patientId: number) => {
    try {
      const response = await apiService.getCareLinksAsPatient(patientId);
      if (response.success && response.data) {
        setReverseLinks(response.data);
      } else {
        setReverseLinks([]);
      }
    } catch {
      setReverseLinks([]);
    }
  };

  const fetchRequests = async (userId: number) => {
    try {
      const [approvals, sent] = await Promise.all([
        apiService.getCareRequestsApprovals(userId),
        apiService.getCareRequestsSent(userId),
      ]);
      setApprovalRequests(approvals.success && approvals.data ? approvals.data : []);
      setSentRequests(sent.success && sent.data ? sent.data : []);
    } catch {
      setApprovalRequests([]);
      setSentRequests([]);
    }
  };

  const normalizeIdentifier = (value: string) => value.replace(/[\s\-\(\)]/g, '').trim();

  const handleAdd = async () => {
    if (!user) {
      Alert.alert(t('common.error'), t('errors.loginRequired'));
      return;
    }

    const trimmedIdentifier = identifier.trim();
    const normalized = normalizeIdentifier(trimmedIdentifier);
    const isEmail = emailRegex.test(trimmedIdentifier.toLowerCase());
    const isPhone = phoneDigitsRegex.test(normalized);

    if (!isEmail && !isPhone) {
      Alert.alert(t('common.error'), t('care.invalidIdentifier'));
      return;
    }

    if (isEmail) {
      const emailCheck = await apiService.checkEmailExists(trimmedIdentifier.toLowerCase());
      if (!emailCheck.success || !emailCheck.data?.exists) {
        Alert.alert(t('common.error'), t('care.notRegistered'));
        return;
      }
    }

    if (isPhone) {
      const phoneCheck = await apiService.checkPhoneExists(normalized);
      if (!phoneCheck.success || !phoneCheck.data?.exists) {
        Alert.alert(t('common.error'), t('care.notRegistered'));
        return;
      }
    }

    if (isEmail && user.email && trimmedIdentifier.toLowerCase() === user.email.toLowerCase()) {
      Alert.alert(t('common.error'), t('care.cannotSelf'));
      return;
    }

    if (isPhone && user.emergency_contact && normalizeIdentifier(user.emergency_contact) === normalized) {
      Alert.alert(t('common.error'), t('care.cannotSelf'));
      return;
    }

    setSaving(true);
    try {
      const response = await apiService.createCareRequest({
        caregiver_id: user.id,
        patient_email: isEmail ? trimmedIdentifier.toLowerCase() : undefined,
        patient_phone: isPhone ? normalized : undefined,
        relationship: relationship.trim() || undefined,
      });

      if (response.success && response.data) {
        Alert.alert(t('success.updated'), t('care.requestSent'));
        setIdentifier('');
        setRelationship('');
        await Promise.all([fetchLinks(user.id), fetchReverseLinks(user.id), fetchRequests(user.id)]);
      } else {
        Alert.alert(t('common.error'), response.message || t('care.requestFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptRequest = async (requestId: number) => {
    if (!user) return;
    const response = await apiService.acceptCareRequest(requestId, user.id);
    if (response.success) {
      await Promise.all([fetchLinks(user.id), fetchReverseLinks(user.id), fetchRequests(user.id)]);
    } else {
      Alert.alert(t('common.error'), response.message || t('care.requestFailed'));
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    if (!user) return;
    const response = await apiService.rejectCareRequest(requestId, user.id);
    if (response.success) {
      await Promise.all([fetchLinks(user.id), fetchReverseLinks(user.id), fetchRequests(user.id)]);
    } else {
      Alert.alert(t('common.error'), response.message || t('care.requestFailed'));
    }
  };

  const handleCancelRequest = async (requestId: number) => {
    if (!user) return;
    const response = await apiService.cancelCareRequest(requestId, user.id);
    if (response.success) {
      await fetchRequests(user.id);
    } else {
      Alert.alert(t('common.error'), response.message || t('care.requestFailed'));
    }
  };

  const getApprovalRequestDisplayUser = (req: CareLinkRequest) => {
    if (!user) return req.caregiver || req.patient || null;
    const requestType = req.request_type || 'link';
    const initiatedBy = req.initiated_by || 'caregiver';

    if (requestType === 'unlink' && initiatedBy === 'patient' && req.caregiver_id === user.id) {
      return req.patient || null;
    }

    return req.caregiver || req.patient || null;
  };

  const getSentRequestDisplayUser = (req: CareLinkRequest) => {
    if (!user) return req.patient || req.caregiver || null;
    const requestType = req.request_type || 'link';
    const initiatedBy = req.initiated_by || 'caregiver';

    if (requestType === 'unlink' && initiatedBy === 'patient' && req.patient_id === user.id) {
      return req.caregiver || null;
    }

    return req.patient || req.caregiver || null;
  };

  const handleSelect = async (link: CareLink) => {
    if (!link.patient) return;
    await storageService.saveMonitoredUser(link.patient);
    setMonitoredUser(link.patient);
    navigation.navigate('CareDashboard');
  };

  const handleSwitchBack = async () => {
    await storageService.saveMonitoredUser(null);
    setMonitoredUser(null);
  };

  const handleUnlink = async (link: CareLink) => {
    Alert.alert(
      t('care.unlinkRequestTitle'),
      t('care.unlinkRequestBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('care.sendUnlinkRequest'),
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            const response = await apiService.requestCareUnlink(link.id, user.id);
            if (response.success) {
              Alert.alert(t('success.sent'), t('care.unlinkRequestSent'));
              await fetchRequests(user.id);
            } else {
              Alert.alert(t('common.error'), response.message || t('care.unlinkRequestFailed'));
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView className="flex-1 bg-light" showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title={t('settings.careManagement')}
        subtitle={t('care.subtitle')}
        showBack
      />

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.selected')}</Text>
        {monitoredUser ? (
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-sm font-semibold text-dark">
                {monitoredUser.name}
              </Text>
              {monitoredUser.email ? (
                <Text className="text-xs text-gray mt-1">{monitoredUser.email}</Text>
              ) : null}
              <Text className="text-xs text-gray mt-1">{t('care.monitoring')}</Text>
            </View>
            <TouchableOpacity
              className="px-3 py-2 rounded-lg bg-lightGray"
              onPress={handleSwitchBack}
            >
              <Text className="text-xs text-dark">
                {t('care.switchBack')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text className="text-xs text-gray">
            {t('care.noMonitoredUser')}
          </Text>
        )}
      </View>

      <View className="mx-4 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.addTitle')}</Text>
        <Text className="text-xs text-gray mb-3">{t('care.addHint')}</Text>

        <Text className="input-label">{t('care.identifierLabel')}</Text>
        <TextInput
          className="input-field"
          value={identifier}
          onChangeText={setIdentifier}
          placeholder={t('care.identifierPlaceholder')}
          placeholderTextColor="#BDBDBD"
          autoCapitalize="none"
          keyboardType="default"
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

      <View className="mx-4 mt-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.requestsIncoming')}</Text>

        {approvalRequests.length === 0 ? (
          <Text className="text-xs text-gray">
            {t('care.noIncomingRequests')}
          </Text>
        ) : (
          approvalRequests.map((req) => {
            const displayUser = getApprovalRequestDisplayUser(req);
            return (
            <View
              key={req.id}
              className="bg-white rounded-2xl shadow-lg border border-lightGray p-4 mb-3"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-dark">
                    {displayUser?.name || t('common.unknown')}
                  </Text>
                  {displayUser?.email ? (
                    <Text className="text-xs text-gray mt-1">{displayUser.email}</Text>
                  ) : null}
                  <Text className="text-xs text-gray mt-1">
                    {t(`care.requestType.${req.request_type || 'link'}`)}
                  </Text>
                  {req.relationship ? (
                    <Text className="text-xs text-gray mt-1">{req.relationship}</Text>
                  ) : null}
                </View>
                <View className="flex-row items-center">
                  <TouchableOpacity
                    className="px-3 py-2 rounded-lg bg-green-50 mr-2"
                    onPress={() => handleAcceptRequest(req.id)}
                  >
                    <Text className="text-xs text-success">{t('care.accept')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="px-3 py-2 rounded-lg bg-red-50"
                    onPress={() => handleRejectRequest(req.id)}
                  >
                    <Text className="text-xs text-danger">{t('care.reject')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )})
        )}
      </View>

      <View className="mx-4 mt-4">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.requestsOutgoing')}</Text>

        {sentRequests.length === 0 ? (
          <Text className="text-xs text-gray">
            {t('care.noOutgoingRequests')}
          </Text>
        ) : (
          sentRequests.map((req) => {
            const displayUser = getSentRequestDisplayUser(req);
            return (
            <View
              key={req.id}
              className="bg-white rounded-2xl shadow-lg border border-lightGray p-4 mb-3"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-dark">
                    {displayUser?.name || t('common.unknown')}
                  </Text>
                  {displayUser?.email ? (
                    <Text className="text-xs text-gray mt-1">{displayUser.email}</Text>
                  ) : null}
                  <Text className="text-xs text-gray mt-1">
                    {t(`care.requestType.${req.request_type || 'link'}`)}
                  </Text>
                  <Text className="text-xs text-gray mt-1">
                    {t(`care.requestStatus.${req.status}`)}
                  </Text>
                </View>
                {req.status === 'pending' ? (
                  <TouchableOpacity
                    className="px-3 py-2 rounded-lg bg-orange-50"
                    onPress={() => handleCancelRequest(req.id)}
                  >
                    <Text className="text-xs text-warning">{t('care.cancelRequest')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )})
        )}
      </View>

      <View className="mx-4 mt-4 mb-6">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.listTitle')}</Text>

        {loading ? (
          <ActivityIndicator color="#2196F3" />
        ) : links.length === 0 ? (
          <Text className="text-xs text-gray">
            {t('care.noLinks')}
          </Text>
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

      <View className="mx-4 mt-4 mb-6">
        <Text className="text-base font-semibold text-dark mb-3">{t('care.monitorsMeTitle')}</Text>

        {loading ? (
          <ActivityIndicator color="#2196F3" />
        ) : reverseLinks.length === 0 ? (
          <Text className="text-xs text-gray">
            {t('care.noMonitorsMe')}
          </Text>
        ) : (
          reverseLinks.map((link) => (
            <View
              key={link.id}
              className="bg-white rounded-2xl shadow-lg border border-lightGray p-4 mb-3"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-dark">
                    {link.caregiver?.name || t('common.unknown')}
                  </Text>
                  {link.caregiver?.email ? (
                    <Text className="text-xs text-gray mt-1">{link.caregiver.email}</Text>
                  ) : null}
                  {link.relationship ? (
                    <Text className="text-xs text-gray mt-1">{link.relationship}</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  className="px-3 py-2 rounded-lg bg-red-50"
                  onPress={() => handleUnlink(link)}
                >
                  <Text className="text-xs text-danger">{t('care.remove')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
};
