import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { emergencyService } from '../services/emergency.service';
import { EmergencyContact } from '../services/emergency.types';
import { useLanguage } from '../components/LanguageProvider';
import { storageService } from '../services/storage';
import { useNavigation } from '@react-navigation/native';
import { User } from '../types';

export const EmergencyContactsScreen: React.FC = () => {
  const { t } = useLanguage();
  const navigation = useNavigation<any>();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<EmergencyContact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [editablePhones, setEditablePhones] = useState<Record<string, string>>({});
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [monitoredUser, setMonitoredUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    relationship: 'family',
    priority: 3,
    is_active: true,
  });

  useEffect(() => {
    loadContacts();
    loadContext();
  }, []);

  const loadContacts = async () => {
    try {
      setIsLoading(true);
      const data = await emergencyService.getEmergencyContacts();
      setContacts(data);
    } catch (error) {
      console.error('Error loading contacts:', error);
      Alert.alert('Error', 'Failed to load contacts');
    } finally {
      setIsLoading(false);
    }
  };

  const loadContext = async () => {
    const storedUser = await storageService.getUser();
    const storedMonitored = await storageService.getMonitoredUser();
    setUser(storedUser);
    setMonitoredUser(storedMonitored);
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

  const handleOpenChat = () => {
    if (!monitoredUser) {
      Alert.alert(t('common.error'), t('emergency.communicationNoUser'));
      return;
    }
    navigation.getParent?.()?.navigate?.('Settings', {
      screen: 'Chat',
      params: {
        patientId: monitoredUser.id,
        patientName: monitoredUser.name,
      },
    });
  };

  const handleOpenVideo = () => {
    if (!user && !monitoredUser) {
      Alert.alert(t('common.error'), t('errors.loginRequired'));
      return;
    }
    const targetId = monitoredUser?.id || user?.id || 0;
    navigation.getParent?.()?.navigate?.('Settings', {
      screen: 'VideoCall',
      params: {
        channel: `emergency-${targetId}`,
        title: t('video.emergencyTitle'),
      },
    });
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
      Alert.alert('Error', 'Name and phone number are required');
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
        Alert.alert('Success', 'Contact updated successfully');
      } else {
        // Add new contact
        await emergencyService.addEmergencyContact(formData);
        Alert.alert('Success', 'Contact added successfully');
      }
      
      setModalVisible(false);
      loadContacts();
    } catch (error) {
      console.error('Error saving contact:', error);
      Alert.alert('Error', 'Failed to save contact');
    }
  };

  const handleDeleteContact = (contactId: string) => {
    Alert.alert(
      'Delete Contact',
      'Are you sure you want to delete this contact?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const updatedContacts = contacts.filter(c => c.id !== contactId);
              await emergencyService.saveEmergencyContacts(updatedContacts);
              loadContacts();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete contact');
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

  const handleImportContacts = async () => {
    try {
      Alert.alert(
        'Import Contacts',
        'Will import contacts from your phone. Do you want to proceed?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: async () => {
              const importedContacts = await emergencyService.importPhoneContacts();
              if (importedContacts.length > 0) {
                setPhoneContacts(importedContacts);
                setSelectedContactIds(new Set());
                setEditablePhones(
                  importedContacts.reduce<Record<string, string>>((acc, contact) => {
                    acc[contact.id] = contact.phone || '';
                    return acc;
                  }, {})
                );
                setContactSearch('');
                setImportModalVisible(true);
              } else {
                Alert.alert('Note', 'No contacts found to import');
              }
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to import contacts');
    }
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
      Alert.alert('Note', 'Select at least one contact');
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
          name: contact.name || 'Contact',
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
      Alert.alert('Success', 'Contacts added from phone');
    } catch (error) {
      Alert.alert('Error', 'Failed to add contacts');
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return '#F44336'; // High - Red
      case 2: return '#FF9800'; // Medium - Orange
      case 3: return '#4CAF50'; // Low - Green
      default: return '#9E9E9E'; // Default - Gray
    }
  };

  const getPriorityText = (priority: number) => {
    switch (priority) {
      case 1: return 'High';
      case 2: return 'Medium';
      case 3: return 'Low';
      default: return 'Normal';
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
        <Text className="mt-4 text-base text-gray">{t('common.loading')}</Text>
        <ActivityIndicator color="#2196F3" size="large" className="mt-4" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-light">
      {/* Header */}
      <View className="bg-white pb-4 border-b border-lightGray">
        <View className="pt-8 px-5">
          <Text className="text-2xl font-bold text-dark">{t('emergency.contacts.title')}</Text>
          <Text className="text-sm text-gray mt-1">
            {t('emergency.contacts.description')}
          </Text>
        </View>
        
        {/* Quick Stats */}
        <View className="flex-row justify-between mt-4 px-5">
          <View className="items-center">
            <Text className="text-2xl font-bold text-dark">{contacts.length}</Text>
            <Text className="text-xs text-gray">{t('emergency.contacts.total')}</Text>
          </View>
          
          <View className="items-center">
            <Text className="text-2xl font-bold text-dark">
              {contacts.filter(c => c.is_active).length}
            </Text>
            <Text className="text-xs text-gray">{t('emergency.contacts.active')}</Text>
          </View>
          
          <View className="items-center">
            <Text className="text-2xl font-bold text-dark">
              {contacts.filter(c => c.priority === 1).length}
            </Text>
            <Text className="text-xs text-gray">{t('emergency.contacts.highPriority')}</Text>
          </View>
        </View>
      </View>

      {/* Communication Section */}
      <View className="mx-5 mt-4 bg-white rounded-2xl shadow-lg border border-lightGray p-4">
        <Text className="text-base font-semibold text-dark mb-2">{t('emergency.communicationTitle')}</Text>
        <Text className="text-xs text-gray mb-3">{t('emergency.communicationDesc')}</Text>

        <TouchableOpacity
          className="flex-row items-center justify-center py-3 rounded-xl bg-primary mb-3"
          onPress={handleOpenVideo}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="video" size={18} color="#FFF" />
          <Text className="text-white font-semibold ml-2">{t('emergency.videoCall')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="flex-row items-center justify-center py-3 rounded-xl bg-dark"
          onPress={handleOpenChat}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="message-text" size={18} color="#FFF" />
          <Text className="text-white font-semibold ml-2">{t('emergency.openChat')}</Text>
        </TouchableOpacity>
      </View>

      {/* Contacts List */}
      <ScrollView className="flex-1 p-4" showsVerticalScrollIndicator={false}>
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
                    <Text className="text-base font-semibold text-dark">{contact.name}</Text>
                    <Text className="text-sm text-primary mt-1">{contact.phone}</Text>
                    <View className="flex-row items-center mt-1">
                      <Text className="text-xs text-gray">
                        {getRelationshipText(contact.relationship)}
                      </Text>
                      <View className="w-1 h-1 rounded-full bg-gray mx-2" />
                      <Text className={`text-xs ${
                        contact.is_active ? 'text-success' : 'text-gray'
                      }`}>
                        {contact.is_active ? 'Active' : 'Inactive'}
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
                  <Text className="text-sm font-medium text-primary ml-1">Edit</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  className="flex-row items-center px-3 py-1.5 bg-red-50 rounded-lg"
                  onPress={() => handleDeleteContact(contact.id)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="delete" size={16} color="#F44336" />
                  <Text className="text-sm font-medium text-danger ml-1">Delete</Text>
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
              <Text className="text-base font-semibold text-dark ml-2">Tips</Text>
            </View>
            <Text className="text-sm text-gray">
              • High priority contacts are called first in emergencies
            </Text>
            <Text className="text-sm text-gray mt-1">
              • Keep at least 2-3 active contacts
            </Text>
            <Text className="text-sm text-gray mt-1">
              • Inform your contacts about their emergency role
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
          <Text className="text-white font-semibold ml-2">Import from Phone</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          className="flex-row items-center justify-center py-4 px-4 bg-primary rounded-xl shadow-button"
          onPress={handleAddContact}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="plus" size={24} color="#FFFFFF" />
          <Text className="text-white font-bold text-lg ml-2">Add New Contact</Text>
        </TouchableOpacity>
      </View>

      {/* Modal for adding/editing contact */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/50">
          <View className="bg-white rounded-2xl w-11/12 max-w-md p-6">
            <View className="items-center mb-6">
              <View className="w-16 h-16 rounded-full bg-blue-50 justify-center items-center mb-3">
                <MaterialCommunityIcons 
                  name={editingContact ? "account-edit" : "account-plus"} 
                  size={30} 
                  color="#2196F3" 
                />
              </View>
              <Text className="text-xl font-bold text-dark">
                {editingContact ? 'Edit Contact' : 'Add New Contact'}
              </Text>
            </View>

            <TextInput
              className="input-field mb-4"
              placeholder="Full Name"
              value={formData.name}
              onChangeText={text => setFormData({ ...formData, name: text })}
              placeholderTextColor="#BDBDBD"
            />

            <TextInput
              className="input-field mb-4"
              placeholder="Phone Number (e.g., +201234567890)"
              value={formData.phone}
              onChangeText={text => setFormData({ ...formData, phone: text })}
              keyboardType="phone-pad"
              placeholderTextColor="#BDBDBD"
            />

            {/* Priority Selection */}
            <View className="mb-6">
              <Text className="text-base font-medium text-dark mb-3">Priority Level</Text>
              <View className="flex-row justify-between">
                {[
                  { value: 1, label: 'High', color: 'bg-danger', textColor: 'text-danger' },
                  { value: 2, label: 'Medium', color: 'bg-warning', textColor: 'text-warning' },
                  { value: 3, label: 'Low', color: 'bg-success', textColor: 'text-success' },
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
              
              {/* Priority Description */}
              <Text className="text-xs text-gray mt-2">
                {formData.priority === 1 && 'High: Called first in emergencies'}
                {formData.priority === 2 && 'Medium: Called if high priority fails'}
                {formData.priority === 3 && 'Low: Called as last resort'}
              </Text>
            </View>

            {/* Relationship Selection */}
            <View className="mb-6">
              <Text className="text-base font-medium text-dark mb-3">Relationship</Text>
              <View className="flex-row flex-wrap justify-between">
                {[
                  { value: 'family', label: 'Family', icon: 'account-group' },
                  { value: 'doctor', label: 'Doctor', icon: 'doctor' },
                  { value: 'friend', label: 'Friend', icon: 'account' },
                  { value: 'neighbor', label: 'Neighbor', icon: 'home' },
                ].map((rel) => (
                  <TouchableOpacity
                    key={rel.value}
                    className={`w-1/2 p-3 mb-2 flex-row items-center rounded-lg ${
                      formData.relationship === rel.value
                        ? 'bg-blue-50 border border-primary'
                        : 'bg-lightGray/20 border border-lightGray'
                    }`}
                    onPress={() => setFormData({ ...formData, relationship: rel.value })}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons 
                      name={rel.icon} 
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
                <Text className="text-dark font-semibold">Cancel</Text>
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
                <Text className="text-white font-bold ml-2">Save</Text>
              </TouchableOpacity>
            </View>
            
            {/* Footer Note */}
            <Text className="text-xs text-center text-gray mt-4">
              This contact will be notified during emergency situations
            </Text>
          </View>
        </View>
      </Modal>

      {/* Modal for importing phone contacts */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={importModalVisible}
        onRequestClose={() => setImportModalVisible(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/50">
          <View className="bg-white rounded-2xl w-11/12 max-w-md p-6 max-h-[80%]">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-lg font-bold text-dark">Select a contact</Text>
              <TouchableOpacity onPress={() => setImportModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={22} color="#757575" />
              </TouchableOpacity>
            </View>

            <View className="mb-3">
              <TextInput
                className="input-field"
                placeholder="Search contacts"
                value={contactSearch}
                onChangeText={setContactSearch}
                placeholderTextColor="#BDBDBD"
              />
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
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
                        placeholder="Phone Number"
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
                <Text className="text-dark font-semibold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-primary py-3 rounded-lg ml-2 items-center"
                onPress={handleSaveSelectedContacts}
                activeOpacity={0.7}
              >
                <Text className="text-white font-bold">Add Selected</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};
