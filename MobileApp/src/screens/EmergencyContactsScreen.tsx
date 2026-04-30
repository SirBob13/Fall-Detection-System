import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  TextInput,
  Modal,
  ActivityIndicator,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, useScrollToTop } from '@react-navigation/native';
import { emergencyService } from '../services/emergency.service';
import { EmergencyContact } from '../services/emergency.types';
import { useLanguage } from '../components/LanguageProvider';
import { ScreenHeader } from '../components/ScreenHeader';

export const EmergencyContactsScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const scrollRef = useRef<any>(null);
  const setupPromptShownRef = useRef(false);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<EmergencyContact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [editablePhones, setEditablePhones] = useState<Record<string, string>>({});
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    relationship: 'family',
    priority: 3,
    is_active: true,
  });

  useScrollToTop(scrollRef);

  const isSetupRequired = Boolean(route.params?.requiredSetup);
  const shouldOpenImportOnEntry = Boolean(route.params?.openImport);
  const hasUsableContacts = (items: EmergencyContact[]) =>
    items.some((contact) => contact.is_active && Boolean(contact.phone?.trim()));

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    if (isLoading || !isSetupRequired) {
      return;
    }

    if (hasUsableContacts(contacts)) {
      setupPromptShownRef.current = false;
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
      return;
    }

    if (setupPromptShownRef.current) {
      return;
    }

    setupPromptShownRef.current = true;
    Alert.alert(
      t('emergency.contacts.setupRequiredTitle'),
      t('emergency.contacts.setupRequiredMessage'),
      [
        {
          text: t('emergency.contacts.importNow'),
          onPress: () => {
            if (shouldOpenImportOnEntry) {
              void beginImportContacts(false);
            }
          },
        },
        {
          text: t('emergency.contacts.addManually'),
          onPress: handleAddContact,
        },
      ],
      { cancelable: false }
    );
  }, [contacts, isLoading, isSetupRequired, navigation, shouldOpenImportOnEntry, t]);

  const loadContacts = async () => {
    try {
      setIsLoading(true);
      const data = await emergencyService.getEmergencyContacts();
      setContacts(data);
    } catch (error) {
      console.error('Error loading contacts:', error);
      Alert.alert(t('common.error'), t('emergency.contacts.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddContact = () => {
    setEditingContact(null);
    setFormData({
      name: '',
      phone: '',
      relationship: 'family',
      priority: 3,
      is_active: true,
    });
    setModalVisible(true);
  };

  const handleEditContact = (contact: EmergencyContact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      phone: contact.phone,
      relationship: contact.relationship,
      priority: contact.priority,
      is_active: contact.is_active,
    });
    setModalVisible(true);
  };

  const handleSaveContact = async () => {
    if (!formData.name.trim() || !formData.phone.trim()) {
      Alert.alert(t('common.error'), t('emergency.contacts.required'));
      return;
    }

    try {
      if (editingContact) {
        // Update existing contact
        const updatedContacts = contacts.map(contact =>
          contact.id === editingContact.id
            ? { ...contact, ...formData }
            : contact
        );
        await emergencyService.saveEmergencyContacts(updatedContacts);
        Alert.alert(t('success.updated'), t('emergency.contacts.updateSuccess'));
      } else {
        // Add new contact
        await emergencyService.addEmergencyContact(formData);
        Alert.alert(t('success.saved'), t('emergency.contacts.addSuccess'));
      }
      
      setModalVisible(false);
      loadContacts();
    } catch (error) {
      console.error('Error saving contact:', error);
      Alert.alert(t('common.error'), t('emergency.contacts.saveFailed'));
    }
  };

  const handleDeleteContact = (contactId: string) => {
    Alert.alert(
      t('emergency.contacts.deleteTitle'),
      t('emergency.contacts.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const updatedContacts = contacts.filter(c => c.id !== contactId);
              await emergencyService.saveEmergencyContacts(updatedContacts);
              loadContacts();
            } catch (error) {
              Alert.alert(t('common.error'), t('emergency.contacts.deleteFailed'));
            }
          },
        },
      ]
    );
  };

  const handleToggleActive = async (contactId: string, isActive: boolean) => {
    try {
      const updatedContacts = contacts.map(contact =>
        contact.id === contactId
          ? { ...contact, is_active: !isActive }
          : contact
      );
      await emergencyService.saveEmergencyContacts(updatedContacts);
      setContacts(updatedContacts);
    } catch (error) {
      console.error('Error toggling contact:', error);
    }
  };

  const beginImportContacts = async (withConfirmation: boolean = true) => {
    try {
      const startImport = async () => {
        const importResult = await emergencyService.importPhoneContacts();
        if (importResult.permissionStatus === 'denied') {
          Alert.alert(
            t('emergency.contacts.permissionDeniedTitle'),
            t('emergency.contacts.permissionDeniedMessage'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('emergency.contacts.openSettings'),
                onPress: () => Linking.openSettings(),
              },
            ]
          );
          return;
        }

        if (importResult.permissionStatus === 'limited') {
          Alert.alert(
            t('emergency.contacts.limitedAccessTitle'),
            t('emergency.contacts.limitedAccessMessage'),
            [
              { text: t('common.ok') },
              {
                text: t('emergency.contacts.openSettings'),
                onPress: () => Linking.openSettings(),
              },
            ]
          );
        }

        if (importResult.contacts.length > 0) {
          const missingPhoneCount = importResult.contacts.filter(
            (contact) => !contact.phone || contact.phone.trim().length === 0
          ).length;
          if (missingPhoneCount > 0) {
            Alert.alert(
              t('emergency.contacts.missingPhoneTitle'),
              t('emergency.contacts.missingPhoneMessage', { count: missingPhoneCount })
            );
          }
          setPhoneContacts(importResult.contacts);
          setSelectedContactIds(new Set());
          setEditablePhones(
            importResult.contacts.reduce<Record<string, string>>((acc, contact) => {
              acc[contact.id] = contact.phone || '';
              return acc;
            }, {})
          );
          setContactSearch('');
          setImportModalVisible(true);
        } else {
          Alert.alert(t('common.note'), t('emergency.contacts.noPhoneContacts'));
        }
      };

      if (!withConfirmation) {
        await startImport();
        return;
      }

      Alert.alert(
        t('emergency.contacts.importTitle'),
        t('emergency.contacts.importConfirm'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.import'),
            onPress: () => {
              void startImport();
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert(t('common.error'), t('emergency.contacts.importFailed'));
    }
  };

  const handleImportContacts = async () => {
    await beginImportContacts(true);
  };

  const normalizePhoneInput = (value: string): string => {
    let normalized = value.replace(/[^\d+]/g, '');
    if (normalized.includes('+')) {
      normalized = normalized.replace(/(?!^)\+/g, '');
    }
    return normalized;
  };

  const handleToggleSelect = (contactId: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const handleSaveSelectedContacts = async () => {
    if (selectedContactIds.size === 0) {
      Alert.alert(t('common.note'), t('emergency.contacts.selectAtLeastOne'));
      return;
    }

    try {
      const selectedContacts = phoneContacts.filter((contact) => selectedContactIds.has(contact.id));
      for (const contact of selectedContacts) {
        const phone = normalizePhoneInput(editablePhones[contact.id] || contact.phone || '');
        if (!phone) {
          continue;
        }
        await emergencyService.addEmergencyContact({
          name: contact.name || t('emergency.contacts.contact'),
          phone,
          relationship: 'family',
          priority: 3,
          is_active: true,
        });
      }
      setImportModalVisible(false);
      setPhoneContacts([]);
      setSelectedContactIds(new Set());
      setEditablePhones({});
      loadContacts();
      Alert.alert(t('success.saved'), t('emergency.contacts.importSuccess'));
    } catch (error) {
      Alert.alert(t('common.error'), t('emergency.contacts.importSaveFailed'));
    }
  };

  const getPriorityText = (priority: number) => {
    switch (priority) {
      case 1: return t('emergency.contacts.priorityHigh');
      case 2: return t('emergency.contacts.priorityMedium');
      case 3: return t('emergency.contacts.priorityLow');
      default: return t('emergency.contacts.priorityNormal');
    }
  };

  const getRelationshipIcon = (relationship: string) => {
    switch (relationship) {
      case 'family': return 'account-group';
      case 'doctor': return 'doctor';
      case 'friend': return 'account';
      case 'neighbor': return 'home';
      default: return 'account';
    }
  };

  const getRelationshipText = (relationship: string) => {
    switch (relationship) {
      case 'family': return t('emergency.contacts.family');
      case 'doctor': return t('emergency.contacts.doctor');
      case 'friend': return t('emergency.contacts.friend');
      case 'neighbor': return t('emergency.contacts.neighbor');
      default: return t('emergency.contacts.contact');
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <MaterialCommunityIcons name="account-group" size={60} color="#2196F3" />
        <Text className="mt-4 text-base text-gray">
          {t('common.loading')}
        </Text>
        <ActivityIndicator color="#2196F3" size="large" className="mt-4" />
      </View>
    );
  }

  return (
    <View className={`flex-1 bg-light ${Platform.OS === 'android' ? 'pb-20' : ''}`} >
      <ScreenHeader
        title={t('emergency.contacts.title')}
        subtitle={t('emergency.contacts.description')}
        showBack
      />

      {/* Quick Stats */}
      <View className="mx-5 mt-1 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <View className="flex-row justify-between">
          <View className="items-center flex-1">
            <Text className="text-2xl font-bold text-dark">
              {contacts.length}
            </Text>
            <Text className="text-xs text-gray">
              {t('emergency.contacts.totalContacts')}
            </Text>
          </View>
          
          <View className="items-center flex-1">
            <Text className="text-2xl font-bold text-dark">
              {contacts.filter(c => c.is_active).length}
            </Text>
            <Text className="text-xs text-gray">
              {t('emergency.contacts.activeContacts')}
            </Text>
          </View>
          
          <View className="items-center flex-1">
            <Text className="text-2xl font-bold text-dark">
              {contacts.filter(c => c.priority === 1).length}
            </Text>
            <Text className="text-xs text-gray">
              {t('emergency.contacts.highPriority')}
            </Text>
          </View>
        </View>
      </View>

      {/* Contacts List */}
      <ScrollView 
        ref={scrollRef}
        className="flex-1 p-4" 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'android' ? 50 : 20 }}
      >
        {contacts.length === 0 ? (
          <View className="items-center justify-center py-20">
            <View className="w-24 h-24 rounded-full bg-gray-100 justify-center items-center mb-6">
              <MaterialCommunityIcons name="account-alert" size={40} color="#BDBDBD" />
            </View>
            <Text className="text-lg text-gray font-medium">{t('emergency.contacts.emptyTitle')}</Text>
            <Text className="text-sm text-lightGray text-center mt-2 px-8">
              {t('emergency.contacts.emptyDesc')}
            </Text>
            
            <TouchableOpacity
              className="mt-8 px-6 py-3 bg-primary rounded-full"
              onPress={handleAddContact}
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold">{t('emergency.contacts.addFirst')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          contacts.map(contact => (
            <View
              key={contact.id}
              className={`bg-white rounded-2xl shadow-card p-4 mb-3 border ${
                contact.is_active 
                  ? contact.priority === 1 
                    ? 'border-danger/30' 
                    : contact.priority === 2
                    ? 'border-warning/30'
                    : 'border-success/30'
                  : 'border-lightGray'
              } ${!contact.is_active && 'opacity-60'}`}
            >
              {/* Contact Header */}
              <View className="flex-row justify-between items-start mb-3">
                <View className="flex-row items-center flex-1">
                  {/* Priority Badge */}
                  <View 
                    className={`px-2 py-1 rounded-full mr-3 ${
                      contact.priority === 1 ? 'bg-danger' :
                      contact.priority === 2 ? 'bg-warning' :
                      'bg-success'
                    }`}
                  >
                    <Text className="text-xs text-white font-bold">
                      {getPriorityText(contact.priority)}
                    </Text>
                  </View>
                  
                  {/* Relationship Icon */}
                  <View className="w-10 h-10 rounded-full bg-blue-50 justify-center items-center mr-3">
                    <MaterialCommunityIcons
                      name={getRelationshipIcon(contact.relationship)}
                      size={20}
                      color="#2196F3"
                    />
                  </View>
                  
                  {/* Contact Info */}
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-dark">
                      {contact.name}
                    </Text>
                    <Text className="text-sm text-primary mt-1">{contact.phone}</Text>
                    <View className="flex-row items-center mt-1">
                      <Text className="text-xs text-gray">
                        {getRelationshipText(contact.relationship)}
                      </Text>
                      <View className="w-1 h-1 rounded-full bg-gray mx-2" />
                      <Text className={`text-xs ${
                        contact.is_active ? 'text-success' : 'text-gray'
                      }`}>
                        {contact.is_active ? t('common.active') : t('common.inactive')}
                      </Text>
                    </View>
                  </View>
                </View>
                
                {/* Active Toggle */}
                <Switch
                  value={contact.is_active}
                  onValueChange={() => handleToggleActive(contact.id, contact.is_active)}
                  trackColor={{ false: '#E0E0E0', true: '#2196F3' }}
                  thumbColor={contact.is_active ? '#FFFFFF' : '#F4F3F4'}
                />
              </View>

              {/* Contact Actions */}
              <View className="flex-row justify-end border-t border-lightGray pt-3">
                <TouchableOpacity
                  className="flex-row items-center px-3 py-1.5 bg-blue-50 rounded-lg mr-2"
                  onPress={() => handleEditContact(contact)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="pencil" size={16} color="#2196F3" />
                  <Text className="text-sm font-medium text-primary ml-1">{t('common.edit')}</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  className="flex-row items-center px-3 py-1.5 bg-red-50 rounded-lg"
                  onPress={() => handleDeleteContact(contact.id)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="delete" size={16} color="#F44336" />
                  <Text className="text-sm font-medium text-danger ml-1">{t('common.delete')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
        
        {/* Tips Section */}
        {contacts.length > 0 && (
          <View className="mt-6 mb-4 p-4 bg-blue-50 rounded-2xl border border-blue-200">
            <View className="flex-row items-center mb-2">
              <MaterialCommunityIcons name="lightbulb" size={20} color="#2196F3" />
              <Text className="text-base font-semibold text-dark ml-2">{t('emergency.contacts.tipsTitle')}</Text>
            </View>
            <Text className="text-sm text-gray">
              • {t('emergency.contacts.tipPriority')}
            </Text>
            <Text className="text-sm text-gray mt-1">
              • {t('emergency.contacts.tipActive')}
            </Text>
            <Text className="text-sm text-gray mt-1">
              • {t('emergency.contacts.tipInform')}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Footer Actions */}
      <View className="bg-white border-t border-lightGray p-4">
        <TouchableOpacity
          className="flex-row items-center justify-center py-3 px-4 bg-info rounded-xl mb-3"
          onPress={handleImportContacts}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="import" size={20} color="#FFFFFF" />
          <Text className="text-white font-semibold ml-2">{t('emergency.contacts.import')}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          className="flex-row items-center justify-center py-4 px-4 bg-primary rounded-xl shadow-button"
          onPress={handleAddContact}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="plus" size={24} color="#FFFFFF" />
          <Text className="text-white font-bold text-lg ml-2">{t('emergency.contacts.addNewContact')}</Text>
        </TouchableOpacity>
      </View>

      {/* Modal for adding/editing contact */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
        >
          <View className="flex-1 justify-center items-center bg-black/50 px-4">
            <View className="bg-white rounded-2xl w-full max-w-md max-h-[88%]">
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 24 }}
              >
                <View className="items-center mb-6">
                  <View className="w-16 h-16 rounded-full bg-blue-50 justify-center items-center mb-3">
                    <MaterialCommunityIcons 
                      name={editingContact ? "account-edit" : "account-plus"} 
                      size={30} 
                      color="#2196F3" 
                    />
                  </View>
                  <Text className="text-xl font-bold text-dark">
                    {editingContact ? t('emergency.contacts.editCurrentContact') : t('emergency.contacts.addNewContact')}
                  </Text>
                </View>

                <TextInput
                  className="input-field mb-4"
                  placeholder={t('emergency.contacts.fullNamePlaceholder')}
                  value={formData.name}
                  onChangeText={text => setFormData({ ...formData, name: text })}
                  placeholderTextColor="#BDBDBD"
                  returnKeyType="next"
                />

                <TextInput
                  className="input-field mb-4"
                  placeholder={t('emergency.contacts.phonePlaceholder')}
                  value={formData.phone}
                  onChangeText={text => setFormData({ ...formData, phone: text })}
                  keyboardType="phone-pad"
                  placeholderTextColor="#BDBDBD"
                />

                {/* Priority Selection */}
                <View className="mb-6">
                  <Text className="text-base font-medium text-dark mb-3">{t('emergency.contacts.priorityLevel')}</Text>
                  <View className="flex-row justify-between">
                    {[
                      { value: 1, label: t('emergency.contacts.priorityHigh'), color: 'bg-danger', textColor: 'text-danger' },
                      { value: 2, label: t('emergency.contacts.priorityMedium'), color: 'bg-warning', textColor: 'text-warning' },
                      { value: 3, label: t('emergency.contacts.priorityLow'), color: 'bg-success', textColor: 'text-success' },
                    ].map((priority) => (
                      <TouchableOpacity
                        key={priority.value}
                        className={`flex-1 items-center py-3 rounded-lg mx-1 border ${
                          formData.priority === priority.value
                            ? `${priority.color} border-transparent`
                            : 'bg-white border-lightGray'
                        }`}
                        onPress={() => setFormData({ ...formData, priority: priority.value })}
                        activeOpacity={0.7}
                      >
                        <Text className={`
                          font-semibold
                          ${formData.priority === priority.value 
                            ? 'text-white' 
                            : priority.textColor
                          }
                        `}>
                          {priority.label}
                        </Text>
                        {formData.priority === priority.value && (
                          <MaterialCommunityIcons 
                            name="check" 
                            size={16} 
                            color="#FFFFFF" 
                            className="mt-1"
                          />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                  
                  <Text className="text-xs text-gray mt-2">
                    {formData.priority === 1 && t('emergency.contacts.priorityHighHint')}
                    {formData.priority === 2 && t('emergency.contacts.priorityMediumHint')}
                    {formData.priority === 3 && t('emergency.contacts.priorityLowHint')}
                  </Text>
                </View>

                {/* Relationship Selection */}
                <View className="mb-6">
                  <Text className="text-base font-medium text-dark mb-3">{t('emergency.contacts.relationshipLabel')}</Text>
                  <View className="flex-row flex-wrap justify-between">
                    {[
                      { value: 'family', label: t('emergency.contacts.family'), icon: 'account-group' },
                      { value: 'doctor', label: t('emergency.contacts.doctor'), icon: 'doctor' },
                      { value: 'friend', label: t('emergency.contacts.friend'), icon: 'account' },
                      { value: 'neighbor', label: t('emergency.contacts.neighbor'), icon: 'home' },
                    ].map((rel) => (
                      <TouchableOpacity
                        key={rel.value}
                        className={`w-[48%] p-3 mb-2 flex-row items-center rounded-lg ${
                          formData.relationship === rel.value
                            ? 'bg-blue-50 border border-primary'
                            : 'bg-lightGray/20 border border-lightGray'
                        }`}
                        onPress={() => setFormData({ ...formData, relationship: rel.value })}
                        activeOpacity={0.7}
                      >
                        <MaterialCommunityIcons 
                          name={rel.icon as React.ComponentProps<typeof MaterialCommunityIcons>['name']} 
                          size={20} 
                          color={formData.relationship === rel.value ? "#2196F3" : "#757575"} 
                        />
                        <Text className={`ml-2 ${
                          formData.relationship === rel.value
                            ? 'text-primary font-semibold'
                            : 'text-gray'
                        }`}>
                          {rel.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Action Buttons */}
                <View className="flex-row justify-between">
                  <TouchableOpacity
                    className="flex-1 bg-lightGray py-3 rounded-lg mr-2 items-center"
                    onPress={() => setModalVisible(false)}
                    activeOpacity={0.7}
                  >
                    <Text className="text-dark font-semibold">{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    className="flex-1 bg-primary py-3 rounded-lg ml-2 flex-row items-center justify-center"
                    onPress={handleSaveContact}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons 
                      name="content-save" 
                      size={20} 
                      color="#FFFFFF" 
                    />
                    <Text className="text-white font-bold ml-2">{t('common.save')}</Text>
                  </TouchableOpacity>
                </View>
                
                <Text className="text-xs text-center text-gray mt-4">
                  {t('emergency.contacts.notifyHint')}
                </Text>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal for importing phone contacts */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={importModalVisible}
        onRequestClose={() => setImportModalVisible(false)}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
        >
          <View className="flex-1 justify-center items-center bg-black/50 px-4">
            <View className="bg-white rounded-2xl w-full max-w-md max-h-[88%] p-6">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-lg font-bold text-dark">{t('emergency.contacts.import')}</Text>
                <TouchableOpacity onPress={() => setImportModalVisible(false)}>
                  <MaterialCommunityIcons name="close" size={22} color="#757575" />
                </TouchableOpacity>
              </View>

              <View className="mb-3">
                <TextInput
                  className="input-field"
                  placeholder={t('emergency.contacts.searchPlaceholder')}
                  value={contactSearch}
                  onChangeText={setContactSearch}
                  placeholderTextColor="#BDBDBD"
                />
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {phoneContacts
                  .filter((contact) => {
                    if (!contactSearch.trim()) return true;
                    const term = contactSearch.toLowerCase();
                    return (
                      (contact.name || '').toLowerCase().includes(term) ||
                      (editablePhones[contact.id] || contact.phone || '').toLowerCase().includes(term)
                    );
                  })
                  .map((contact) => {
                    const isSelected = selectedContactIds.has(contact.id);
                    return (
                      <View
                        key={`${contact.id}-${contact.phone}`}
                        className="py-3 border-b border-lightGray"
                      >
                        <TouchableOpacity
                          className="flex-row items-center"
                          onPress={() => handleToggleSelect(contact.id)}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons
                            name={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                            size={22}
                            color={isSelected ? '#2196F3' : '#9E9E9E'}
                          />
                          <Text className="text-base font-medium text-dark ml-3 flex-1">
                            {contact.name}
                          </Text>
                        </TouchableOpacity>

                        <TextInput
                          className="input-field mt-2"
                          value={editablePhones[contact.id] ?? contact.phone ?? ''}
                          onChangeText={(text) =>
                            setEditablePhones((prev) => ({ ...prev, [contact.id]: text }))
                          }
                          placeholder={t('emergency.contacts.phone')}
                          keyboardType="phone-pad"
                          placeholderTextColor="#BDBDBD"
                        />
                      </View>
                    );
                  })}
              </ScrollView>

              <View className="flex-row justify-between mt-4">
                <TouchableOpacity
                  className="flex-1 bg-lightGray py-3 rounded-lg mr-2 items-center"
                  onPress={() => setImportModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text className="text-dark font-semibold">{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-primary py-3 rounded-lg ml-2 items-center"
                  onPress={handleSaveSelectedContacts}
                  activeOpacity={0.7}
                >
                  <Text className="text-white font-bold">{t('emergency.contacts.addSelected')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};
