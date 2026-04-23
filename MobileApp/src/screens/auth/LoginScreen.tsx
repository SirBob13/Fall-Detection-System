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
  AppState,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { NativeStackNavigationProp as StackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import { jwtDecode } from 'jwt-decode';

import { authService } from '../../services/auth.service';
import { LoadingScreen } from '../../components/LoadingScreen';
import { UserCredentials } from '../../types/auth';

type AuthStackParamList = {
  Register: undefined;
  Login: { prefilledEmail?: string } | undefined;
  ForgotPassword: { prefilledEmail?: string } | undefined;
  ResetPassword: { token: string };
};

type LoginScreenNavigationProp = StackNavigationProp<AuthStackParamList, 'Login'>;
type LoginScreenRouteProp = RouteProp<AuthStackParamList, 'Login'>;
type GoogleSigninModule = {
  GoogleSignin: {
    configure: (options: Record<string, unknown>) => void;
    hasPlayServices: (options?: Record<string, unknown>) => Promise<void>;
    signIn: () => Promise<any>;
  };
  isErrorWithCode: (error: unknown) => error is { code?: string; message?: string };
  isSuccessResponse: (result: any) => result is { data: { user: { id: string; email: string; name?: string | null; photo?: string | null }; idToken?: string | null } };
  statusCodes: {
    SIGN_IN_CANCELLED: string;
    IN_PROGRESS: string;
    PLAY_SERVICES_NOT_AVAILABLE: string;
  };
};

const LoginSchema = Yup.object().shape({
  email: Yup.string()
    .email('Invalid email address')
    .required('Email is required'),
  password: Yup.string()
    .min(6, 'Password must be at least 6 characters')
    .required('Password is required'),
});

const getGoogleSigninModule = (): GoogleSigninModule | null => {
  const isExpoGo =
    Constants.executionEnvironment === 'storeClient' ||
    Constants.appOwnership === 'expo';

  if (isExpoGo) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@react-native-google-signin/google-signin') as GoogleSigninModule;
  } catch (error) {
    console.warn('⚠️ [Google Login] Native Google Sign-In module is unavailable:', error);
    return null;
  }
};

let authCacheRefreshedForLogin = false;
let cachedAppleAvailability: boolean | null = null;
let appleAvailabilityPromise: Promise<boolean> | null = null;
let cachedLoginConnectionStatus: 'connected' | 'disconnected' | null = null;
let loginConnectionPromise: Promise<boolean> | null = null;
let initialLoginConnectionCheckStarted = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForAppToBeActive = async (settleMs: number = 700, timeoutMs: number = 6000) => {
  const isActive = () => AppState.currentState === 'active';

  if (isActive()) {
    await wait(settleMs);
    if (isActive()) {
      return;
    }
  }

  await new Promise<void>((resolve) => {
    let resolved = false;
    let activationTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (activationTimer) {
        clearTimeout(activationTimer);
      }
      subscription.remove();
      clearTimeout(timeoutId);
      resolve();
    };

    const handleStateChange = (nextState: string) => {
      if (nextState !== 'active') {
        if (activationTimer) {
          clearTimeout(activationTimer);
          activationTimer = null;
        }
        return;
      }

      if (activationTimer) {
        clearTimeout(activationTimer);
      }

      activationTimer = setTimeout(() => {
        if (isActive()) {
          finish();
        }
      }, settleMs);
    };

    const subscription = AppState.addEventListener('change', handleStateChange);
    const timeoutId = setTimeout(finish, timeoutMs);

    handleStateChange(AppState.currentState);
  });
};

export const LoginScreen: React.FC = () => {
  const route = useRoute<LoginScreenRouteProp>();
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Please wait...');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Login with Biometrics');
  const [biometricIcon, setBiometricIcon] = useState<'fingerprint' | 'face-recognition' | 'shield-check'>('fingerprint');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const prefilledEmail = route.params?.prefilledEmail || '';
  const [databaseStatus, setDatabaseStatus] = useState<'idle' | 'checking' | 'connected' | 'disconnected'>('idle');
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);

  const googleAuthConfig = Constants.expoConfig?.extra?.googleAuth || {};
  
  // Prevent duplicate actions
  const connectionCheckedRef = useRef(false);
  const loginAttemptRef = useRef(false);
  const socialAuthAttemptRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const loadingRef = useRef(false);
  const isCheckingConnectionRef = useRef(false);
  const lastForegroundRetryRef = useRef(0);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    isCheckingConnectionRef.current = isCheckingConnection;
  }, [isCheckingConnection]);

  useEffect(() => {
    const resetStaleLoginState = async () => {
      if (authCacheRefreshedForLogin) {
        return;
      }
      authCacheRefreshedForLogin = true;
      authService.invalidateCache('load-session');
      authService.invalidateCache('check-authentication');
    };

    resetStaleLoginState().catch((error) => {
      console.warn('⚠️ [Login] Failed to refresh auth cache:', error);
    });

    const googleModule = getGoogleSigninModule();
    googleModule?.GoogleSignin.configure({
      iosClientId: googleAuthConfig.iosClientId || undefined,
      webClientId: googleAuthConfig.webClientId || googleAuthConfig.expoClientId || undefined,
      offlineAccess: false,
      scopes: ['openid', 'profile', 'email'],
    });

    if (!connectionCheckedRef.current) {
      connectionCheckedRef.current = true;
      if (!initialLoginConnectionCheckStarted) {
        initialLoginConnectionCheckStarted = true;
        void checkDatabaseStatus({ silent: true });
      }
    }

    checkBiometricSupport();
    checkAppleAvailability();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const returningToForeground =
        appStateRef.current.match(/inactive|background/) && nextAppState === 'active';

      appStateRef.current = nextAppState;

      if (!returningToForeground) {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundRetryRef.current < 2500) {
        return;
      }

      if (
        !loadingRef.current &&
        !isCheckingConnectionRef.current &&
        cachedLoginConnectionStatus !== 'connected'
      ) {
        lastForegroundRetryRef.current = now;
        console.log('🔄 [Login] App returned to foreground, retrying connection check...');
        void checkDatabaseStatus({ silent: true });
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const checkDatabaseStatus = async (options?: { silent?: boolean; force?: boolean }) => {
    const silent = options?.silent ?? false;
    const force = options?.force ?? false;

    if (isCheckingConnection) return;

    if (!force && cachedLoginConnectionStatus) {
      setDatabaseStatus(cachedLoginConnectionStatus);
      return;
    }

    setIsCheckingConnection(true);
    try {
      console.log('🔍 [Login] Single database connection check...');
      if (!silent) {
        setDatabaseStatus('checking');
      }

      loginConnectionPromise ??= authService.testDatabaseConnection();
      const isConnected = await loginConnectionPromise;

      cachedLoginConnectionStatus = isConnected ? 'connected' : 'disconnected';
      setDatabaseStatus(cachedLoginConnectionStatus);
      console.log(`✅ [Login] Database ${cachedLoginConnectionStatus}`);
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError' || String(error?.message || '').includes('Abort');
      if (isAbort) {
        console.log('⏸️ [Login] Connection check aborted, keeping previous status');
        setDatabaseStatus((prev) => {
          if (prev === 'checking') {
            return cachedLoginConnectionStatus ?? 'idle';
          }
          return prev;
        });
      } else {
        cachedLoginConnectionStatus = 'disconnected';
        setDatabaseStatus('disconnected');
        console.log('⚠️ [Login] Database disconnected');
      }
    } finally {
      loginConnectionPromise = null;
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
    if (Platform.OS !== 'ios') {
      console.log('⚠️ [Apple Login] Not iOS, disabling Apple Sign-In');
      setAppleAvailable(false);
      return;
    }

    if (cachedAppleAvailability !== null) {
      setAppleAvailable(cachedAppleAvailability);
      return;
    }

    console.log('🔍 [Apple Login] Checking availability...');
    console.log('📱 Platform:', Platform.OS);

    try {
      appleAvailabilityPromise ??= AppleAuthentication.isAvailableAsync();
      const available = await appleAvailabilityPromise;
      cachedAppleAvailability = available;
      console.log('✅ [Apple Login] Apple Sign-In available:', available);
      setAppleAvailable(available);
    } catch (error) {
      console.log('❌ [Apple Login] Error checking availability:', error);
      cachedAppleAvailability = false;
      setAppleAvailable(false);
    } finally {
      appleAvailabilityPromise = null;
    }
  };

  const handleSocialAuth = async (
    provider: 'google' | 'apple',
    token: string,
    userInfo: { id?: string; email?: string; name?: string; photo?: string }
  ) => {
    if (loading || socialAuthAttemptRef.current) return;
    socialAuthAttemptRef.current = true;
    setLoadingMessage(provider === 'google' ? 'Signing in with Google...' : 'Signing in with Apple...');
    setLoading(true);
    try {
      await waitForAppToBeActive(500, 4000);
      console.log('📱 [Social Login] App is active, sending backend auth request...');

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

      const session = await authService.loadSession();
      const completion = authService.getProfileCompletion(session?.user);
      if (!completion.complete) {
        console.log('🧾 [Social Login] Profile incomplete, waiting for root navigator to route to onboarding');
      }
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError' || String(error?.message || '').includes('Abort');
      if (!isAbort) {
        await authService.clearSession();
        authService.invalidateCache('load-session');
        authService.invalidateCache('check-authentication');
      }
      Alert.alert(
        'Login Error',
        isAbort ? 'Login request timed out or was interrupted. Please try again.' : (error?.message || 'Social login failed')
      );
    } finally {
      socialAuthAttemptRef.current = false;
      setLoading(false);
    }
  };

  const handleLogin = async (values: UserCredentials) => {
    // Prevent double-click
    if (loginAttemptRef.current || loading) return;
    
    loginAttemptRef.current = true;
    setLoadingMessage('Signing you in...');
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
        await authService.clearSession();
        authService.invalidateCache('load-session');
        authService.invalidateCache('check-authentication');
        Alert.alert('❌ Login Error', response.message || 'Invalid credentials');
      }
    } catch (error: any) {
      console.error('❌ [Login] Error:', error);
      await authService.clearSession();
      authService.invalidateCache('load-session');
      authService.invalidateCache('check-authentication');
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
      setLoadingMessage('Authenticating securely...');
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
      const googleModule = getGoogleSigninModule();

      if (!googleModule) {
        Alert.alert(
          'Google Login',
          'Google login requires the development build, not Expo Go.'
        );
        return;
      }

      if (!googleAuthConfig?.iosClientId && !googleAuthConfig?.webClientId && !googleAuthConfig?.expoClientId) {
        Alert.alert('Google Login', 'Please set Google client IDs in app.json (extra.googleAuth).');
        return;
      }

      const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = googleModule;

      authService.setInteractiveAuthInProgress(true);
      try {
        if (Platform.OS === 'android') {
          await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        }

        const result = await GoogleSignin.signIn();
        if (!isSuccessResponse(result)) {
          return;
        }

        const { user, idToken } = result.data;

        if (!idToken) {
          Alert.alert('Google Login Error', 'Missing ID token from Google');
          return;
        }

        await handleSocialAuth('google', idToken, {
          id: user.id,
          email: user.email,
          name: user.name || user.email?.split('@')[0] || 'User',
          photo: user.photo || undefined,
        });
      } catch (error: any) {
        if (isErrorWithCode(error)) {
          if (error.code === statusCodes.SIGN_IN_CANCELLED) {
            return;
          }

          if (error.code === statusCodes.IN_PROGRESS) {
            Alert.alert('Google Login', 'Google sign-in is already in progress.');
            return;
          }

          if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
            Alert.alert('Google Login', 'Google Play Services are not available on this device.');
            return;
          }
        }

        Alert.alert('Google Login Error', error?.message || 'Google login failed');
      } finally {
        authService.setInteractiveAuthInProgress(false);
      }
      return;
    }

    if (provider === 'apple') {
      if (!appleAvailable) {
        Alert.alert('Apple Login', 'Apple Sign In is not available on this device.');
        return;
      }

      try {
        authService.setInteractiveAuthInProgress(true);
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
      } finally {
        authService.setInteractiveAuthInProgress(false);
      }
    }
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

  const googleConfigured = Boolean(
    googleAuthConfig?.iosClientId ||
    googleAuthConfig?.webClientId ||
    googleAuthConfig?.expoClientId
  );

  const networkStatusForLoading =
    databaseStatus === 'connected'
      ? 'connected'
      : databaseStatus === 'disconnected'
        ? 'disconnected'
        : 'checking';

  if (loading) {
    return (
      <LoadingScreen
        initializing={false}
        networkStatus={networkStatusForLoading}
        currentLanguage="en"
        loadingText={loadingMessage}
      />
    );
  }

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
        {databaseStatus === 'disconnected' && (
          <View className="flex-row items-center bg-orange-50 border border-orange-200 p-4 rounded-xl mb-6">
            <MaterialCommunityIcons name="wifi-off" size={20} color="#FF9800" />
            <View className="ml-3 flex-1">
              <Text className="text-sm font-medium text-dark">Limited Connection</Text>
              <Text className="text-xs text-gray mt-1">
                You can still try logging in, or retry the connection check.
              </Text>
            </View>
            <TouchableOpacity 
              onPress={() => checkDatabaseStatus({ force: true })} 
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
                  <Text className="text-sm text-gray">{texts.remember}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() =>
                    navigation.navigate('ForgotPassword', {
                      prefilledEmail: values.email || prefilledEmail,
                    })
                  }
                  activeOpacity={0.7}
                >
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

            <View className="gap-3">
              <TouchableOpacity
                className={`flex-row items-center justify-center bg-red-500 rounded-xl py-4 px-6 ${!googleConfigured ? 'opacity-60' : ''}`}
                onPress={() => handleSocialLogin('google')}
                disabled={loading}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="google" size={20} color="#FFF" />
                <Text className="text-white font-semibold ml-2">Continue with Google</Text>
              </TouchableOpacity>

              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  className={`flex-row items-center justify-center bg-black rounded-xl py-4 px-6 ${!appleAvailable ? 'opacity-60' : ''}`}
                  onPress={() => handleSocialLogin('apple')}
                  disabled={loading}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="apple" size={20} color="#FFF" />
                  <Text className="text-white font-semibold ml-2">Continue with Apple</Text>
                </TouchableOpacity>
              )}
            </View>

            {!googleConfigured && (
              <Text className="text-xs text-gray text-center mt-3">
                Google Sign-In is visible, but it still needs the configured client IDs to complete.
              </Text>
            )}

            {Platform.OS === 'ios' && !appleAvailable && (
              <Text className="text-xs text-gray text-center mt-2">
                Apple Sign-In is shown here and will work as soon as iOS confirms availability.
              </Text>
            )}

            {databaseStatus === 'disconnected' && (
              <Text className="text-xs text-orange-700 text-center mt-3">
                Connection is limited, but you can still try Google or Apple sign-in.
              </Text>
            )}
          </View>
        </>

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
