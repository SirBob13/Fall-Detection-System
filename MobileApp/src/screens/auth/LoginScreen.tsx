import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { StackNavigationProp } from '@react-navigation/stack';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import { jwtDecode } from 'jwt-decode';

import { authService } from '../../services/auth.service';
import { UserCredentials } from '../../types/auth';

WebBrowser.maybeCompleteAuthSession();

type RootStackParamList = {
  Auth: undefined;
  MainTabs: undefined;
  Register: undefined;
  Login: { prefilledEmail?: string };
};

type LoginScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;
type LoginScreenRouteProp = RouteProp<RootStackParamList, 'Login'>;

const LoginSchema = Yup.object().shape({
  email: Yup.string()
    .email('Invalid email address')
    .required('Email is required'),
  password: Yup.string()
    .min(6, 'Password must be at least 6 characters')
    .required('Password is required'),
});

export const LoginScreen: React.FC = () => {
  const route = useRoute<LoginScreenRouteProp>();
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Login with Biometrics');
  const [biometricIcon, setBiometricIcon] = useState<'fingerprint' | 'face-recognition' | 'shield-check'>('fingerprint');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const prefilledEmail = route.params?.prefilledEmail || '';
  const [databaseStatus, setDatabaseStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);

  const googleAuthConfig = Constants.expoConfig?.extra?.googleAuth || {};
  const googleRedirectUri = makeRedirectUri({
    scheme: Constants.expoConfig?.scheme || 'fall-detection',
  });
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useIdTokenAuthRequest({
    expoClientId: googleAuthConfig.expoClientId,
    iosClientId: googleAuthConfig.iosClientId,
    androidClientId: googleAuthConfig.androidClientId,
    webClientId: googleAuthConfig.webClientId || googleAuthConfig.expoClientId,
    redirectUri: googleRedirectUri,
    selectAccount: true,
  });
  
  // Prevent duplicate actions
  const connectionCheckedRef = useRef(false);
  const loginAttemptRef = useRef(false);

  useEffect(() => {
    if (!connectionCheckedRef.current) {
      checkDatabaseStatus();
      connectionCheckedRef.current = true;
    }

    checkBiometricSupport();
    checkAppleAvailability();
  }, []);

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const idToken = googleResponse.params?.id_token;
      if (!idToken) {
        Alert.alert('Google Login Error', 'Missing ID token from Google');
        return;
      }
      const decoded: any = jwtDecode(idToken);
      const userInfo = {
        id: decoded.sub,
        email: decoded.email,
        name: decoded.name || decoded.email?.split('@')[0] || 'User',
        photo: decoded.picture,
      };
      handleSocialAuth('google', idToken, userInfo);
    }
  }, [googleResponse]);

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
    if (biometricData.biometryType === 'FaceID') {
      setBiometricLabel('Login with Face ID');
      setBiometricIcon('face-recognition');
    } else if (biometricData.biometryType === 'TouchID') {
      setBiometricLabel('Login with Fingerprint');
      setBiometricIcon('fingerprint');
    } else {
      setBiometricLabel('Login with Biometrics');
      setBiometricIcon('shield-check');
    }
  };

  const checkAppleAvailability = async () => {
    if (Platform.OS !== 'ios') return;
    try {
      const available = await AppleAuthentication.isAvailableAsync();
      setAppleAvailable(available);
    } catch {
      setAppleAvailable(false);
    }
  };

  const handleSocialAuth = async (
    provider: 'google' | 'apple',
    token: string,
    userInfo: { id?: string; email?: string; name?: string; photo?: string }
  ) => {
    if (loading) return;
    setLoading(true);
    try {
      const response = await authService.socialLogin({
        provider,
        token,
        user_info: {
          id: userInfo.id || '',
          email: userInfo.email || '',
          name: userInfo.name || '',
          photo: userInfo.photo,
        },
      });

      if (!response.success) {
        Alert.alert('Login Error', response.message || 'Social login failed');
        return;
      }

      await authService.updateLastActivity();
      authService.invalidateCache('load-session');
      authService.invalidateCache('check-authentication');
    } catch (error: any) {
      Alert.alert('Login Error', error?.message || 'Social login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (values: UserCredentials) => {
    // Prevent double-click
    if (loginAttemptRef.current || loading) return;
    
    loginAttemptRef.current = true;
    setLoading(true);
    
    try {
      console.log('🔐 [Login] Starting login process...');
      
      if (databaseStatus === 'disconnected') {
        console.warn('⚠️ [Login] Connection check failed, attempting login anyway');
      }

      // Quick user existence check (only when we trust the connection)
      if (databaseStatus === 'connected') {
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
      }

      console.log('📤 [Login] Sending login request...');
      const response = await authService.login(values);
      
      console.log('📡 [Login] Response received');
      
      if (response.success && response.user && response.token) {
        await authService.updateLastActivity();
        
        console.log('✅ [Login] Successful, navigating...');

        // Invalidate cached auth/session so AppNavigator picks up the new session
        authService.invalidateCache('load-session');
        authService.invalidateCache('check-authentication');
        
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
      setLoading(true);
      const response = await authService.authenticateWithBiometrics();
      
      if (response.success) {
        await authService.updateLastActivity();
        
        console.log('✅ Biometric login successful');
      } else {
        Alert.alert('❌ Authentication Failed', response.message || 'Biometric authentication failed');
      }
    } catch (error: any) {
      Alert.alert('❌ Error', error.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'apple') => {
    if (provider === 'google') {
      if (!googleAuthConfig?.expoClientId && !googleAuthConfig?.iosClientId && !googleAuthConfig?.androidClientId) {
        Alert.alert('Google Login', 'Please set Google client IDs in app.json (extra.googleAuth).');
        return;
      }
      await googlePromptAsync({
        useProxy: Constants.appOwnership === 'expo',
        redirectUri: googleRedirectUri,
      });
      return;
    }

    if (provider === 'apple') {
      if (!appleAvailable) {
        Alert.alert('Apple Login', 'Apple Sign In is not available on this device.');
        return;
      }

      try {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });

        if (!credential.identityToken) {
          Alert.alert('Apple Login Error', 'Missing identity token');
          return;
        }

        const decoded: any = jwtDecode(credential.identityToken);
        const fullName =
          credential.fullName?.givenName || credential.fullName?.familyName
            ? `${credential.fullName?.givenName || ''} ${credential.fullName?.familyName || ''}`.trim()
            : undefined;

        const userInfo = {
          id: credential.user || decoded.sub,
          email: credential.email || decoded.email,
          name: fullName || decoded.email?.split('@')[0] || 'User',
        };

        await handleSocialAuth('apple', credential.identityToken, userInfo);
      } catch (error: any) {
        if (error?.code === 'ERR_CANCELED') return;
        Alert.alert('Apple Login Error', error?.message || 'Apple login failed');
      }
    }
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Forgot Password',
      'This feature will be available soon',
      [{ text: 'OK' }]
    );
  };

  const handleRegister = () => {
    navigation.navigate('Register');
  };

  const texts = {
    welcome: 'Welcome Back',
    subtitle: 'Your safety matters. Smart system for fall detection and rapid response',
    login: 'Login',
    or: 'Or',
    continueWith: 'Continue with',
    noAccount: "Don't have an account?",
    signUp: 'Sign up now',
    email: 'Email',
    password: 'Password',
    remember: 'Remember me',
    forgot: 'Forgot password?',
    biometric: biometricLabel,
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      style={{ flex: 1, backgroundColor: '#FFFFFF' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingBottom: 40 }}
        style={{ flex: 1, backgroundColor: '#FFFFFF' }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="items-center mb-8">
          <View className="w-32 h-32 rounded-full bg-gradient-to-r from-blue-50 to-blue-100 justify-center items-center mb-6">
            <MaterialCommunityIcons name="shield-check" size={60} color="#2196F3" />
          </View>
          <Text className="text-3xl font-bold text-dark mb-2">Fall Detection</Text>
          <Text className="text-xl font-semibold text-primary mb-3">{texts.welcome}</Text>
          <Text className="text-base text-gray text-center leading-6 max-w-md">
            {texts.subtitle}
          </Text>
        </View>

        {/* Connection Status */}
        {databaseStatus === 'checking' ? (
          <View className="flex-row items-center justify-center bg-blue-50 p-4 rounded-xl mb-6">
            <ActivityIndicator size="small" color="#2196F3" />
            <Text className="text-sm text-primary ml-3">
              Checking connection...
            </Text>
          </View>
        ) : databaseStatus === 'disconnected' && (
          <View className="flex-row items-center bg-orange-50 border border-orange-200 p-4 rounded-xl mb-6">
            <MaterialCommunityIcons name="wifi-off" size={20} color="#FF9800" />
            <View className="ml-3 flex-1">
              <Text className="text-sm font-medium text-dark">
                Limited Connection
              </Text>
              <Text className="text-xs text-gray mt-1">
                You can login later
              </Text>
            </View>
            <TouchableOpacity 
              onPress={checkDatabaseStatus} 
              className="p-2 bg-white rounded-full"
              activeOpacity={0.7}
            >
              <Text className="text-primary font-bold">⟳</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Login Form */}
        <Formik
          initialValues={{ email: prefilledEmail, password: '' }}
          enableReinitialize
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
            <View className="mb-6">
              {/* Email Field */}
              <View className="mb-5">
                <View className="flex-row items-center mb-2">
                  <MaterialCommunityIcons name="email-outline" size={18} color="#666" />
                  <Text className="text-base font-semibold text-dark ml-2">
                    {texts.email}
                  </Text>
                </View>
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
                  autoComplete="email"
                />
                {errors.email && touched.email && (
                  <Text className="error-text">{errors.email}</Text>
                )}
              </View>

              {/* Password Field */}
              <View className="mb-6">
                <View className="flex-row items-center mb-2">
                  <MaterialCommunityIcons name="lock-outline" size={18} color="#666" />
                  <Text className="text-base font-semibold text-dark ml-2">
                    {texts.password}
                  </Text>
                </View>
                <View className="relative">
                  <TextInput
                    className={`input-field pr-12 ${errors.password && touched.password ? 'border-danger' : ''}`}
                    placeholder="••••••••"
                    placeholderTextColor="#BDBDBD"
                    value={values.password}
                    onChangeText={handleChange('password')}
                    onBlur={handleBlur('password')}
                    secureTextEntry={!showPassword}
                    editable={!loading}
                    autoComplete="password"
                  />
                  <TouchableOpacity
                    className="absolute right-4 top-4"
                    onPress={() => setShowPassword(!showPassword)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={22}
                      color="#666"
                    />
                  </TouchableOpacity>
                </View>
                {errors.password && touched.password && (
                  <Text className="error-text">{errors.password}</Text>
                )}
              </View>

              {/* Remember Me and Forgot Password */}
              <View className="flex-row justify-between items-center mb-8">
                <TouchableOpacity
                  className="flex-row items-center"
                  onPress={() => setRememberMe(!rememberMe)}
                  activeOpacity={0.7}
                >
                  <View className={`
                    w-5 h-5 rounded border-2 flex items-center justify-center mr-2
                    ${rememberMe ? 'bg-primary border-primary' : 'border-gray'}
                  `}>
                    {rememberMe && (
                      <MaterialCommunityIcons name="check" size={12} color="#FFFFFF" />
                    )}
                  </View>
                  <Text className="text-sm text-gray">
                    {texts.remember}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={handleForgotPassword} activeOpacity={0.7}>
                  <Text className="text-sm text-primary font-semibold">
                    {texts.forgot}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Login Button */}
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
                    <MaterialCommunityIcons name="login" size={22} color="#FFF" />
                    <Text className="text-white font-bold text-lg ml-3">
                      {texts.login}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Biometric Authentication */}
              {biometricAvailable && databaseStatus === 'connected' && (
                <TouchableOpacity
                  className="flex-row justify-center items-center py-4 border-2 border-primary rounded-xl bg-blue-50 mb-4"
                  onPress={handleBiometricLogin}
                  disabled={loading}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name={biometricIcon} size={24} color="#2196F3" />
                  <Text className="text-primary font-semibold text-base ml-3">
                    {texts.biometric}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Message if database is disconnected */}
              {databaseStatus === 'disconnected' && (
                <View className="flex-row items-center bg-orange-50 border border-orange-200 p-4 rounded-xl mb-4">
                  <MaterialCommunityIcons name="wifi-off" size={20} color="#FF9800" />
                  <Text className="text-sm text-dark ml-3 flex-1">
                    You can login using your saved credentials
                  </Text>
                </View>
              )}
            </View>
          )}
        </Formik>

        {/* Divider */}
        {databaseStatus === 'connected' && (
          <>
            <View className="flex-row items-center my-6">
              <View className="flex-1 h-px bg-lightGray" />
              <Text className="text-sm text-gray mx-4">{texts.or}</Text>
              <View className="flex-1 h-px bg-lightGray" />
            </View>

            {/* Social Media Login */}
            <View className="mb-8">
              <Text className="text-sm text-gray text-center mb-4">
                {texts.continueWith}
              </Text>
              
              <View className="flex-row justify-center">
                <TouchableOpacity
                  className="flex-row items-center justify-center bg-red-500 rounded-xl py-3 px-6 mx-2"
                  onPress={() => handleSocialLogin('google')}
                  disabled={loading || !googleRequest}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="google" size={20} color="#FFF" />
                  <Text className="text-white font-semibold ml-2">Google</Text>
                </TouchableOpacity>

                {Platform.OS === 'ios' && appleAvailable && (
                  <TouchableOpacity
                    className="flex-row items-center justify-center bg-black rounded-xl py-3 px-6 mx-2"
                    onPress={() => handleSocialLogin('apple')}
                    disabled={loading}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="apple" size={20} color="#FFF" />
                    <Text className="text-white font-semibold ml-2">Apple</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </>
        )}

        {/* Registration Link */}
        <View className="flex-row justify-center items-center py-6 border-t border-lightGray">
          <Text className="text-base text-gray mr-2">{texts.noAccount}</Text>
          <TouchableOpacity 
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text className="text-primary font-bold text-base">
              {texts.signUp}
            </Text>
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <View className="items-center mt-4">
          <View className="flex-row items-center">
            <MaterialCommunityIcons name="shield" size={16} color="#757575" />
            <Text className="text-xs text-gray ml-2">Fall Detection App v1.0.0</Text>
          </View>
          <Text className="text-xs text-lightGray mt-1">© 2024 All rights reserved</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default LoginScreen;
