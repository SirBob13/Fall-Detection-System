import React, { useState, useEffect } from 'react';
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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

import { AUTH_CONFIG } from '../../constants/auth';
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

  useEffect(() => {
    if (route.params?.token) {
      setToken(route.params.token);
    } else {
      // In real app, token might be in the link
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
            <MaterialIcons name="lock" size={80} color={AUTH_CONFIG.COLORS.primary} />
            <Text style={styles.title}>Set New Password</Text>
            <Text style={styles.subtitle}>
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
            }) => (
              <View style={styles.formContainer}>
                {/* New Password Field */}
                <View style={styles.inputContainer}>
                  <Text style={styles.label}>
                    <MaterialIcons name="lock" size={16} color="#666" /> New Password
                  </Text>
                  <View style={styles.passwordContainer}>
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
                  <Text style={styles.passwordHint}>
                    Must contain at least 8 characters, uppercase, lowercase, number and special character
                  </Text>
                </View>

                {/* Confirm Password Field */}
                <View style={styles.inputContainer}>
                  <Text style={styles.label}>
                    <MaterialIcons name="lock" size={16} color="#666" /> Confirm Password
                  </Text>
                  <View style={styles.passwordContainer}>
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

                {/* Security Requirements */}
                <View style={styles.requirementsContainer}>
                  <Text style={styles.requirementsTitle}>Security Requirements:</Text>
                  <View style={styles.requirementItem}>
                    <MaterialIcons
                      name={values.password.length >= 8 ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={values.password.length >= 8 ? AUTH_CONFIG.COLORS.success : '#999'}
                    />
                    <Text style={[
                      styles.requirementText,
                      values.password.length >= 8 && styles.requirementMet
                    ]}>
                      At least 8 characters
                    </Text>
                  </View>
                  <View style={styles.requirementItem}>
                    <MaterialIcons
                      name={/[A-Z]/.test(values.password) ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={/[A-Z]/.test(values.password) ? AUTH_CONFIG.COLORS.success : '#999'}
                    />
                    <Text style={[
                      styles.requirementText,
                      /[A-Z]/.test(values.password) && styles.requirementMet
                    ]}>
                      At least one uppercase letter
                    </Text>
                  </View>
                  <View style={styles.requirementItem}>
                    <MaterialIcons
                      name={/[a-z]/.test(values.password) ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={/[a-z]/.test(values.password) ? AUTH_CONFIG.COLORS.success : '#999'}
                    />
                    <Text style={[
                      styles.requirementText,
                      /[a-z]/.test(values.password) && styles.requirementMet
                    ]}>
                      At least one lowercase letter
                    </Text>
                  </View>
                  <View style={styles.requirementItem}>
                    <MaterialIcons
                      name={/\d/.test(values.password) ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={/\d/.test(values.password) ? AUTH_CONFIG.COLORS.success : '#999'}
                    />
                    <Text style={[
                      styles.requirementText,
                      /\d/.test(values.password) && styles.requirementMet
                    ]}>
                      At least one number
                    </Text>
                  </View>
                  <View style={styles.requirementItem}>
                    <MaterialIcons
                      name={/[@$!%*?&]/.test(values.password) ? 'check-circle' : 'radio-button-unchecked'}
                      size={16}
                      color={/[@$!%*?&]/.test(values.password) ? AUTH_CONFIG.COLORS.success : '#999'}
                    />
                    <Text style={[
                      styles.requirementText,
                      /[@$!%*?&]/.test(values.password) && styles.requirementMet
                    ]}>
                      At least one special character (@$!%*?&)
                    </Text>
                  </View>
                </View>

                {/* Reset Button */}
                <TouchableOpacity
                  style={[
                    styles.resetButton,
                    (!isValid || !dirty || loading) && styles.resetButtonDisabled,
                  ]}
                  onPress={() => handleSubmit()}
                  disabled={!isValid || !dirty || loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="lock" size={24} color="#FFF" />
                      <Text style={styles.resetButtonText}>Set Password</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </Formik>
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
    marginTop: 20,
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
  },
  formContainer: {
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 25,
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
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 50,
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
  },
  passwordHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    fontStyle: 'italic',
  },
  requirementsContainer: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 20,
    marginBottom: 30,
  },
  requirementsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  requirementText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
    marginLeft: 10,
  },
  requirementMet: {
    color: AUTH_CONFIG.COLORS.success,
    fontWeight: '600',
  },
  resetButton: {
    backgroundColor: AUTH_CONFIG.COLORS.primary,
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  resetButtonDisabled: {
    backgroundColor: '#CCC',
    opacity: 0.7,
  },
  resetButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
});