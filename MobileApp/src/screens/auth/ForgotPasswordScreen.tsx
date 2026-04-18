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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp as StackNavigationProp } from '@react-navigation/native-stack';

import { authService } from '../../services/auth.service';
import { ForgotPasswordData } from '../../types/auth';

type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: { prefilledEmail?: string } | undefined;
};

type ForgotPasswordScreenNavigationProp = StackNavigationProp<
  AuthStackParamList,
  'ForgotPassword'
>;
type ForgotPasswordScreenRouteProp = RouteProp<AuthStackParamList, 'ForgotPassword'>;

// Data validation schema
const ForgotPasswordSchema = Yup.object().shape({
  email: Yup.string()
    .email('Invalid email address')
    .required('Email is required'),
});

export const ForgotPasswordScreen: React.FC = () => {
  const navigation = useNavigation<ForgotPasswordScreenNavigationProp>();
  const route = useRoute<ForgotPasswordScreenRouteProp>();
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const prefilledEmail = route.params?.prefilledEmail || '';

  const handleForgotPassword = async (values: ForgotPasswordData) => {
    try {
      setLoading(true);
      
      const response = await authService.forgotPassword(values.email);
      
      if (response.success) {
        setEmailSent(true);
        setCountdown(60); // 60 seconds countdown
        
        // Start countdown
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        
        Alert.alert(
          '✅ Email Sent!',
          'Password reset link has been sent to your email address',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('❌ Error', response.message || 'Failed to send reset link');
      }
    } catch (error: any) {
      Alert.alert('❌ Error', error.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmail = () => {
    if (countdown > 0) {
      Alert.alert(
        '⏳ Please Wait',
        `You can resend email in ${countdown} seconds`,
        [{ text: 'OK' }]
      );
      return;
    }
    setEmailSent(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="items-center mb-10">
            <TouchableOpacity
              className="self-end p-2 mb-4"
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <MaterialIcons name="arrow-back" size={24} color="#212121" />
            </TouchableOpacity>
            
            <View className="w-28 h-28 rounded-full bg-blue-50 justify-center items-center mb-6">
              <MaterialIcons name="lock-reset" size={50} color="#2196F3" />
            </View>
            
            <Text className="text-2xl font-bold text-dark text-center mb-3">
              Reset Your Password
            </Text>
            <Text className="text-base text-gray text-center leading-6 max-w-xs">
              Enter your email and we will send you a link to reset your password
            </Text>
          </View>

          {emailSent ? (
            // State after email is sent
            <View className="items-center px-4">
              {/* Success Icon */}
              <View className="w-32 h-32 rounded-full bg-green-50 justify-center items-center mb-6">
                <MaterialIcons name="mark-email-read" size={60} color="#4CAF50" />
              </View>
              
              {/* Success Message */}
              <Text className="text-2xl font-bold text-success text-center mb-4">
                Check Your Email!
              </Text>
              <Text className="text-base text-gray text-center leading-6 mb-8">
                We have sent password reset instructions to your email address.
              </Text>
              
              {/* Tips Box */}
              <View className="w-full bg-blue-50 rounded-2xl p-5 mb-8 border border-blue-200">
                <Text className="text-lg font-semibold text-dark mb-4">📌 Important Tips:</Text>
                
                <View className="space-y-3">
                  <View className="flex-row items-start">
                    <MaterialIcons name="search" size={18} color="#2196F3" className="mt-0.5" />
                    <Text className="text-sm text-gray ml-3 flex-1">
                      Check your spam or junk folder if you do not see the email
                    </Text>
                  </View>
                  
                  <View className="flex-row items-start">
                    <MaterialIcons name="timer" size={18} color="#FF9800" className="mt-0.5" />
                    <Text className="text-sm text-gray ml-3 flex-1">
                      Reset link expires in 24 hours for security reasons
                    </Text>
                  </View>
                  
                  <View className="flex-row items-start">
                    <MaterialIcons name="security" size={18} color="#4CAF50" className="mt-0.5" />
                    <Text className="text-sm text-gray ml-3 flex-1">
                      Never share your reset link with anyone
                    </Text>
                  </View>
                </View>
              </View>
              
              {/* Action Buttons */}
              <View className="w-full space-y-3">
                <TouchableOpacity
                  className={`flex-row justify-center items-center py-4 rounded-xl ${
                    countdown > 0 ? 'bg-gray-300' : 'bg-primary'
                  }`}
                  onPress={handleResendEmail}
                  disabled={countdown > 0}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="email" size={22} color="#FFFFFF" />
                  <Text className="text-white font-bold text-base ml-3">
                    {countdown > 0 ? `Resend in ${countdown}s` : 'Send New Link'}
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  className="flex-row justify-center items-center py-4 border-2 border-primary rounded-xl"
                  onPress={() => navigation.navigate('Login')}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="arrow-back" size={20} color="#2196F3" />
                  <Text className="text-primary font-semibold text-base ml-2">
                    Back to Login
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Email input form
            <Formik
              initialValues={{ email: prefilledEmail }}
              validationSchema={ForgotPasswordSchema}
              onSubmit={handleForgotPassword}
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
              }) => (
                <View className="mb-8">
                  {/* Email Field */}
                  <View className="mb-8">
                    <Text className="text-base font-semibold text-dark mb-3">
                      <MaterialIcons name="email" size={16} color="#666" /> Email Address
                    </Text>
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

                  {/* Submit Button */}
                  <TouchableOpacity
                    className={`
                      btn-primary flex-row justify-center items-center py-4 mb-6
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
                        <MaterialIcons name="send" size={22} color="#FFF" />
                        <Text className="text-white font-bold text-lg ml-3">
                          Send Reset Link
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Information Box */}
                  <View className="flex-row p-4 bg-blue-50 rounded-xl border border-blue-200">
                    <MaterialIcons name="info" size={24} color="#2196F3" />
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-medium text-dark mb-1">
                        What happens next?
                      </Text>
                      <Text className="text-xs text-gray">
                        You will receive an email with a secure link to reset your password. Click the link and create a new password.
                      </Text>
                    </View>
                  </View>
                  
                  {/* Security Notice */}
                  <View className="mt-6 p-4 bg-yellow-50 rounded-xl border border-yellow-200">
                    <View className="flex-row items-center mb-2">
                      <MaterialIcons name="security" size={18} color="#FF9800" />
                      <Text className="text-sm font-medium text-dark ml-2">Security Notice</Text>
                    </View>
                    <Text className="text-xs text-gray">
                      • Only enter your registered email address
                    </Text>
                    <Text className="text-xs text-gray mt-1">
                      • We will never ask for your password via email
                    </Text>
                    <Text className="text-xs text-gray mt-1">
                      • Links expire automatically for your protection
                    </Text>
                  </View>
                </View>
              )}
            </Formik>
          )}

          {/* Back to Login Link (only show in form mode) */}
          {!emailSent && (
            <TouchableOpacity
              className="flex-row justify-center items-center py-6 border-t border-lightGray mt-6"
              onPress={() => navigation.navigate('Login')}
              activeOpacity={0.7}
            >
              <MaterialIcons name="arrow-back" size={18} color="#2196F3" />
              <Text className="text-primary font-semibold text-base ml-2">
                Back to Login
              </Text>
            </TouchableOpacity>
          )}
          
          {/* Footer */}
          <View className="items-center mt-8">
            <View className="flex-row items-center mb-2">
              <MaterialIcons name="support-agent" size={16} color="#757575" />
              <Text className="text-xs text-gray ml-2">Need help? Contact support</Text>
            </View>
            <Text className="text-xs text-lightGray">Fall Detection System • v1.0.0</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
