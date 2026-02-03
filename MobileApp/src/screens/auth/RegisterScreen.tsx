import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

import { authService } from '../../services/auth.service';
import { RegisterData } from '../../types/auth';

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
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 30 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Enhanced Header */}
          <View className="bg-blue-50 pt-5 pb-8 rounded-b-3xl">
            <TouchableOpacity
              className="p-3 ml-2 mb-2"
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <MaterialIcons name="arrow-back" size={24} color="#212121" />
            </TouchableOpacity>
            
            <View className="items-center px-5">
              <View className="flex-row items-center mb-4">
                <View className="w-14 h-14 rounded-full bg-white shadow-md justify-center items-center mr-3">
                  <MaterialIcons name="shield" size={30} color="#2196F3" />
                </View>
                <Text className="text-3xl font-bold text-primary">SafeGuard</Text>
              </View>
              
              <Text className="text-2xl font-bold text-dark mb-3">Join Our Community</Text>
              <Text className="text-base text-gray text-center leading-6 max-w-md mb-6">
                Create an account to access smart fall detection and emergency response features
              </Text>
              
              {/* Benefits Badges */}
              <View className="flex-row flex-wrap justify-center gap-2">
                <View className="flex-row items-center bg-white px-4 py-2 rounded-full shadow-sm">
                  <MaterialIcons name="security" size={16} color="#4CAF50" />
                  <Text className="text-sm text-dark ml-2 font-medium">24/7 Protection</Text>
                </View>
                <View className="flex-row items-center bg-white px-4 py-2 rounded-full shadow-sm">
                  <MaterialIcons name="notifications-active" size={16} color="#2196F3" />
                  <Text className="text-sm text-dark ml-2 font-medium">Instant Alerts</Text>
                </View>
                <View className="flex-row items-center bg-white px-4 py-2 rounded-full shadow-sm">
                  <MaterialIcons name="support-agent" size={16} color="#00BCD4" />
                  <Text className="text-sm text-dark ml-2 font-medium">Continuous Support</Text>
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
              <View className="px-5 mt-6">
                {/* Basic Information Section */}
                <View className="card mb-4">
                  <Text className="section-title mb-6">Basic Information</Text>
                  
                  {/* Name Field */}
                  <View className="mb-5">
                    <Text className="input-label">Full Name</Text>
                    <TextInput
                      className={`input-field ${errors.name && touched.name ? 'border-danger' : ''}`}
                      placeholder="Enter your full name"
                      placeholderTextColor="#BDBDBD"
                      value={values.name}
                      onChangeText={handleChange('name')}
                      onBlur={handleBlur('name')}
                      editable={!loading}
                    />
                    {errors.name && touched.name && (
                      <Text className="error-text">{errors.name}</Text>
                    )}
                  </View>

                  {/* Email Field */}
                  <View className="mb-5">
                    <Text className="input-label">Email Address</Text>
                    <TextInput
                      className={`input-field ${errors.email && touched.email ? 'border-danger' : ''}`}
                      placeholder="example@email.com"
                      placeholderTextColor="#BDBDBD"
                      value={values.email}
                      onChangeText={handleChange('email')}
                      onBlur={handleBlur('email')}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      editable={!loading}
                    />
                    {errors.email && touched.email && (
                      <Text className="error-text">{errors.email}</Text>
                    )}
                  </View>

                  {/* Phone Field */}
                  <View className="mb-5">
                    <Text className="input-label">Phone Number</Text>
                    <TextInput
                      className={`input-field ${errors.phone && touched.phone ? 'border-danger' : ''}`}
                      placeholder="01012345678"
                      placeholderTextColor="#BDBDBD"
                      value={values.phone}
                      onChangeText={handleChange('phone')}
                      onBlur={handleBlur('phone')}
                      keyboardType="phone-pad"
                      editable={!loading}
                    />
                    {errors.phone && touched.phone && (
                      <Text className="error-text">{errors.phone}</Text>
                    )}
                    <Text className="text-xs text-gray mt-2">
                      📱 Egyptian number (starts with 010, 011, 012, or 015)
                    </Text>
                  </View>

                  {/* Age and Gender Row */}
                  <View className="flex-row mb-5">
                    <View className="flex-1 mr-2">
                      <Text className="input-label">Age</Text>
                      <TextInput
                        className={`input-field ${errors.age && touched.age ? 'border-danger' : ''}`}
                        placeholder="30"
                        placeholderTextColor="#BDBDBD"
                        value={values.age}
                        onChangeText={handleChange('age')}
                        onBlur={handleBlur('age')}
                        keyboardType="numeric"
                        editable={!loading}
                      />
                      {errors.age && touched.age && (
                        <Text className="error-text">{errors.age}</Text>
                      )}
                    </View>

                    <View className="flex-1 ml-2">
                      <Text className="input-label">Gender</Text>
                      <View className="flex-row">
                        {genderOptions.map((gender) => (
                          <TouchableOpacity
                            key={gender.value}
                            className={`flex-1 flex-row items-center justify-center py-3 mx-1 rounded-lg border ${
                              values.gender === gender.value
                                ? 'bg-primary border-primary'
                                : 'bg-light border-lightGray'
                            }`}
                            onPress={() => setFieldValue('gender', gender.value)}
                            disabled={loading}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons 
                              name={gender.icon as any} 
                              size={16} 
                              color={values.gender === gender.value ? '#FFFFFF' : '#757575'} 
                            />
                            <Text className={`ml-2 text-sm font-medium ${
                              values.gender === gender.value ? 'text-white' : 'text-dark'
                            }`}>
                              {gender.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {errors.gender && touched.gender && (
                        <Text className="error-text">{errors.gender}</Text>
                      )}
                    </View>
                  </View>
                </View>

                {/* Password Section */}
                <View className="card mb-4">
                  <Text className="section-title mb-6">Password</Text>
                  
                  {/* Password Field */}
                  <View className="mb-5">
                    <Text className="input-label">Create Password</Text>
                    <View className="relative">
                      <TextInput
                        className={`input-field pr-12 ${
                          errors.password && touched.password ? 'border-danger' : ''
                        }`}
                        placeholder="••••••••"
                        placeholderTextColor="#BDBDBD"
                        value={values.password}
                        onChangeText={handleChange('password')}
                        onBlur={handleBlur('password')}
                        secureTextEntry={!showPassword}
                        editable={!loading}
                      />
                      <TouchableOpacity
                        className="absolute right-4 top-4"
                        onPress={() => setShowPassword(!showPassword)}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons
                          name={showPassword ? 'visibility-off' : 'visibility'}
                          size={22}
                          color="#666"
                        />
                      </TouchableOpacity>
                    </View>
                    {errors.password && touched.password && (
                      <Text className="error-text">{errors.password}</Text>
                    )}
                    <Text className="text-xs text-gray mt-2">
                      🔒 Must contain 8+ characters, uppercase, lowercase and number
                    </Text>
                  </View>

                  {/* Confirm Password Field */}
                  <View className="mb-2">
                    <Text className="input-label">Confirm Password</Text>
                    <View className="relative">
                      <TextInput
                        className={`input-field pr-12 ${
                          errors.confirm_password && touched.confirm_password ? 'border-danger' : ''
                        }`}
                        placeholder="••••••••"
                        placeholderTextColor="#BDBDBD"
                        value={values.confirm_password}
                        onChangeText={handleChange('confirm_password')}
                        onBlur={handleBlur('confirm_password')}
                        secureTextEntry={!showConfirmPassword}
                        editable={!loading}
                      />
                      <TouchableOpacity
                        className="absolute right-4 top-4"
                        onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons
                          name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                          size={22}
                          color="#666"
                        />
                      </TouchableOpacity>
                    </View>
                    {errors.confirm_password && touched.confirm_password && (
                      <Text className="error-text">{errors.confirm_password}</Text>
                    )}
                    
                    {/* Password Match Indicator */}
                    {values.confirm_password.length > 0 && (
                      <View className="mt-3 flex-row items-center">
                        <MaterialIcons
                          name={values.password === values.confirm_password ? 'check-circle' : 'cancel'}
                          size={18}
                          color={values.password === values.confirm_password ? "#4CAF50" : "#F44336"}
                        />
                        <Text className={`text-sm ml-2 ${
                          values.password === values.confirm_password ? 'text-success' : 'text-danger'
                        }`}>
                          {values.password === values.confirm_password 
                            ? 'Passwords match' 
                            : 'Passwords do not match'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Additional Information */}
                <View className="card mb-4">
                  <View className="flex-row items-center justify-between mb-4">
                    <Text className="section-title">Additional Information</Text>
                    <View className="px-3 py-1 bg-lightGray/30 rounded-full">
                      <Text className="text-xs text-gray">Optional</Text>
                    </View>
                  </View>
                  
                  <Text className="text-sm text-gray mb-6 leading-5">
                    This information helps us provide better personalized service for you
                  </Text>
                  
                  {/* Height and Weight Row */}
                  <View className="flex-row mb-5">
                    <View className="flex-1 mr-2">
                      <Text className="input-label">Height (cm)</Text>
                      <TextInput
                        className="input-field"
                        placeholder="170"
                        placeholderTextColor="#BDBDBD"
                        value={values.height}
                        onChangeText={handleChange('height')}
                        onBlur={handleBlur('height')}
                        keyboardType="numeric"
                        editable={!loading}
                      />
                    </View>
                    
                    <View className="flex-1 ml-2">
                      <Text className="input-label">Weight (kg)</Text>
                      <TextInput
                        className="input-field"
                        placeholder="70"
                        placeholderTextColor="#BDBDBD"
                        value={values.weight}
                        onChangeText={handleChange('weight')}
                        onBlur={handleBlur('weight')}
                        keyboardType="numeric"
                        editable={!loading}
                      />
                    </View>
                  </View>
                  
                  {/* Emergency Contact */}
                  <View className="mb-5">
                    <Text className="input-label">Emergency Contact</Text>
                    <TextInput
                      className="input-field"
                      placeholder="Emergency phone number"
                      placeholderTextColor="#BDBDBD"
                      value={values.emergency_contact}
                      onChangeText={handleChange('emergency_contact')}
                      onBlur={handleBlur('emergency_contact')}
                      keyboardType="phone-pad"
                      editable={!loading}
                    />
                    <Text className="text-xs text-gray mt-2">
                      👨‍👩‍👧‍👦 This number will be contacted in case of emergency
                    </Text>
                  </View>
                  
                  {/* Medical Conditions */}
                  <View className="mb-2">
                    <Text className="input-label">Medical Conditions</Text>
                    <TextInput
                      className="input-field h-28 text-align-top"
                      placeholder="High blood pressure, diabetes, etc..."
                      placeholderTextColor="#BDBDBD"
                      value={values.medical_conditions}
                      onChangeText={handleChange('medical_conditions')}
                      onBlur={handleBlur('medical_conditions')}
                      editable={!loading}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                  </View>
                </View>

                {/* Terms and Conditions */}
                <View className="bg-light p-4 rounded-2xl mb-6">
                  <TouchableOpacity
                    className="flex-row"
                    onPress={() => setFieldValue('accept_terms', !values.accept_terms)}
                    disabled={loading}
                    activeOpacity={0.7}
                  >
                    <View className={`
                      w-6 h-6 rounded-md border-2 flex items-center justify-center mr-3 mt-1
                      ${values.accept_terms 
                        ? 'bg-primary border-primary' 
                        : 'border-gray bg-white'
                      }
                    `}>
                      {values.accept_terms && (
                        <MaterialIcons name="check" size={14} color="#FFFFFF" />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm text-gray leading-5">
                        I agree to the{' '}
                        <Text 
                          className="text-primary font-semibold" 
                          onPress={openTerms}
                        >
                          Terms and Conditions
                        </Text>{' '}
                        and{' '}
                        <Text 
                          className="text-primary font-semibold" 
                          onPress={openPrivacyPolicy}
                        >
                          Privacy Policy
                        </Text>
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {errors.accept_terms && touched.accept_terms && (
                    <Text className="error-text mt-2">{errors.accept_terms}</Text>
                  )}
                </View>

                {/* Register Button */}
                <TouchableOpacity
                  className={`
                    btn-primary flex-row justify-center items-center py-4 mb-4
                    ${(!isValid || !dirty || loading) ? 'opacity-50' : ''}
                  `}
                  onPress={() => handleSubmit()}
                  disabled={!isValid || !dirty || loading}
                  activeOpacity={0.7}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="person-add" size={24} color="#FFF" />
                      <Text className="text-white font-bold text-lg ml-3">
                        Create My Account
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Security Assurance */}
                <View className="flex-row items-center p-4 bg-green-50 rounded-xl border border-green-200 mb-6">
                  <MaterialIcons name="verified-user" size={24} color="#4CAF50" />
                  <View className="ml-3 flex-1">
                    <Text className="text-sm font-medium text-dark mb-1">
                      Your Data is Protected
                    </Text>
                    <Text className="text-xs text-gray">
                      All your information is encrypted and secured with the highest security standards
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </Formik>

          {/* Login Link */}
          <View className="flex-row justify-center items-center py-6 border-t border-lightGray mx-5">
            <Text className="text-base text-gray mr-2">Already have an account?</Text>
            <TouchableOpacity 
              onPress={() => navigation.navigate('Login')}
              activeOpacity={0.7}
            >
              <Text className="text-primary font-bold text-base">Login Here</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};