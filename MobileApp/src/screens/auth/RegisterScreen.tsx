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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp as StackNavigationProp } from '@react-navigation/native-stack';

import { authService } from '../../services/auth.service';
import { LoadingScreen } from '../../components/LoadingScreen';
import { RegisterData } from '../../types/auth';
import { transliterateArabic } from '../../utils/transliteration';
import { useLanguage } from '../../components/LanguageProvider';
import { requestEssentialPermissionsOnce } from '../../utils/permissions';

type AuthStackParamList = {
  Login: { prefilledEmail?: string };
  Register: undefined;
  ForgotPassword: undefined;
};

type RegisterScreenNavigationProp = StackNavigationProp<AuthStackParamList, 'Register'>;

type RegisterFormValues = {
  name: string;
  email: string;
  phone: string;
  age: string;
  gender: '' | 'male' | 'female';
  password: string;
  confirm_password: string;
  weight: string;
  height: string;
  medical_conditions: string;
  emergency_contact: string;
  accept_terms: boolean;
};

const ARABIC_DIGITS_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

const EASTERN_ARABIC_DIGITS_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

const normalizeToEnglishDigits = (value: string): string => {
  if (!value) return '';
  return value
    .replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS_MAP[digit] ?? digit)
    .replace(/[۰-۹]/g, (digit) => EASTERN_ARABIC_DIGITS_MAP[digit] ?? digit);
};

const normalizeTextInput = (value: string): string =>
  normalizeToEnglishDigits(transliterateArabic(value));
const normalizeEmailInput = (value: string): string => normalizeToEnglishDigits(value).trim();

const normalizeNumericInput = (value: string): string =>
  normalizeToEnglishDigits(value).replace(/[^0-9]/g, '');

const normalizePhoneInput = (value: string): string => {
  let normalized = normalizeToEnglishDigits(value).replace(/[^\d+]/g, '');
  if (normalized.includes('+')) {
    normalized = normalized.replace(/(?!^)\+/g, '');
  }
  return normalized;
};

const getReadableAuthMessage = (message: unknown): string => {
  if (typeof message === 'string') {
    return message;
  }

  if (message && typeof message === 'object') {
    const record = message as Record<string, unknown>;
    const nested = record.error ?? record.message ?? record.detail;
    if (typeof nested === 'string') {
      return nested;
    }

    try {
      return JSON.stringify(message);
    } catch {
      return '';
    }
  }

  return '';
};

// Egyptian phone number validation function
const validateEgyptianPhone = (phone: string): boolean => {
  if (!phone) return false;
  const normalized = normalizePhoneInput(phone);
  // Egyptian mobile numbers: 010/011/012/015 + 8 digits
  const phoneRegex = /^(?:\+20|0)?1[0125]\d{8}$/;
  return phoneRegex.test(normalized);
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
    ),
  age: Yup.string()
    .test('age-number', 'Age must be a number', (value) => {
      if (!value) return true;
      const normalized = normalizeNumericInput(value || '');
      return normalized.length > 0;
    })
    .test('age-min', 'Age cannot be negative', (value) => {
      if (!value) return true;
      const normalized = normalizeNumericInput(value || '');
      if (!normalized) return false;
      const numericAge = Number(normalized);
      return Number.isFinite(numericAge) && numericAge >= 0;
    })
    .test('age-max', 'Invalid age', (value) => {
      if (!value) return true;
      const normalized = normalizeNumericInput(value || '');
      if (!normalized) return false;
      const numericAge = Number(normalized);
      return Number.isFinite(numericAge) && numericAge <= 120;
    }),
  gender: Yup.string()
    .oneOf(['', 'male', 'female'], 'Must select male or female'),
  password: Yup.string()
    .min(8, 'Password must be at least 8 characters')
    .matches(
      /^(?=.*[A-Za-z])(?=.*\d)/,
      'Must contain letters and numbers'
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
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const isArabic = t('direction') === 'rtl';
  const copy = isArabic
    ? {
        successTitle: 'تم إنشاء الحساب بنجاح',
        successBody:
          'تم إنشاء حسابك بنجاح. بعد تسجيل الدخول، سيطلب منك التطبيق اختيار جهة طوارئ واحدة على الأقل من الهاتف حتى يتمكن من إرسال تنبيه سريع إذا حدثت حالة طارئة.',
        loginButton: 'تسجيل الدخول',
        genericError: 'حدثت مشكلة أثناء إنشاء الحساب. حاولي مرة أخرى.',
        emailExists: 'هذا البريد الإلكتروني مسجل بالفعل. يمكنك تسجيل الدخول مباشرة.',
        passwordMismatch: 'كلمتا المرور غير متطابقتين. راجعي الحقلين ثم حاولي مرة أخرى.',
        invalidEmail: 'من فضلك أدخلي بريدًا إلكترونيًا صحيحًا.',
        weakPassword: 'استخدمي كلمة مرور أقوى: 8 أحرف على الأقل وتحتوي على حروف وأرقام.',
        networkError: 'تعذر الاتصال بالسيرفر. تأكدي من الإنترنت ثم حاولي مرة أخرى.',
        noticeTitle: 'تنبيه',
        goToLogin: 'الذهاب لتسجيل الدخول',
        fallbackTitle: 'تعذر إكمال العملية',
        fallbackBody: 'لم نتمكن من إكمال التسجيل الآن. حاولي مرة أخرى بعد قليل.',
        loadingText: 'جاري إنشاء الحساب...',
        brandTitle: 'أنشئي حسابك',
        brandSubtitle: 'ابدئي استخدام كشف السقوط والتنبيهات السريعة بخطوات بسيطة.',
        helperText:
          'يمكنك إنشاء الحساب بالاسم والبريد وكلمة المرور فقط، ثم إكمال باقي البيانات لاحقًا.',
        badgeSecurity: 'حماية مستمرة',
        badgeAlerts: 'تنبيهات فورية',
        badgeSupport: 'دعم دائم',
        basicInfo: 'البيانات الأساسية',
        fullName: 'الاسم الكامل',
        fullNamePlaceholder: 'اكتبي اسمك الكامل',
        emailLabel: 'البريد الإلكتروني',
        phoneLabel: 'رقم الهاتف',
        phoneOptional: 'رقم الهاتف اختياري',
        egyptPhoneHint: 'يفضّل رقم مصري يبدأ بـ 010 أو 011 أو 012 أو 015',
        ageLabel: 'العمر',
        ageOptional: 'العمر اختياري',
        genderLabel: 'النوع',
        genderOptional: 'النوع اختياري',
        male: 'ذكر',
        female: 'أنثى',
        passwordSection: 'كلمة المرور',
        createPassword: 'أنشئي كلمة المرور',
        passwordHint: 'استخدمي 8 أحرف على الأقل وتضم حروفًا وأرقامًا.',
        confirmPassword: 'تأكيد كلمة المرور',
        passwordMatch: 'كلمتا المرور متطابقتان',
        passwordMismatchInline: 'كلمتا المرور غير متطابقتين',
        extraInfo: 'معلومات إضافية',
        optional: 'اختياري',
        extraInfoHint: 'يمكنك إضافة هذه البيانات الآن أو إكمالها لاحقًا من الإعدادات.',
        height: 'الطول (سم)',
        weight: 'الوزن (كجم)',
        emergencyContact: 'رقم طوارئ سريع',
        emergencyContactHint: 'هذا الرقم يساعدنا في الوصول السريع لشخص قريب منك عند الطوارئ.',
        medicalConditions: 'الحالات المرضية',
        medicalConditionsPlaceholder: 'مثل: ضغط، سكر، حساسية...',
        termsPrefix: 'أوافق على',
        terms: 'الشروط والأحكام',
        privacy: 'سياسة الخصوصية',
        createAccount: 'إنشاء الحساب',
        dataProtectedTitle: 'بياناتك في أمان',
        dataProtectedBody: 'نحفظ بياناتك بشكل آمن ومشفّر حتى تبقى معلوماتك الطبية والشخصية محمية.',
        alreadyHaveAccount: 'لديك حساب بالفعل؟',
        loginHere: 'سجلي الدخول',
        termsTitle: 'الشروط والأحكام',
        termsBody:
          'باستخدامك للتطبيق، أنت توافقين على:\n\n• استخدامه لمتابعة السلامة والصحة فقط\n• الحفاظ على سرية حسابك وبياناتك\n• إضافة بيانات صحيحة تساعد على الاستجابة وقت الطوارئ\n\nنحن نلتزم بتقديم خدمة آمنة وواضحة لك.',
        termsDone: 'فهمت',
        privacyTitle: 'خصوصيتك مهمة لنا',
        privacyBody:
          'نحترم خصوصيتك ونحافظ على بياناتك:\n\n• يتم حفظ بياناتك بشكل آمن\n• لا نشارك بياناتك بدون سبب واضح أو إذن منك\n• يمكنك تعديل بياناتك أو حذف حسابك لاحقًا\n• يمكنك إضافة أو تحديث جهات الطوارئ في أي وقت\n\nإذا احتجت أي مساعدة، سنوضح لك دائمًا ما الذي يتم استخدامه ولماذا.',
        privacyDone: 'شكرًا',
      }
    : {
        successTitle: 'Account created successfully',
        successBody:
          'Your account is ready. After login, the app will ask you to choose at least one emergency contact from your phone so alerts can reach someone quickly if you need help.',
        loginButton: 'Login',
        genericError: 'An error occurred during registration. Please try again.',
        emailExists: 'This email is already registered. You can login instead.',
        passwordMismatch: 'Passwords do not match. Please review both password fields.',
        invalidEmail: 'Please enter a valid email address.',
        weakPassword: 'Use a stronger password: at least 8 characters with letters and numbers.',
        networkError: 'Unable to connect to the server. Please check your internet and try again.',
        noticeTitle: 'Notice',
        goToLogin: 'Go to Login',
        fallbackTitle: 'Could not complete registration',
        fallbackBody: 'We could not finish registration right now. Please try again in a moment.',
        loadingText: 'Creating your account...',
        brandTitle: 'Create your account',
        brandSubtitle: 'Start using fall detection and fast emergency alerts in a few simple steps.',
        helperText:
          'You can create your account with your name, email, and password, then complete the rest later.',
        badgeSecurity: 'Always protected',
        badgeAlerts: 'Instant alerts',
        badgeSupport: 'Ongoing support',
        basicInfo: 'Basic information',
        fullName: 'Full name',
        fullNamePlaceholder: 'Enter your full name',
        emailLabel: 'Email address',
        phoneLabel: 'Phone number',
        phoneOptional: 'Phone number (optional)',
        egyptPhoneHint: 'Preferably an Egyptian mobile number starting with 010, 011, 012, or 015.',
        ageLabel: 'Age',
        ageOptional: 'Age (optional)',
        genderLabel: 'Gender',
        genderOptional: 'Gender (optional)',
        male: 'Male',
        female: 'Female',
        passwordSection: 'Password',
        createPassword: 'Create password',
        passwordHint: 'Use at least 8 characters with both letters and numbers.',
        confirmPassword: 'Confirm password',
        passwordMatch: 'Passwords match',
        passwordMismatchInline: 'Passwords do not match',
        extraInfo: 'Additional information',
        optional: 'Optional',
        extraInfoHint: 'You can add these details now or complete them later from settings.',
        height: 'Height (cm)',
        weight: 'Weight (kg)',
        emergencyContact: 'Quick emergency number',
        emergencyContactHint: 'This number helps us reach someone close to you quickly in an emergency.',
        medicalConditions: 'Medical conditions',
        medicalConditionsPlaceholder: 'For example: diabetes, hypertension, allergies...',
        termsPrefix: 'I agree to the',
        terms: 'Terms and Conditions',
        privacy: 'Privacy Policy',
        createAccount: 'Create account',
        dataProtectedTitle: 'Your data is protected',
        dataProtectedBody: 'Your personal and medical information is stored securely and encrypted.',
        alreadyHaveAccount: 'Already have an account?',
        loginHere: 'Login',
        termsTitle: 'Terms and Conditions',
        termsBody:
          'By using this app, you agree to:\n\n• use it for safety and health support purposes\n• keep your account and data secure\n• provide correct information that helps during emergencies\n\nWe are committed to keeping the experience clear, safe, and reliable.',
        termsDone: 'Understood',
        privacyTitle: 'Your privacy matters',
        privacyBody:
          'We respect your privacy and protect your data:\n\n• your information is stored securely\n• we do not share your data without a clear reason or your permission\n• you can update your details or delete your account later\n• you can add or change emergency contacts at any time\n\nIf any data is needed, we aim to make that clear and understandable.',
        privacyDone: 'Thank you',
      };
  
  const genderOptions = [
    { value: 'male', label: 'Male', icon: 'male' },
    { value: 'female', label: 'Female', icon: 'female' }
  ];

  const handleRegister = async (values: RegisterFormValues) => {
    try {
      setLoading(true);

      const normalizedValues: RegisterData = {
        ...values,
        name: normalizeTextInput(values.name || '').trim(),
        email: normalizeToEnglishDigits(values.email || '').trim().toLowerCase(),
        phone: values.phone ? normalizePhoneInput(values.phone) : undefined,
        age: values.age ? Number(normalizeNumericInput(String(values.age))) : undefined,
        gender: values.gender || undefined,
        weight: values.weight ? Number(normalizeNumericInput(String(values.weight))) : undefined,
        height: values.height ? Number(normalizeNumericInput(String(values.height))) : undefined,
        medical_conditions: values.medical_conditions ? normalizeTextInput(values.medical_conditions).trim() : undefined,
        emergency_contact: values.emergency_contact ? normalizePhoneInput(values.emergency_contact) : undefined,
      };
      
      // Attempt registration
      const response = await authService.register(normalizedValues);
      const responseMessage = getReadableAuthMessage(response.message);
      const responseMessageLower = responseMessage.toLowerCase();
      
      if (response.success) {
        await requestEssentialPermissionsOnce();
        Alert.alert(
          copy.successTitle,
          copy.successBody,
          [{ 
            text: copy.loginButton, 
            onPress: () => navigation.replace('Login', { prefilledEmail: normalizedValues.email })
        }]
      );
      } else {
        let userMessage = responseMessage || copy.genericError;
        const shouldRedirectToLogin =
          (response as any)?.shouldRedirectToLogin === true ||
          responseMessageLower.includes('already registered');
        
        if (responseMessageLower.includes('already registered')) {
          userMessage = copy.emailExists;
        } else if (responseMessageLower.includes('passwords do not match')) {
          userMessage = copy.passwordMismatch;
        } else if (responseMessageLower.includes('invalid email')) {
          userMessage = copy.invalidEmail;
        } else if (responseMessageLower.includes('password')) {
          userMessage = copy.weakPassword;
        } else if (
          responseMessageLower.includes('connection error') ||
          responseMessageLower.includes('timed out') ||
          responseMessageLower.includes('unable to connect')
        ) {
          userMessage = copy.networkError;
        }

        Alert.alert(
          copy.noticeTitle,
          userMessage,
          [
            {
              text: shouldRedirectToLogin ? copy.goToLogin : t('common.ok'),
              onPress: shouldRedirectToLogin
                ? () => navigation.navigate('Login', { prefilledEmail: normalizedValues.email })
                : undefined,
            },
          ]
        );
      }
    } catch (error) {
      console.error('Technical error:', error);
      Alert.alert(
        copy.fallbackTitle,
        copy.fallbackBody
      );
    } finally {
      setLoading(false);
    }
  };

  const openTerms = () => {
    Alert.alert(
      copy.termsTitle,
      copy.termsBody,
      [{ text: copy.termsDone }]
    );
  };

  const openPrivacyPolicy = () => {
    Alert.alert(
      copy.privacyTitle,
      copy.privacyBody,
      [{ text: copy.privacyDone }]
    );
  };

  if (loading) {
    return (
      <LoadingScreen
        initializing={false}
        networkStatus="checking"
        currentLanguage={isArabic ? 'ar' : 'en'}
        loadingText={copy.loadingText}
      />
    );
  }

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
              
              <Text className="text-2xl font-bold text-dark mb-3">{copy.brandTitle}</Text>
              <Text className="text-base text-gray text-center leading-6 max-w-md mb-6">
                {copy.brandSubtitle}
              </Text>
              
              {/* Benefits Badges */}
              <View className="bg-white border border-blue-100 px-4 py-3 rounded-2xl mb-5 w-full max-w-md">
                <Text className="text-sm text-blue-800 text-center leading-5">
                  {copy.helperText}
                </Text>
              </View>

              <View className="flex-row flex-wrap justify-center gap-2">
                <View className="flex-row items-center bg-white px-4 py-2 rounded-full shadow-sm">
                  <MaterialIcons name="security" size={16} color="#4CAF50" />
                  <Text className="text-sm text-dark ml-2 font-medium">{copy.badgeSecurity}</Text>
                </View>
                <View className="flex-row items-center bg-white px-4 py-2 rounded-full shadow-sm">
                  <MaterialIcons name="notifications-active" size={16} color="#2196F3" />
                  <Text className="text-sm text-dark ml-2 font-medium">{copy.badgeAlerts}</Text>
                </View>
                <View className="flex-row items-center bg-white px-4 py-2 rounded-full shadow-sm">
                  <MaterialIcons name="support-agent" size={16} color="#00BCD4" />
                  <Text className="text-sm text-dark ml-2 font-medium">{copy.badgeSupport}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Registration Form */}
          <Formik<RegisterFormValues>
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
                    <Text className="section-title mb-6">{copy.basicInfo}</Text>
                  
                  {/* Name Field */}
                  <View className="mb-5">
                    <Text className="input-label">{copy.fullName}</Text>
                    <TextInput
                      className={`input-field ${errors.name && touched.name ? 'border-danger' : ''}`}
                      placeholder={copy.fullNamePlaceholder}
                      placeholderTextColor="#BDBDBD"
                      value={values.name}
                      onChangeText={(text) => setFieldValue('name', normalizeTextInput(text))}
                      onBlur={handleBlur('name')}
                      editable={!loading}
                    />
                    {errors.name && touched.name && (
                      <Text className="error-text">{errors.name}</Text>
                    )}
                  </View>

                  {/* Email Field */}
                  <View className="mb-5">
                    <Text className="input-label">{copy.emailLabel}</Text>
                    <TextInput
                      className={`input-field ${errors.email && touched.email ? 'border-danger' : ''}`}
                      placeholder="example@email.com"
                      placeholderTextColor="#BDBDBD"
                      value={values.email}
                      onChangeText={(text) => setFieldValue('email', normalizeEmailInput(text))}
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
                    <Text className="input-label">{copy.phoneOptional}</Text>
                    <TextInput
                      className={`input-field ${errors.phone && touched.phone ? 'border-danger' : ''}`}
                      placeholder="01012345678"
                      placeholderTextColor="#BDBDBD"
                      value={values.phone}
                      onChangeText={(text) => setFieldValue('phone', normalizePhoneInput(text))}
                      onBlur={handleBlur('phone')}
                      keyboardType="phone-pad"
                      maxLength={13}
                      editable={!loading}
                    />
                    {errors.phone && touched.phone && (
                      <Text className="error-text">{errors.phone}</Text>
                    )}
                    <Text className="text-xs text-gray mt-2">
                      {copy.egyptPhoneHint}
                    </Text>
                  </View>

                  {/* Age Field */}
                  <View className="mb-5">
                    <Text className="input-label">{copy.ageOptional}</Text>
                    <TextInput
                      className={`input-field ${errors.age && touched.age ? 'border-danger' : ''}`}
                      placeholder="30"
                      placeholderTextColor="#BDBDBD"
                      value={values.age}
                      onChangeText={(text) => setFieldValue('age', normalizeNumericInput(text))}
                      onBlur={handleBlur('age')}
                      keyboardType="number-pad"
                      maxLength={3}
                      editable={!loading}
                    />
                    {errors.age && touched.age && (
                      <Text className="error-text">{errors.age}</Text>
                    )}
                  </View>

                  {/* Gender Field */}
                  <View className="mb-5">
                    <Text className="input-label">{copy.genderOptional}</Text>
                    <View className="flex-row">
                      {genderOptions.map((gender) => (
                        <TouchableOpacity
                          key={gender.value}
                          className={`flex-1 flex-row items-center justify-center py-3 mx-1 rounded-lg border ${
                            values.gender === gender.value
                              ? 'bg-primary border-primary'
                              : 'bg-light border-lightGray'
                          }`}
                          onPress={() => setFieldValue('gender', values.gender === gender.value ? '' : gender.value)}
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
                            {gender.value === 'male' ? copy.male : copy.female}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {errors.gender && touched.gender && (
                      <Text className="error-text">{errors.gender}</Text>
                    )}
                  </View>
                </View>

                {/* Password Section */}
                <View className="card mb-4">
                  <Text className="section-title mb-6">{copy.passwordSection}</Text>
                  
                  {/* Password Field */}
                  <View className="mb-5">
                    <Text className="input-label">{copy.createPassword}</Text>
                    <View className="relative">
                      <TextInput
                        className={`input-field pr-12 ${
                          errors.password && touched.password ? 'border-danger' : ''
                        }`}
                        placeholder="••••••••"
                        placeholderTextColor="#BDBDBD"
                        value={values.password}
                        onChangeText={(text) => setFieldValue('password', text)}
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
                      {copy.passwordHint}
                    </Text>
                  </View>

                  {/* Confirm Password Field */}
                  <View className="mb-2">
                    <Text className="input-label">{copy.confirmPassword}</Text>
                    <View className="relative">
                      <TextInput
                        className={`input-field pr-12 ${
                          errors.confirm_password && touched.confirm_password ? 'border-danger' : ''
                        }`}
                        placeholder="••••••••"
                        placeholderTextColor="#BDBDBD"
                        value={values.confirm_password}
                        onChangeText={(text) => setFieldValue('confirm_password', text)}
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
                            ? copy.passwordMatch
                            : copy.passwordMismatchInline}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Additional Information */}
                <View className="card mb-4">
                  <View className="flex-row items-center justify-between mb-4">
                      <Text className="section-title">{copy.extraInfo}</Text>
                      <View className="px-3 py-1 bg-lightGray/30 rounded-full">
                      <Text className="text-xs text-gray">{copy.optional}</Text>
                      </View>
                  </View>
                  
                  <Text className="text-sm text-gray mb-6 leading-5">
                    {copy.extraInfoHint}
                  </Text>
                  
                  {/* Height and Weight Row */}
                  <View className="flex-row mb-5">
                    <View className="flex-1 mr-2">
                      <Text className="input-label">{copy.height}</Text>
                      <TextInput
                        className="input-field"
                        placeholder="170"
                        placeholderTextColor="#BDBDBD"
                        value={values.height}
                        onChangeText={(text) => setFieldValue('height', normalizeNumericInput(text))}
                        onBlur={handleBlur('height')}
                        keyboardType="numeric"
                        editable={!loading}
                      />
                    </View>
                    
                    <View className="flex-1 ml-2">
                      <Text className="input-label">{copy.weight}</Text>
                      <TextInput
                        className="input-field"
                        placeholder="70"
                        placeholderTextColor="#BDBDBD"
                        value={values.weight}
                        onChangeText={(text) => setFieldValue('weight', normalizeNumericInput(text))}
                        onBlur={handleBlur('weight')}
                        keyboardType="numeric"
                        editable={!loading}
                      />
                    </View>
                  </View>
                  
                  {/* Emergency Contact */}
                  <View className="mb-5">
                    <Text className="input-label">{copy.emergencyContact}</Text>
                    <TextInput
                      className="input-field"
                      placeholder={copy.phoneLabel}
                      placeholderTextColor="#BDBDBD"
                      value={values.emergency_contact}
                      onChangeText={(text) => setFieldValue('emergency_contact', normalizePhoneInput(text))}
                      onBlur={handleBlur('emergency_contact')}
                      keyboardType="phone-pad"
                      editable={!loading}
                    />
                    <Text className="text-xs text-gray mt-2">
                      {copy.emergencyContactHint}
                    </Text>
                  </View>
                  
                  {/* Medical Conditions */}
                  <View className="mb-2">
                    <Text className="input-label">{copy.medicalConditions}</Text>
                    <TextInput
                      className="input-field h-28 text-align-top"
                      placeholder={copy.medicalConditionsPlaceholder}
                      placeholderTextColor="#BDBDBD"
                      value={values.medical_conditions}
                      onChangeText={(text) => setFieldValue('medical_conditions', normalizeTextInput(text))}
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
                        {copy.termsPrefix}{' '}
                        <Text 
                          className="text-primary font-semibold" 
                          onPress={openTerms}
                        >
                          {copy.terms}
                        </Text>{' '}
                        {isArabic ? 'و' : 'and'}{' '}
                        <Text 
                          className="text-primary font-semibold" 
                          onPress={openPrivacyPolicy}
                        >
                          {copy.privacy}
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
                        {copy.createAccount}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Security Assurance */}
                <View className="flex-row items-center p-4 bg-green-50 rounded-xl border border-green-200 mb-6">
                  <MaterialIcons name="verified-user" size={24} color="#4CAF50" />
                  <View className="ml-3 flex-1">
                    <Text className="text-sm font-medium text-dark mb-1">
                      {copy.dataProtectedTitle}
                    </Text>
                    <Text className="text-xs text-gray">
                      {copy.dataProtectedBody}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </Formik>

          {/* Login Link */}
          <View className="flex-row justify-center items-center py-6 border-t border-lightGray mx-5">
            <Text className="text-base text-gray mr-2">{copy.alreadyHaveAccount}</Text>
            <TouchableOpacity 
              onPress={() => navigation.navigate('Login', {})}
              activeOpacity={0.7}
            >
              <Text className="text-primary font-bold text-base">{copy.loginHere}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
