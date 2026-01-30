import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  TextInput,
  Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { emergencyService } from '../services/emergency.service';
import { EmergencyContact } from '../services/emergency.types';
import { COLORS } from '../utils/constants';

export const EmergencyContactsScreen: React.FC = () => {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    relationship: 'family',
    priority: 3,
    is_active: true,
  });

  useEffect(() => {
    loadContacts();
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
                Alert.alert(
                  'Import Successful',
                  `Imported ${importedContacts.length} contacts`
                );
                // Can display them for selection
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

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return '#F44336';
      case 2: return '#FF9800';
      case 3: return '#4CAF50';
      default: return '#9E9E9E';
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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <MaterialCommunityIcons name="account-group" size={60} color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading contacts...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Emergency Contacts</Text>
        <Text style={styles.subtitle}>
          These numbers will be contacted in case of emergency
        </Text>
      </View>

      <ScrollView style={styles.contactsList}>
        {contacts.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="account-alert" size={80} color={COLORS.gray} />
            <Text style={styles.emptyStateText}>No contacts</Text>
            <Text style={styles.emptyStateSubtext}>
              Add contacts for use in emergency situations
            </Text>
          </View>
        ) : (
          contacts.map(contact => (
            <View key={contact.id} style={styles.contactCard}>
              <View style={styles.contactHeader}>
                <View style={styles.contactInfo}>
                  <View style={[
                    styles.priorityBadge,
                    { backgroundColor: getPriorityColor(contact.priority) }
                  ]}>
                    <Text style={styles.priorityText}>
                      {contact.priority === 1 ? 'High' : 
                       contact.priority === 2 ? 'Medium' : 'Low'}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={getRelationshipIcon(contact.relationship)}
                    size={24}
                    color={COLORS.primary}
                    style={styles.relationshipIcon}
                  />
                  <View>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.contactPhone}>{contact.phone}</Text>
                    <Text style={styles.contactRelationship}>
                      {contact.relationship === 'family' && 'Family'}
                      {contact.relationship === 'doctor' && 'Doctor'}
                      {contact.relationship === 'friend' && 'Friend'}
                      {contact.relationship === 'neighbor' && 'Neighbor'}
                    </Text>
                  </View>
                </View>
                
                <Switch
                  value={contact.is_active}
                  onValueChange={() => handleToggleActive(contact.id, contact.is_active)}
                  trackColor={{ false: '#767577', true: COLORS.primary }}
                />
              </View>

              <View style={styles.contactActions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleEditContact(contact)}
                >
                  <MaterialCommunityIcons name="pencil" size={20} color={COLORS.primary} />
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.actionButton, styles.deleteButton]}
                  onPress={() => handleDeleteContact(contact.id)}
                >
                  <MaterialCommunityIcons name="delete" size={20} color={COLORS.danger} />
                  <Text style={[styles.actionText, { color: COLORS.danger }]}>
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.importButton}
          onPress={handleImportContacts}
        >
          <MaterialCommunityIcons name="import" size={20} color="#FFF" />
          <Text style={styles.importButtonText}>Import from phone</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.addButton}
          onPress={handleAddContact}
        >
          <MaterialCommunityIcons name="plus" size={24} color="#FFF" />
          <Text style={styles.addButtonText}>Add Contact</Text>
        </TouchableOpacity>
      </View>

      {/* Modal for adding/editing contact */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingContact ? 'Edit Contact' : 'Add New Contact'}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Name"
              value={formData.name}
              onChangeText={text => setFormData({ ...formData, name: text })}
            />

            <TextInput
              style={styles.input}
              placeholder="Phone Number"
              value={formData.phone}
              onChangeText={text => setFormData({ ...formData, phone: text })}
              keyboardType="phone-pad"
            />

            <View style={styles.priorityContainer}>
              <Text style={styles.label}>Priority:</Text>
              <View style={styles.priorityButtons}>
                {[1, 2, 3].map(priority => (
                  <TouchableOpacity
                    key={priority}
                    style={[
                      styles.priorityButton,
                      formData.priority === priority && styles.priorityButtonActive
                    ]}
                    onPress={() => setFormData({ ...formData, priority })}
                  >
                    <Text style={[
                      styles.priorityButtonText,
                      formData.priority === priority && styles.priorityButtonTextActive
                    ]}>
                      {priority === 1 ? 'High' : 
                       priority === 2 ? 'Medium' : 'Low'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSaveContact}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  header: {
    padding: 20,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.gray,
  },
  contactsList: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 18,
    color: COLORS.gray,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: COLORS.lightGray,
    textAlign: 'center',
  },
  contactCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  contactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  contactInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 12,
  },
  priorityText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  relationshipIcon: {
    marginRight: 12,
  },
  contactName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 2,
  },
  contactPhone: {
    fontSize: 14,
    color: COLORS.primary,
    marginBottom: 2,
  },
  contactRelationship: {
    fontSize: 12,
    color: COLORS.gray,
  },
  contactActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: COLORS.lightGray,
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16,
  },
  deleteButton: {
    marginLeft: 16,
  },
  actionText: {
    marginLeft: 4,
    fontSize: 14,
    color: COLORS.primary,
  },
  footer: {
    padding: 16,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.lightGray,
  },
  importButton: {
    backgroundColor: COLORS.info,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  importButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  addButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.dark,
    marginBottom: 16,
  },
  priorityContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    color: COLORS.dark,
    marginBottom: 8,
  },
  priorityButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  priorityButton: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  priorityButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  priorityButtonText: {
    color: COLORS.dark,
    fontSize: 14,
    fontWeight: '500',
  },
  priorityButtonTextActive: {
    color: '#FFF',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: COLORS.lightGray,
    marginRight: 8,
  },
  cancelButtonText: {
    color: COLORS.dark,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    marginLeft: 8,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});