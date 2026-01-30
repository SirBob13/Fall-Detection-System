// ثوابت المصادقة
export const AUTH_CONFIG = {
  // إعدادات JWT
  TOKEN_EXPIRY: 7 * 24 * 60 * 60 * 1000, // 7 أيام
  REFRESH_TOKEN_EXPIRY: 30 * 24 * 60 * 60 * 1000, // 30 يوم
  
  // إعدادات التحقق
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION: 15 * 60 * 1000, // 15 دقيقة
  
  // إعدادات الخصوصية
  AUTO_LOGOUT: 30 * 60 * 1000, // 30 دقيقة من الخمول
  
  // ألوان المصادقة
  COLORS: {
    primary: '#2196F3',
    secondary: '#4CAF50',
    error: '#F44336',
    warning: '#FF9800',
    success: '#4CAF50',
    google: '#DB4437',
    apple: '#000000',
    facebook: '#1877F2',
  },
  
  // مسارات API
  ENDPOINTS: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    LOGOUT: '/auth/logout',
    REFRESH_TOKEN: '/auth/refresh',
    FORGOT_PASSWORD: '/auth/forgot-password',
    RESET_PASSWORD: '/auth/reset-password',
    VERIFY_EMAIL: '/auth/verify-email',
    VERIFY_PHONE: '/auth/verify-phone',
    PROFILE: '/auth/profile',
    UPDATE_PROFILE: '/auth/update-profile',
    CHANGE_PASSWORD: '/auth/change-password',
    DELETE_ACCOUNT: '/auth/delete-account',
  },
  
  // تخزين المفاتيح
  STORAGE_KEYS: {
    USER_SESSION: '@FallDetection:user_session',
    BIOMETRIC_KEY: '@FallDetection:biometric_key',
    LOGIN_ATTEMPTS: '@FallDetection:login_attempts',
    LAST_ACTIVITY: '@FallDetection:last_activity',
    ONBOARDING_COMPLETE: '@FallDetection:onboarding_complete',
  },
  
  // رسائل التحقق
  VALIDATION: {
    EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    PHONE_REGEX: /^\+?[1-9]\d{1,14}$/,
    PASSWORD_MIN: 8,
    PASSWORD_REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  },
  
  // رسائل الأخطاء
  ERROR_MESSAGES: {
    INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    ACCOUNT_LOCKED: 'تم تأمين الحساب مؤقتاً بسبب محاولات تسجيل دخول متعددة',
    NETWORK_ERROR: 'تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت',
    SESSION_EXPIRED: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
    EMAIL_EXISTS: 'البريد الإلكتروني مسجل بالفعل',
    INVALID_TOKEN: 'رمز التحقق غير صالح',
    BIOMETRIC_FAILED: 'فشلت المصادقة البيومترية',
  },
  
  // رسائل النجاح
  SUCCESS_MESSAGES: {
    LOGIN_SUCCESS: 'تم تسجيل الدخول بنجاح',
    REGISTER_SUCCESS: 'تم إنشاء الحساب بنجاح',
    LOGOUT_SUCCESS: 'تم تسجيل الخروج بنجاح',
    PASSWORD_RESET: 'تم إرسال رابط إعادة تعيين كلمة المرور',
    PROFILE_UPDATED: 'تم تحديث الملف الشخصي بنجاح',
  },
};

// نصوص الواجهة العربية
export const AUTH_TEXTS = {
  AR: {
    welcome: 'مرحباً بك في نظام كشف السقوط',
    login: {
      title: 'تسجيل الدخول',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      remember: 'تذكرني',
      forgot: 'نسيت كلمة المرور؟',
      noAccount: 'ليس لديك حساب؟',
      signUp: 'سجل الآن',
      or: 'أو',
      continueWith: 'المتابعة باستخدام',
    },
    register: {
      title: 'إنشاء حساب جديد',
      name: 'الاسم الكامل',
      phone: 'رقم الهاتف',
      confirmPassword: 'تأكيد كلمة المرور',
      terms: 'أوافق على الشروط والأحكام',
      haveAccount: 'لديك حساب بالفعل؟',
      signIn: 'تسجيل الدخول',
    },
    forgotPassword: {
      title: 'إعادة تعيين كلمة المرور',
      instruction: 'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين',
      send: 'إرسال الرابط',
      back: 'العودة لتسجيل الدخول',
    },
    resetPassword: {
      title: 'تعيين كلمة مرور جديدة',
      newPassword: 'كلمة المرور الجديدة',
      confirmNew: 'تأكيد كلمة المرور الجديدة',
      reset: 'إعادة التعيين',
    },
    biometric: {
      title: 'المصادقة البيومترية',
      enable: 'تمكين',
      disable: 'تعطيل',
      use: 'استخدام',
      skip: 'تخطي',
      description: 'استخدم بصمة الإصبع أو التعرف على الوجه لتسجيل الدخول بسرعة',
    },
    validation: {
      required: 'هذا الحقل مطلوب',
      invalidEmail: 'بريد إلكتروني غير صالح',
      invalidPhone: 'رقم هاتف غير صالح',
      passwordMatch: 'كلمتا المرور غير متطابقتين',
      passwordWeak: 'كلمة المرور ضعيفة. يجب أن تحتوي على حرف كبير وصغير ورقم ورمز خاص',
      minLength: 'يجب أن يكون على الأقل {min} أحرف',
      acceptTerms: 'يجب الموافقة على الشروط والأحكام',
    },
  },
};