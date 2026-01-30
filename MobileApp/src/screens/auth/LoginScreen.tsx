// src/screens/auth/LoginScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

import { AUTH_CONFIG, AUTH_TEXTS } from '../../constants/auth';
import { authService } from '../../services/auth.service';
import { UserCredentials } from '../../types/auth';
import { useLanguage } from '../../components/LanguageProvider'; 
import { COLORS } from '../../utils/constants'; 

type RootStackParamList = {
  Auth: undefined;
  MainTabs: undefined;
};

type LoginScreenNavigationProp = StackNavigationProp<RootStackParamList>;
type LoginScreenRouteProp = RouteProp<{ Login: { prefilledEmail?: string } }, 'Login'>;

const LoginSchema = Yup.object().shape({
  email: Yup.string()
    .email(AUTH_TEXTS.AR.validation.invalidEmail)
    .required(AUTH_TEXTS.AR.validation.required),
  password: Yup.string()
    .min(6, AUTH_TEXTS.AR.validation.minLength.replace('{min}', '6'))
    .required(AUTH_TEXTS.AR.validation.required),
});

export const LoginScreen: React.FC = () => {
  const route = useRoute<LoginScreenRouteProp>();
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const { language, changeLanguage, t, isChanging } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState(route.params?.prefilledEmail || '');
  const [databaseStatus, setDatabaseStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  
  // لمنع التكرار
  const connectionCheckedRef = useRef(false);
  const loginAttemptRef = useRef(false);

  useEffect(() => {
    if (!connectionCheckedRef.current) {
      checkDatabaseStatus();
      connectionCheckedRef.current = true;
    }

    checkBiometricSupport();
  }, []);

  const checkDatabaseStatus = async () => {
    if (isCheckingConnection) return;
    
    setIsCheckingConnection(true);
    try {
      console.log('🔍 [Login] Single database connection check...');
      setDatabaseStatus('checking');
      
      const isConnected = await authService.testDatabaseConnection();
      
      if (isConnected) {
        setDatabaseStatus('connected');
        console.log('✅ [Login] Database connected');
      } else {
        setDatabaseStatus('disconnected');
        console.log('⚠️ [Login] Database disconnected');
      }
    } catch (error) {
      setDatabaseStatus('disconnected');
      console.log('⚠️ [Login] Connection check failed');
    } finally {
      setIsCheckingConnection(false);
    }
  };

  const checkBiometricSupport = async () => {
    const biometricData = await authService.checkBiometricSupport();
    setBiometricAvailable(biometricData.isAvailable);
  };

  const handleLanguageSwitch = async () => {
    try {
      const newLang = language === 'ar' ? 'en' : 'ar';
      const success = await changeLanguage(newLang);
      
      if (success) {
        Alert.alert(
          t('success.updated'),
          t('language.restartMessage'),
          [{ 
            text: t('common.ok'),
            onPress: () => {
              setTimeout(() => {
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                });
              }, 500);
            }
          }]
        );
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('errors.unknown'));
    }
  };

  const handleLogin = async (values: UserCredentials) => {
    // منع النقر المزدوج
    if (loginAttemptRef.current || loading) return;
    
    loginAttemptRef.current = true;
    setLoading(true);
    
    try {
      console.log('🔐 [Login] Starting login process...');
      
      // تخطي فحص الاتصال أثناء تسجيل الدخول - نعتمد على الحالة الحالية
      if (databaseStatus === 'disconnected') {
        Alert.alert(
          '❌ Cannot Login',
          'Cannot login because database connection failed.\n\n' +
          'Please ensure backend server is running.',
          [{ text: 'OK' }]
        );
        return;
      }

      // التحقق السريع من وجود المستخدم
      console.log(`📧 [Login] Quick email check: ${values.email}`);
      const userExists = await authService.checkUserExists(values.email);
      
      if (!userExists) {
        Alert.alert(
          '❌ User Not Found',
          'Email is not registered in the database.\n\n' +
          'Please register first.',
          [{ text: 'OK' }]
        );
        return;
      }

      console.log('📤 [Login] Sending login request...');
      const response = await authService.login(values);
      
      console.log('📡 [Login] Response received');
      
      if (response.success && response.user && response.access_token) {
        await authService.updateLastActivity();
        
        console.log('✅ [Login] Successful, navigating...');
        
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
        
      } else {
        Alert.alert('❌ Login Error', response.message || 'Invalid credentials');
      }
    } catch (error: any) {
      console.error('❌ [Login] Error:', error);
      Alert.alert('❌ System Error', 'Please try again');
    } finally {
      setLoading(false);
      setTimeout(() => {
        loginAttemptRef.current = false;
      }, 1000);
    }
  };

  const handleBiometricLogin = async () => {
    try {
      if (databaseStatus !== 'connected') {
        Alert.alert('❌ Database Not Connected', 'Cannot use biometric authentication currently');
        return;
      }

      setLoading(true);
      const response = await authService.authenticateWithBiometrics();
      
      if (response.success) {
        await authService.updateLastActivity();
        
        console.log('✅ Biometric login successful');
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      } else {
        Alert.alert('❌ Authentication Failed', response.message || 'Biometric authentication failed');
      }
    } catch (error: any) {
      Alert.alert('❌ Error', error.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = (provider: 'google' | 'apple') => {
    Alert.alert(
      'Coming Soon',
      `Login with ${provider} will be available soon`,
      [{ text: 'OK' }]
    );
  };

  const handleTestDatabase = () => {
    Alert.alert(
      'Test Connection',
      'Will check database connection.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Test',
          onPress: checkDatabaseStatus
        }
      ]
    );
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Forgot Password',
      'This feature will be available soon',
      [{ text: 'OK' }]
    );
  };

  const handleRegister = () => {
    navigation.navigate('Register' as never);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Language Switch Button */}
        <View style={styles.languageHeader}>
          <TouchableOpacity
            style={styles.languageButton}
            onPress={handleLanguageSwitch}
            disabled={isChanging}
          >
            <MaterialCommunityIcons 
              name="translate" 
              size={20} 
              color={COLORS.primary} 
            />
            <Text style={styles.languageButtonText}>
              {language === 'ar' ? 'English' : 'العربية'}
            </Text>
            {isChanging && (
              <ActivityIndicator size="small" color={COLORS.primary} style={styles.languageLoader} />
            )}
          </TouchableOpacity>
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <MaterialCommunityIcons name="shield-check" size={80} color={AUTH_CONFIG.COLORS.primary} />
            <Text style={styles.logoText}>Fall Detection</Text>
          </View>
          <Text style={styles.welcomeText}>
            {language === 'ar' ? AUTH_TEXTS.AR.welcome : 'Welcome to Fall Detection System'}
          </Text>
          <Text style={styles.subtitle}>
            {language === 'ar' 
              ? 'سلامتك تهمنا. نظام ذكي لكشف السقوط والاستجابة السريعة'
              : 'Your safety matters. Smart system for fall detection and rapid response'}
          </Text>
        </View>

        {/* Connection Status */}
        {databaseStatus === 'checking' ? (
          <View style={styles.connectionChecking}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.connectionCheckingText}>
              {language === 'ar' ? 'جاري فحص الاتصال...' : 'Checking connection...'}
            </Text>
          </View>
        ) : databaseStatus === 'disconnected' && (
          <View style={styles.databaseWarning}>
            <MaterialCommunityIcons name="wifi-off" size={20} color={COLORS.warning} />
            <Text style={styles.databaseWarningText}>
              {language === 'ar' 
                ? 'الاتصال محدود - يمكنك تسجيل الدخول لاحقاً'
                : 'Limited connection - You can login later'}
            </Text>
            <TouchableOpacity onPress={checkDatabaseStatus} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>⟳</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Login Form */}
        <Formik
          initialValues={{ email: email, password: '' }}
          validationSchema={LoginSchema}
          onSubmit={handleLogin}
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
                <View style={styles.inputLabel}>
                  <MaterialCommunityIcons name="email-outline" size={20} color="#666" />
                  <Text style={styles.labelText}>
                    {language === 'ar' ? AUTH_TEXTS.AR.login.email : 'Email'}
                  </Text>
                </View>
                <TextInput
                  style={[
                    styles.input,
                    errors.email && touched.email && styles.inputError,
                  ]}
                  placeholder={language === 'ar' ? "example@email.com" : "example@email.com"}
                  placeholderTextColor="#999"
                  value={values.email}
                  onChangeText={handleChange('email')}
                  onBlur={handleBlur('email')}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!loading}
                  autoComplete="email"
                />
                {errors.email && touched.email && (
                  <Text style={styles.errorText}>{errors.email}</Text>
                )}
              </View>

              {/* Password Field */}
              <View style={styles.inputContainer}>
                <View style={styles.inputLabel}>
                  <MaterialCommunityIcons name="lock-outline" size={20} color="#666" />
                  <Text style={styles.labelText}>
                    {language === 'ar' ? AUTH_TEXTS.AR.login.password : 'Password'}
                  </Text>
                </View>
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
                    autoComplete="password"
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <MaterialCommunityIcons
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={24}
                      color="#666"
                    />
                  </TouchableOpacity>
                </View>
                {errors.password && touched.password && (
                  <Text style={styles.errorText}>{errors.password}</Text>
                )}
              </View>

              {/* Remember Me and Forgot Password */}
              <View style={styles.optionsContainer}>
                <TouchableOpacity
                  style={styles.rememberContainer}
                  onPress={() => setRememberMe(!rememberMe)}
                >
                  <View style={[
                    styles.checkbox,
                    rememberMe && styles.checkboxChecked
                  ]}>
                    {rememberMe && (
                      <MaterialCommunityIcons name="check" size={16} color="#FFF" />
                    )}
                  </View>
                  <Text style={styles.rememberText}>
                    {language === 'ar' ? AUTH_TEXTS.AR.login.remember : 'Remember me'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={handleForgotPassword}>
                  <Text style={styles.forgotText}>
                    {language === 'ar' ? AUTH_TEXTS.AR.login.forgot : 'Forgot password?'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Login Button */}
              <TouchableOpacity
                style={[
                  styles.loginButton,
                  (!isValid || !dirty || loading) && styles.loginButtonDisabled,
                ]}
                onPress={() => handleSubmit()}
                disabled={!isValid || !dirty || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="login" size={24} color="#FFF" />
                    <Text style={styles.loginButtonText}>
                      {language === 'ar' ? AUTH_TEXTS.AR.login.title : 'Login'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Biometric Authentication */}
              {biometricAvailable && databaseStatus === 'connected' && (
                <TouchableOpacity
                  style={styles.biometricButton}
                  onPress={handleBiometricLogin}
                  disabled={loading}
                >
                  <MaterialCommunityIcons name="fingerprint" size={24} color={AUTH_CONFIG.COLORS.primary} />
                  <Text style={styles.biometricText}>
                    {language === 'ar' ? AUTH_TEXTS.AR.login.biometric : 'Login with Fingerprint'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Message if database is disconnected */}
              {databaseStatus === 'disconnected' && (
                <View style={styles.offlineWarning}>
                  <MaterialCommunityIcons name="wifi-off" size={24} color={COLORS.warning} />
                  <Text style={styles.offlineWarningText}>
                    {language === 'ar' 
                      ? 'يمكنك تسجيل الدخول باستخدام بياناتك المحفوظة'
                      : 'You can login using your saved credentials'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </Formik>

        {/* Divider */}
        <View style={styles.dividerContainer}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>
            {language === 'ar' ? AUTH_TEXTS.AR.login.or : 'Or'}
          </Text>
          <View style={styles.divider} />
        </View>

        {/* Social Media Login */}
        {databaseStatus === 'connected' && (
          <View style={styles.socialContainer}>
            <Text style={styles.socialTitle}>
              {language === 'ar' ? AUTH_TEXTS.AR.login.continueWith : 'Continue with'}
            </Text>
            
            <View style={styles.socialButtons}>
              <TouchableOpacity
                style={[styles.socialButton, styles.googleButton]}
                onPress={() => handleSocialLogin('google')}
                disabled={loading}
              >
                <MaterialCommunityIcons name="google" size={24} color="#FFF" />
                <Text style={styles.socialButtonText}>Google</Text>
              </TouchableOpacity>

              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={[styles.socialButton, styles.appleButton]}
                  onPress={() => handleSocialLogin('apple')}
                  disabled={loading}
                >
                  <MaterialCommunityIcons name="apple" size={24} color="#FFF" />
                  <Text style={styles.socialButtonText}>Apple</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Registration Link */}
        <View style={styles.registerContainer}>
          <Text style={styles.registerText}>
            {language === 'ar' ? AUTH_TEXTS.AR.login.noAccount : "Don't have an account?"}
          </Text>
          <TouchableOpacity 
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={styles.registerLink}>
              {language === 'ar' ? AUTH_TEXTS.AR.login.signUp : 'Sign up now'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* App Version */}
        <Text style={styles.versionText}>
          Fall Detection App v1.0.0
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 40,
  },
  languageHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 20,
    marginTop: 10,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(33, 150, 243, 0.3)',
  },
  languageButtonText: {
    marginLeft: 8,
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  languageLoader: {
    marginLeft: 6,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logoText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: AUTH_CONFIG.COLORS.primary,
    marginTop: 12,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
  },
  connectionChecking: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  connectionCheckingText: {
    marginLeft: 8,
    fontSize: 14,
    color: COLORS.primary,
  },
  databaseWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderWidth: 1,
    borderColor: AUTH_CONFIG.COLORS.warning,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  databaseWarningText: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    marginLeft: 8,
  },
  retryButton: {
    padding: 4,
    marginLeft: 8,
  },
  retryButtonText: {
    fontSize: 16,
    color: COLORS.primary,
  },
  formContainer: {
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  labelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
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
    marginLeft: 8,
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 60,
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
  },
  optionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  rememberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: AUTH_CONFIG.COLORS.primary,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: AUTH_CONFIG.COLORS.primary,
  },
  rememberText: {
    fontSize: 14,
    color: '#666',
  },
  forgotText: {
    fontSize: 14,
    color: AUTH_CONFIG.COLORS.primary,
    fontWeight: '600',
  },
  loginButton: {
    backgroundColor: AUTH_CONFIG.COLORS.primary,
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  loginButtonDisabled: {
    backgroundColor: '#CCC',
    opacity: 0.7,
  },
  loginButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  biometricButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: AUTH_CONFIG.COLORS.primary,
    borderRadius: 12,
    backgroundColor: '#F0F8FF',
  },
  biometricText: {
    color: AUTH_CONFIG.COLORS.primary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  offlineWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderWidth: 1,
    borderColor: AUTH_CONFIG.COLORS.warning,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  offlineWarningText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    marginLeft: 12,
    lineHeight: 20,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#666',
    fontSize: 14,
  },
  socialContainer: {
    marginBottom: 24,
  },
  socialTitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  socialButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    marginHorizontal: 6,
  },
  googleButton: {
    backgroundColor: '#DB4437',
  },
  appleButton: {
    backgroundColor: '#000000',
  },
  socialButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
  registerText: {
    fontSize: 16,
    color: '#666',
  },
  registerLink: {
    fontSize: 16,
    color: AUTH_CONFIG.COLORS.primary,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  versionText: {
    textAlign: 'center',
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
});

export default LoginScreen;