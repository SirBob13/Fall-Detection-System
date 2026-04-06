import React, { useState, useEffect } from 'react';
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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

import { authService } from '../../services/auth.service';
import { ResetPasswordData } from '../../types/auth';

type AuthStackParamList = {
  ResetPassword: { token: string };
  Login: undefined;
};

type ResetPasswordScreenRouteProp = RouteProp<AuthStackParamList, 'ResetPassword'>;
type ResetPasswordScreenNavigationProp = StackNavigationProp<AuthStackParamList, 'ResetPassword'>;

// Data validation schema
const ResetPasswordSchema = Yup.object().shape({
  password: Yup.string()
    .min(8, 'Password must be at least 8 characters')
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
      'Must contain uppercase, lowercase, number, and special character'
    )
    .required('Password is required'),
  confirm_password: Yup.string()
    .oneOf([Yup.ref('password')], 'Passwords do not match')
    .required('Confirm password is required'),
});

export const ResetPasswordScreen: React.FC = () => {
  const navigation = useNavigation<ResetPasswordScreenNavigationProp>();
  const route = useRoute<ResetPasswordScreenRouteProp>();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [token, setToken] = useState('');
  const [passwordStrength, setPasswordStrength] = useState({
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    special: false,
    score: 0,
  });

  useEffect(() => {
    if (route.params?.token) {
      setToken(route.params.token);
    } else {
      Alert.alert('Error', 'Invalid link');
      navigation.navigate('Login');
    }
  }, [route.params]);

  const handleResetPassword = async (values: ResetPasswordData) => {
    try {
      setLoading(true);
      
      const resetData: ResetPasswordData = {
        token: token,
        password: values.password,
        confirm_password: values.confirm_password,
      };
      
      const response = await authService.resetPassword(resetData);
      
      if (response.success) {
        Alert.alert(
          'Success',
          'Password reset successfully! You can now login with your new password.',
          [
            {
              text: 'Login',
              onPress: () => navigation.navigate('Login'),
            },
          ]
        );
      } else {
        Alert.alert('Error', response.message || 'An error occurred during reset');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const checkPasswordStrength = (password: string) => {
    const checks = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
      special: /[@$!%*?&]/.test(password),
    };
    
    const score = Object.values(checks).filter(Boolean).length;
    
    setPasswordStrength({
      ...checks,
      score,
    });
  };

  const getPasswordStrengthColor = () => {
    switch (passwordStrength.score) {
      case 0: return '#9E9E9E';
      case 1: return '#F44336'; // Red
      case 2: return '#FF9800'; // Orange
      case 3: return '#FFC107'; // Yellow
      case 4: return '#4CAF50'; // Green
      case 5: return '#2196F3'; // Blue (Strong)
      default: return '#9E9E9E';
    }
  };

  const getPasswordStrengthText = () => {
    switch (passwordStrength.score) {
      case 0: return 'Very Weak';
      case 1: return 'Very Weak';
      case 2: return 'Weak';
      case 3: return 'Fair';
      case 4: return 'Good';
      case 5: return 'Strong';
      default: return '';
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-darkTheme-surface">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="items-center mb-10 mt-5">
            <View className="w-24 h-24 rounded-full bg-blue-50 justify-center items-center mb-6">
              <MaterialIcons name="lock" size={50} color="#2196F3" />
            </View>
            <Text className="text-2xl font-bold text-dark dark:text-darkTheme-text text-center mb-3">
              Set New Password
            </Text>
            <Text className="text-base text-gray dark:text-darkTheme-muted text-center leading-6 max-w-xs">
              Choose a strong password to protect your account
            </Text>
          </View>

          {/* Reset Form */}
          <Formik
            initialValues={{
              password: '',
              confirm_password: '',
            }}
            validationSchema={ResetPasswordSchema}
            onSubmit={handleResetPassword}
          >
            {({
              handleChange,
              handleBlur,
              handleSubmit,
              values,
              errors,
              touched,
              isValid,
              dirty,
              setFieldValue,
            }) => (
              <View className="mb-8">
                {/* New Password Field */}
                <View className="mb-6">
                  <Text className="text-base font-semibold text-dark dark:text-darkTheme-text mb-2">
                    <MaterialIcons name="lock" size={16} color="#666" /> New Password
                  </Text>
                  <View className="relative">
                    <TextInput
                      className={`
                        input-field
                        ${errors.password && touched.password ? 'border-danger' : ''}
                        pr-12
                      `}
                      placeholder="••••••••"
                      placeholderTextColor="#BDBDBD"
                      value={values.password}
                      onChangeText={(text) => {
                        handleChange('password')(text);
                        checkPasswordStrength(text);
                      }}
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
                    <Text className="text-sm text-danger mt-2">{errors.password}</Text>
                  )}
                  
                  {/* Password Strength Indicator */}
                  {values.password.length > 0 && (
                    <View className="mt-4">
                      <View className="flex-row justify-between items-center mb-2">
                        <Text className="text-sm text-dark dark:text-darkTheme-text font-medium">
                          Password Strength:
                        </Text>
                        <Text 
                          className="text-sm font-bold"
                          style={{ color: getPasswordStrengthColor() }}
                        >
                          {getPasswordStrengthText()}
                        </Text>
                      </View>
                      
                      {/* Strength Bar */}
                      <View className="h-2 bg-lightGray rounded-full overflow-hidden">
                        <View 
                          className="h-full rounded-full transition-all duration-300"
                          style={{ 
                            width: `${(passwordStrength.score / 5) * 100}%`,
                            backgroundColor: getPasswordStrengthColor()
                          }}
                        />
                      </View>
                    </View>
                  )}
                </View>

                {/* Confirm Password Field */}
                <View className="mb-8">
                  <Text className="text-base font-semibold text-dark dark:text-darkTheme-text mb-2">
                    <MaterialIcons name="lock" size={16} color="#666" /> Confirm Password
                  </Text>
                  <View className="relative">
                    <TextInput
                      className={`
                        input-field
                        ${errors.confirm_password && touched.confirm_password ? 'border-danger' : ''}
                        pr-12
                      `}
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
                    <Text className="text-sm text-danger mt-2">{errors.confirm_password}</Text>
                  )}
                  
                  {/* Password Match Indicator */}
                  {values.confirm_password.length > 0 && (
                    <View className="mt-3">
                      <View className="flex-row items-center">
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
                    </View>
                  )}
                </View>

                {/* Security Requirements */}
                <View className="bg-light dark:bg-darkTheme-background p-5 rounded-2xl mb-8 border border-lightGray dark:border-darkTheme-border">
                  <Text className="text-base font-bold text-dark dark:text-darkTheme-text mb-4">
                    Password Requirements
                  </Text>
                  
                  {[
                    {
                      id: 'length',
                      text: 'At least 8 characters',
                      check: values.password.length >= 8,
                    },
                    {
                      id: 'uppercase',
                      text: 'At least one uppercase letter (A-Z)',
                      check: /[A-Z]/.test(values.password),
                    },
                    {
                      id: 'lowercase',
                      text: 'At least one lowercase letter (a-z)',
                      check: /[a-z]/.test(values.password),
                    },
                    {
                      id: 'number',
                      text: 'At least one number (0-9)',
                      check: /\d/.test(values.password),
                    },
                    {
                      id: 'special',
                      text: 'At least one special character (@$!%*?&)',
                      check: /[@$!%*?&]/.test(values.password),
                    },
                  ].map((requirement) => (
                    <View key={requirement.id} className="flex-row items-center mb-3">
                      <MaterialIcons
                        name={requirement.check ? 'check-circle' : 'radio-button-unchecked'}
                        size={18}
                        color={requirement.check ? "#4CAF50" : "#9E9E9E"}
                      />
                      <Text className={`text-sm ml-3 flex-1 ${
                        requirement.check ? 'text-success font-medium' : 'text-gray dark:text-darkTheme-muted'
                      }`}>
                        {requirement.text}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Reset Button */}
                <TouchableOpacity
                  className={`
                    btn-primary flex-row justify-center items-center py-5
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
                      <MaterialIcons name="lock" size={24} color="#FFF" />
                      <Text className="text-white font-bold text-lg ml-3">
                        Set New Password
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Back to Login Link */}
                <TouchableOpacity
                  className="mt-6 flex-row justify-center items-center"
                  onPress={() => navigation.navigate('Login')}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="arrow-back" size={18} color="#2196F3" />
                  <Text className="text-primary font-semibold ml-2">
                    Back to Login
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </Formik>
          
          {/* Security Tips */}
          <View className="mt-8 p-4 bg-yellow-50 rounded-xl border border-yellow-200">
            <View className="flex-row items-center mb-2">
              <MaterialIcons name="security" size={20} color="#FF9800" />
              <Text className="text-base font-semibold text-dark dark:text-darkTheme-text ml-2">
                Security Tips
              </Text>
            </View>
            <Text className="text-sm text-gray dark:text-darkTheme-muted mb-1">
              • Don't reuse passwords from other sites
            </Text>
            <Text className="text-sm text-gray dark:text-darkTheme-muted mb-1">
              • Use a password manager for strong, unique passwords
            </Text>
            <Text className="text-sm text-gray dark:text-darkTheme-muted">
              • Change your password regularly for better security
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};