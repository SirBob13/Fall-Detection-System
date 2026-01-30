// src/screens/auth/RegisterScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

import { AUTH_CONFIG } from '../../constants/auth';
import { authService } from '../../services/auth.service';
import { RegisterData } from '../../types/auth';
import { COLORS } from '../../utils/constants';

type AuthStackParamList = {
  Login: { prefilledEmail?: string };
  Register: undefined;
  ForgotPassword: undefined;
};

type RegisterScreenNavigationProp = StackNavigationProp<AuthStackParamList, 'Register'>;

// Egyptian phone number validation function
const validateEgyptianPhone = (phone: string): boolean => {
  if (!phone) return false;
  const phoneRegex = /^(?:\+20|0)(1[0-2]|5)[0-9]{8}$/;
  return phoneRegex.test(phone);
};

// Registration data validation schema
const RegisterSchema = Yup.object().shape({
  name: Yup.string()
    .min(3, 'Name must be at least 3 characters')
    .required('Name is required'),
  email: Yup.string()
    .email('Invalid email address')
    .required('Email is required'),
  phone: Yup.string()
    .test(
      'egyptian-phone',
      'Please enter a valid Egyptian phone number',
      (value) => !value || validateEgyptianPhone(value)
    )
    .required('Phone number is required'),
  age: Yup.number()
    .min(18, 'Age must be at least 18 years')
    .max(120, 'Invalid age')
    .required('Age is required'),
  gender: Yup.string()
    .oneOf(['male', 'female'], 'Must select male or female')
    .required('Gender is required'),
  password: Yup.string()
    .min(8, 'Password must be at least 8 characters')
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Must contain uppercase, lowercase, and number'
    )
    .required('Password is required'),
  confirm_password: Yup.string()
    .oneOf([Yup.ref('password')], 'Passwords do not match')
    .required('Confirm password is required'),
  accept_terms: Yup.boolean()
    .oneOf([true], 'Must agree to terms and conditions')
    .required('Must agree to terms and conditions'),
});

export const RegisterScreen: React.FC = () => {
  const navigation = useNavigation<RegisterScreenNavigationProp>();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const genderOptions = [
    { value: 'male', label: 'Male', icon: 'male' },
    { value: 'female', label: 'Female', icon: 'female' }
  ];

  const handleRegister = async (values: RegisterData) => {
    try {
      setLoading(true);
      
      // Attempt registration
      const response = await authService.register(values);
      
      if (response.success) {
        Alert.alert(
          '🎉 Registration Successful!',
          'Your account has been created successfully. You can now login and use all app features.',
          [{ 
            text: 'Login', 
            onPress: () => navigation.navigate('Login' as never) 
          }]
        );
      } else {
        // User-friendly messages
        let userMessage = 'An error occurred during registration. Please try again.';
        
        if (response.message?.includes('already registered')) {
          userMessage = 'Email is already registered. You can login instead.';
        } else if (response.message?.includes('password')) {
          userMessage = 'Please use a stronger password (at least 8 characters, containing letters and numbers)';
        } else if (response.message?.includes('connection')) {
          userMessage = 'Unable to connect to server. Please check internet connection and try again.';
        }
        
        Alert.alert('⚠️ Notice', userMessage);
      }
    } catch (error) {
      console.error('Technical error:', error);
      Alert.alert(
        'Sorry',
        'Could not complete the process at this time. Please try again later.'
      );
    } finally {
      setLoading(false);
    }
  };

  const openTerms = () => {
    Alert.alert(
      'Terms and Conditions',
      'By using this app, you agree to:\n\n' +
      '• Use the app for medical and personal safety purposes\n' +
      '• Keep your data secure and not share it without your permission\n' +
      '• Follow safe usage instructions\n\n' +
      'We are committed to protecting your privacy and providing reliable service.',
      [{ text: 'Understood' }]
    );
  };

  const openPrivacyPolicy = () => {
    Alert.alert(
      'Your Privacy Matters',
      'We respect your privacy and are committed to protecting your data:\n\n' +
      '• We store your data securely and encrypted\n' +
      '• We do not share your data with third parties\n' +
      '• You can delete your account at any time\n' +
      '• You have the right to access and correct your data\n\n' +
      'For more details, you can contact us.',
      [{ text: 'Thank you' }]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Enhanced Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <MaterialIcons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            
            <View style={styles.headerContent}>
              <View style={styles.logoContainer}>
                <MaterialIcons name="shield" size={40} color={COLORS.primary} />
                <Text style={styles.logoText}>SafeGuard</Text>
              </View>
              
              <Text style={styles.title}>Join Us</Text>
              <Text style={styles.subtitle}>
                Create an account to start using the smart fall detection system
              </Text>
              
              <View style={styles.benefitsContainer}>
                <View style={styles.benefitItem}>
                  <MaterialIcons name="security" size={16} color={COLORS.success} />
                  <Text style={styles.benefitText}>24/7 Protection</Text>
                </View>
                <View style={styles.benefitItem}>
                  <MaterialIcons name="notifications-active" size={16} color={COLORS.primary} />
                  <Text style={styles.benefitText}>Instant Alerts</Text>
                </View>
                <View style={styles.benefitItem}>
                  <MaterialIcons name="support-agent" size={16} color={COLORS.info} />
                  <Text style={styles.benefitText}>Continuous Support</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Registration Form */}
          <Formik
            initialValues={{
              name: '',
              email: '',
              phone: '',
              age: '',
              gender: '',
              password: '',
              confirm_password: '',
              weight: '',
              height: '',
              medical_conditions: '',
              emergency_contact: '',
              accept_terms: false,
            }}
            validationSchema={RegisterSchema}
            onSubmit={handleRegister}
          >
            {({
              handleChange,
              handleBlur,
              handleSubmit,
              values,
              errors,
              touched,
              setFieldValue,
              isValid,
              dirty,
            }) => (
              <View style={styles.formContainer}>
                {/* Basic Information */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Basic Information</Text>
                  
                  {/* Name Field */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Full Name</Text>
                    <TextInput
                      style={[
                        styles.input,
                        errors.name && touched.name && styles.inputError,
                      ]}
                      placeholder="Enter your full name"
                      placeholderTextColor="#999"
                      value={values.name}
                      onChangeText={handleChange('name')}
                      onBlur={handleBlur('name')}
                      editable={!loading}
                    />
                    {errors.name && touched.name && (
                      <Text style={styles.errorText}>{errors.name}</Text>
                    )}
                  </View>

                  {/* Email Field */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Email</Text>
                    <TextInput
                      style={[
                        styles.input,
                        errors.email && touched.email && styles.inputError,
                      ]}
                      placeholder="example@email.com"
                      placeholderTextColor="#999"
                      value={values.email}
                      onChangeText={handleChange('email')}
                      onBlur={handleBlur('email')}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      editable={!loading}
                    />
                    {errors.email && touched.email && (
                      <Text style={styles.errorText}>{errors.email}</Text>
                    )}
                  </View>

                  {/* Phone Field */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Phone Number</Text>
                    <TextInput
                      style={[
                        styles.input,
                        errors.phone && touched.phone && styles.inputError,
                      ]}
                      placeholder="01012345678"
                      placeholderTextColor="#999"
                      value={values.phone}
                      onChangeText={handleChange('phone')}
                      onBlur={handleBlur('phone')}
                      keyboardType="phone-pad"
                      editable={!loading}
                    />
                    {errors.phone && touched.phone && (
                      <Text style={styles.errorText}>{errors.phone}</Text>
                    )}
                    <Text style={styles.inputHint}>
                      📱 Enter your phone number (starts with 010, 011, 012, or 015)
                    </Text>
                  </View>

                  {/* Age and Gender in one row */}
                  <View style={styles.row}>
                    <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                      <Text style={styles.inputLabel}>Age</Text>
                      <TextInput
                        style={[
                          styles.input,
                          errors.age && touched.age && styles.inputError,
                        ]}
                        placeholder="30"
                        placeholderTextColor="#999"
                        value={values.age}
                        onChangeText={handleChange('age')}
                        onBlur={handleBlur('age')}
                        keyboardType="numeric"
                        editable={!loading}
                      />
                      {errors.age && touched.age && (
                        <Text style={styles.errorText}>{errors.age}</Text>
                      )}
                    </View>

                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.inputLabel}>Gender</Text>
                      <View style={styles.genderButtons}>
                        {genderOptions.map((gender) => (
                          <TouchableOpacity
                            key={gender.value}
                            style={[
                              styles.genderButton,
                              values.gender === gender.value && styles.genderButtonActive,
                            ]}
                            onPress={() => setFieldValue('gender', gender.value)}
                            disabled={loading}
                          >
                            <MaterialIcons 
                              name={gender.icon as any} 
                              size={16} 
                              color={values.gender === gender.value ? '#FFF' : COLORS.gray} 
                            />
                            <Text style={[
                              styles.genderButtonText,
                              values.gender === gender.value && styles.genderButtonTextActive,
                            ]}>
                              {gender.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {errors.gender && touched.gender && (
                        <Text style={styles.errorText}>{errors.gender}</Text>
                      )}
                    </View>
                  </View>
                </View>

                {/* Password */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Password</Text>
                  
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Password</Text>
                    <View style={styles.passwordWrapper}>
                      <TextInput
                        style={[
                          styles.input,
                          styles.passwordInput,
                          errors.password && touched.password && styles.inputError,
                        ]}
                        placeholder="••••••••"
                        placeholderTextColor="#999"
                        value={values.password}
                        onChangeText={handleChange('password')}
                        onBlur={handleBlur('password')}
                        secureTextEntry={!showPassword}
                        editable={!loading}
                      />
                      <TouchableOpacity
                        style={styles.eyeButton}
                        onPress={() => setShowPassword(!showPassword)}
                      >
                        <MaterialIcons
                          name={showPassword ? 'visibility-off' : 'visibility'}
                          size={20}
                          color="#666"
                        />
                      </TouchableOpacity>
                    </View>
                    {errors.password && touched.password && (
                      <Text style={styles.errorText}>{errors.password}</Text>
                    )}
                    <Text style={styles.inputHint}>
                      🔒 Must contain at least 8 characters, uppercase, lowercase and number
                    </Text>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Confirm Password</Text>
                    <View style={styles.passwordWrapper}>
                      <TextInput
                        style={[
                          styles.input,
                          styles.passwordInput,
                          errors.confirm_password && touched.confirm_password && styles.inputError,
                        ]}
                        placeholder="••••••••"
                        placeholderTextColor="#999"
                        value={values.confirm_password}
                        onChangeText={handleChange('confirm_password')}
                        onBlur={handleBlur('confirm_password')}
                        secureTextEntry={!showConfirmPassword}
                        editable={!loading}
                      />
                      <TouchableOpacity
                        style={styles.eyeButton}
                        onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      >
                        <MaterialIcons
                          name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                          size={20}
                          color="#666"
                        />
                      </TouchableOpacity>
                    </View>
                    {errors.confirm_password && touched.confirm_password && (
                      <Text style={styles.errorText}>{errors.confirm_password}</Text>
                    )}
                  </View>
                </View>

                {/* Additional Information */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Additional Information</Text>
                    <Text style={styles.optionalBadge}>Optional</Text>
                  </View>
                  
                  <Text style={styles.sectionDescription}>
                    This information helps us provide better service for you
                  </Text>
                  
                  <View style={styles.row}>
                    <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                      <Text style={styles.inputLabel}>Height (cm)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="170"
                        placeholderTextColor="#999"
                        value={values.height}
                        onChangeText={handleChange('height')}
                        onBlur={handleBlur('height')}
                        keyboardType="numeric"
                        editable={!loading}
                      />
                    </View>
                    
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.inputLabel}>Weight (kg)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="70"
                        placeholderTextColor="#999"
                        value={values.weight}
                        onChangeText={handleChange('weight')}
                        onBlur={handleBlur('weight')}
                        keyboardType="numeric"
                        editable={!loading}
                      />
                    </View>
                  </View>
                  
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Emergency Contact</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Emergency phone number"
                      placeholderTextColor="#999"
                      value={values.emergency_contact}
                      onChangeText={handleChange('emergency_contact')}
                      onBlur={handleBlur('emergency_contact')}
                      keyboardType="phone-pad"
                      editable={!loading}
                    />
                    <Text style={styles.inputHint}>
                      👨‍👩‍👧‍👦 This number will be contacted in case of emergency
                    </Text>
                  </View>
                  
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Medical Conditions</Text>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="High blood pressure, diabetes, etc..."
                      placeholderTextColor="#999"
                      value={values.medical_conditions}
                      onChangeText={handleChange('medical_conditions')}
                      onBlur={handleBlur('medical_conditions')}
                      editable={!loading}
                      multiline
                      numberOfLines={3}
                    />
                  </View>
                </View>

                {/* Terms */}
                <View style={styles.termsContainer}>
                  <TouchableOpacity
                    style={styles.checkboxContainer}
                    onPress={() => setFieldValue('accept_terms', !values.accept_terms)}
                    disabled={loading}
                  >
                    <View style={[
                      styles.checkbox,
                      values.accept_terms && styles.checkboxChecked
                    ]}>
                      {values.accept_terms && (
                        <MaterialIcons name="check" size={14} color="#FFF" />
                      )}
                    </View>
                    <View style={styles.termsTextContainer}>
                      <Text style={styles.termsText}>
                        I agree to the{' '}
                        <Text style={styles.termsLink} onPress={openTerms}>
                          Terms and Conditions
                        </Text>{' '}
                        and{' '}
                        <Text style={styles.termsLink} onPress={openPrivacyPolicy}>
                          Privacy Policy
                        </Text>
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {errors.accept_terms && touched.accept_terms && (
                    <Text style={styles.errorText}>{errors.accept_terms}</Text>
                  )}
                </View>

                {/* Register Button */}
                <TouchableOpacity
                  style={[
                    styles.registerButton,
                    (!isValid || !dirty || loading) && styles.registerButtonDisabled,
                  ]}
                  onPress={() => handleSubmit()}
                  disabled={!isValid || !dirty || loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="person-add" size={24} color="#FFF" />
                      <Text style={styles.registerButtonText}>Create New Account</Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Security Info */}
                <View style={styles.securityInfo}>
                  <MaterialIcons name="verified-user" size={20} color={COLORS.success} />
                  <Text style={styles.securityText}>
                    All your data is protected and encrypted with highest security standards
                  </Text>
                </View>
              </View>
            )}
          </Formik>

          {/* Login Link */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.footerLink}>Login</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 30,
  },
  header: {
    backgroundColor: '#F8FAFF',
    paddingTop: 20,
    paddingBottom: 30,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    marginBottom: 20,
  },
  backButton: {
    padding: 10,
    marginLeft: 10,
    marginBottom: 10,
  },
  headerContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  logoText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginLeft: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 20,
  },
  benefitsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginHorizontal: 5,
    marginVertical: 3,
  },
  benefitText: {
    fontSize: 12,
    color: '#333',
    marginLeft: 6,
    fontWeight: '500',
  },
  formContainer: {
    paddingHorizontal: 20,
  },
  section: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  optionalBadge: {
    fontSize: 12,
    color: COLORS.gray,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#FAFAFA',
  },
  inputError: {
    borderColor: COLORS.danger,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 14,
    marginTop: 6,
  },
  inputHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 6,
    fontStyle: 'italic',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  genderButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  genderButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginHorizontal: 4,
    backgroundColor: '#FAFAFA',
  },
  genderButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  genderButtonText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
  },
  genderButtonTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  passwordWrapper: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 50,
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    padding: 4,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  termsContainer: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.primary,
    marginRight: 12,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
  },
  termsTextContainer: {
    flex: 1,
  },
  termsText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  termsLink: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  registerButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  registerButtonDisabled: {
    backgroundColor: '#CCC',
    opacity: 0.7,
  },
  registerButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  securityInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  securityText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    marginLeft: 12,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    marginTop: 10,
  },
  footerText: {
    fontSize: 16,
    color: '#666',
    marginRight: 8,
  },
  footerLink: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: 'bold',
  },
});