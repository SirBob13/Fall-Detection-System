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
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

import { AUTH_CONFIG, AUTH_TEXTS } from '../../constants/auth';
import { authService } from '../../services/auth.service';
import { ForgotPasswordData } from '../../types/auth';

type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

type ForgotPasswordScreenNavigationProp = StackNavigationProp<
  AuthStackParamList,
  'ForgotPassword'
>;

// Data validation schema
const ForgotPasswordSchema = Yup.object().shape({
  email: Yup.string()
    .email('Invalid email address')
    .required('Email is required'),
});

export const ForgotPasswordScreen: React.FC = () => {
  const navigation = useNavigation<ForgotPasswordScreenNavigationProp>();
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleForgotPassword = async (values: ForgotPasswordData) => {
    try {
      setLoading(true);
      
      const response = await authService.forgotPassword(values);
      
      if (response.success) {
        setEmailSent(true);
        Alert.alert(
          'Sent Successfully',
          'Password reset link has been sent to your email',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', response.message || 'An error occurred while sending the link');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
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
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <MaterialIcons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <MaterialIcons name="lock-reset" size={80} color={AUTH_CONFIG.COLORS.primary} />
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter your email and we'll send you a link to reset your password
            </Text>
          </View>

          {emailSent ? (
            // State after email is sent
            <View style={styles.successContainer}>
              <MaterialIcons name="mark-email-read" size={100} color={AUTH_CONFIG.COLORS.success} />
              <Text style={styles.successTitle}>Email Sent!</Text>
              <Text style={styles.successText}>
                Please check your email inbox and follow the instructions
                to reset your password.
              </Text>
              <View style={styles.tipsContainer}>
                <Text style={styles.tipsTitle}>Tips:</Text>
                <View style={styles.tipItem}>
                  <MaterialIcons name="check-circle" size={16} color={AUTH_CONFIG.COLORS.success} />
                  <Text style={styles.tipText}>Check your spam/junk folder</Text>
                </View>
                <View style={styles.tipItem}>
                  <MaterialIcons name="check-circle" size={16} color={AUTH_CONFIG.COLORS.success} />
                  <Text style={styles.tipText}>Link is valid for 24 hours only</Text>
                </View>
                <View style={styles.tipItem}>
                  <MaterialIcons name="check-circle" size={16} color={AUTH_CONFIG.COLORS.success} />
                  <Text style={styles.tipText}>If you don't receive the email, try again</Text>
                </View>
              </View>
              
              <TouchableOpacity
                style={styles.resendButton}
                onPress={() => setEmailSent(false)}
              >
                <MaterialIcons name="email" size={20} color="#FFF" />
                <Text style={styles.resendButtonText}>Send New Link</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.backToLoginButton}
                onPress={() => navigation.navigate('Login')}
              >
                <Text style={styles.backToLoginText}>Back to Login</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Email input form
            <Formik
              initialValues={{ email: '' }}
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
                <View style={styles.formContainer}>
                  {/* Email Field */}
                  <View style={styles.inputContainer}>
                    <Text style={styles.label}>
                      <MaterialIcons name="email" size={16} color="#666" /> Email
                    </Text>
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

                  {/* Submit Button */}
                  <TouchableOpacity
                    style={[
                      styles.submitButton,
                      (!isValid || !dirty || loading) && styles.submitButtonDisabled,
                    ]}
                    onPress={() => handleSubmit()}
                    disabled={!isValid || !dirty || loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <>
                        <MaterialIcons name="send" size={24} color="#FFF" />
                        <Text style={styles.submitButtonText}>Send Reset Link</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Tips */}
                  <View style={styles.infoBox}>
                    <MaterialIcons name="info" size={20} color={AUTH_CONFIG.COLORS.info} />
                    <Text style={styles.infoText}>
                      You will receive a link to reset your password. Make sure to use a correct email address.
                    </Text>
                  </View>
                </View>
              )}
            </Formik>
          )}

          {/* Back to Login Link */}
          {!emailSent && (
            <TouchableOpacity
              style={styles.backToLoginContainer}
              onPress={() => navigation.navigate('Login')}
            >
              <MaterialIcons name="arrow-back" size={16} color={AUTH_CONFIG.COLORS.primary} />
              <Text style={styles.backToLoginText2}>Back to Login</Text>
            </TouchableOpacity>
          )}
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
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  backButton: {
    alignSelf: 'flex-end',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  formContainer: {
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 30,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#FAFAFA',
  },
  inputError: {
    borderColor: AUTH_CONFIG.COLORS.error,
  },
  errorText: {
    color: AUTH_CONFIG.COLORS.error,
    fontSize: 14,
    marginTop: 4,
  },
  submitButton: {
    backgroundColor: AUTH_CONFIG.COLORS.primary,
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  submitButtonDisabled: {
    backgroundColor: '#CCC',
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#F0F8FF',
    borderColor: AUTH_CONFIG.COLORS.info,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    marginLeft: 12,
    lineHeight: 20,
  },
  backToLoginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  backToLoginText2: {
    fontSize: 16,
    color: AUTH_CONFIG.COLORS.primary,
    fontWeight: '600',
    marginLeft: 8,
  },
  successContainer: {
    alignItems: 'center',
    padding: 20,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: AUTH_CONFIG.COLORS.success,
    marginTop: 20,
    marginBottom: 16,
  },
  successText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  tipsContainer: {
    width: '100%',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 20,
    marginBottom: 30,
  },
  tipsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
    marginLeft: 10,
  },
  resendButton: {
    backgroundColor: AUTH_CONFIG.COLORS.primary,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  resendButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  backToLoginButton: {
    padding: 16,
    width: '100%',
    alignItems: 'center',
  },
  backToLoginText: {
    fontSize: 16,
    color: AUTH_CONFIG.COLORS.primary,
    fontWeight: 'bold',
  },
});