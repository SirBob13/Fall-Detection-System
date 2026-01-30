export default {
  // تطبيق
  app: {
    name: "كشف السقوط",
    tagline: "نظام ذكي لاكتشاف السقوط",
    version: "الإصدار 2.0"
  },
    

  // أجزاء مشتركة
  common: {
    save: "حفظ",
    cancel: "إلغاء",
    confirm: "تأكيد",
    loading: "جاري التحميل...",
    error: "حدث خطأ",
    retry: "إعادة المحاولة",
    back: "رجوع",
    next: "التالي",
    finish: "إنهاء",
    search: "بحث",
    edit: "تعديل",
    delete: "حذف",
    update: "تحديث",
    create: "إنشاء",
    send: "إرسال",
    close: "إغلاق",
    done: "تم",
    yes: "نعم",
    no: "لا",
    ok: "حسناً",
    select: "اختيار",
    all: "الكل",
    none: "لا شيء",
    required: "مطلوب",
    optional: "اختياري",
    success: "نجاح",
    failed: "فشل",
    warning: "تحذير",
    info: "معلومات",
    years: "سنة",
    male: "ذكر",
    female: "أنثى",
    unknown: "غير معروف"
  },

  // اتجاه
  direction: "rtl",

  // لغة
  language: {
    title: "اللغة",
    arabic: "العربية",
    english: "الإنجليزية",
    change: "تغيير اللغة",
    changeTitle: "تغيير اللغة",
    changeMessage: "هل تريد تغيير اللغة إلى {{language}}؟",
    restartMessage: "سيتم إعادة تشغيل التطبيق لتطبيق التغييرات",
    current: "اللغة الحالية", 
    selectLanguage: "اختر لغتك المفضلة"
  },

  // شاشات المصادقة
  auth: {
    languageSwitch: "English / تغيير اللغة",
    languageOption: "English",
    welcome: "مرحباً بك في نظام كشف السقوط",
    login: {
      title: "تسجيل الدخول",
      email: "البريد الإلكتروني",
      password: "كلمة المرور",
      remember: "تذكرني",
      forgot: "نسيت كلمة المرور؟",
      noAccount: "ليس لديك حساب؟",
      signUp: "سجل الآن",
      or: "أو",
      continueWith: "المتابعة باستخدام",
      biometric: "تسجيل الدخول باستخدام البصمة",
    },
    register: {
      title: "إنشاء حساب جديد",
      name: "الاسم الكامل",
      phone: "رقم الهاتف",
      confirmPassword: "تأكيد كلمة المرور",
      terms: "أوافق على الشروط والأحكام",
      haveAccount: "لديك حساب بالفعل؟",
      signIn: "تسجيل الدخول"
    },
    forgotPassword: {
      title: "إعادة تعيين كلمة المرور",
      instruction: "أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين",
      send: "إرسال الرابط",
      back: "العودة لتسجيل الدخول"
    },
    resetPassword: {
      title: "تعيين كلمة مرور جديدة",
      newPassword: "كلمة المرور الجديدة",
      confirmNew: "تأكيد كلمة المرور الجديدة",
      reset: "إعادة التعيين"
    },
    biometric: {
      title: "المصادقة البيومترية",
      enable: "تمكين",
      disable: "تعطيل",
      use: "استخدام",
      skip: "تخطي",
      description: "استخدم بصمة الإصبع أو التعرف على الوجه لتسجيل الدخول بسرعة"
    }
  },

  // التحقق من الصحة
  validation: {
    required: "هذا الحقل مطلوب",
    invalidEmail: "بريد إلكتروني غير صالح",
    invalidPhone: "رقم هاتف غير صالح",
    passwordMatch: "كلمتا المرور غير متطابقتين",
    passwordWeak: "كلمة المرور ضعيفة. يجب أن تحتوي على حرف كبير وصغير ورقم ورمز خاص",
    minLength: "يجب أن يكون على الأقل {{min}} أحرف",
    maxLength: "يجب ألا يزيد عن {{max}} أحرف",
    acceptTerms: "يجب الموافقة على الشروط والأحكام"
  },

  // الشاشة الرئيسية
  home: {
    title: "الرئيسية",
    status: "حالة النظام",
    deviceConnected: "جهاز متصل",
    deviceDisconnected: "جهاز غير متصل",
    battery: "البطارية",
    fallRisk: "خطر السقوط",
    recentAlerts: "الإنذارات الأخيرة",
    noAlerts: "لا توجد إنذارات حالياً",
    everythingOk: "كل شيء على ما يرام 👍",
    safetyTips: "نصائح للسلامة",
    tip1: "تأكد من إزالة العوائق من مسارات المشي",
    tip2: "استخدم إضاءة جيدة في المنزل ليلاً",
    tip3: "ارتد أحذية مناسبة وغير زلقة",
    tip4: "احتفظ بجهاز الإنذار معك دائماً"
  },

  // الإنذارات
  alerts: {
    title: "الإنذارات",
    all: "الكل",
    pending: "قيد الانتظار",
    resolved: "تم الحل",
    critical: "حرجة",
    totalAlerts: "إجمالي الإنذارات",
    pendingAlerts: "قيد الانتظار",
    resolvedAlerts: "تم الحل",
    criticalAlerts: "حرجة",
    noAlerts: "لا توجد إنذارات",
    filter: "التصفية",
    acknowledge: "تأكيد الاستلام",
    resolve: "تم الحل",
    fallDetected: "تم اكتشاف سقوط",
    vitalAbnormal: "مؤشرات حيوية غير طبيعية",
    deviceOffline: "اتصال الجهاز مقطوع",
    recentAlerts: "الإنذارات الأخيرة"
  },

  // الطوارئ
  emergency: {
    title: "الطوارئ",
    sosButton: "طلب المساعدة",
    sosCountdown: "العد التنازلي للطوارئ",
    sosSending: "جاري إرسال الطلب...",
    emergencyContacts: "جهات الاتصال الطارئة",
    emergencySettings: "إعدادات نظام الطوارئ",
    testSystem: "اختبار نظام الطوارئ",
    testSMS: "اختبار إرسال SMS",
    contacts: {
      title: "جهات الاتصال الطارئة",
      add: "إضافة جهة اتصال",
      edit: "تعديل جهة اتصال",
      delete: "حذف جهة اتصال",
      import: "استيراد من الهاتف",
      name: "الاسم",
      phone: "رقم الهاتف",
      relationship: "العلاقة",
      priority: "الأولوية",
      active: "مفعل",
      high: "عالي",
      medium: "متوسط",
      low: "منخفض",
      family: "عائلة",
      friend: "صديق",
      doctor: "طبيب",
      neighbor: "جار",
      description: "إدارة الأرقام التي سيتم الاتصال بها في حالة الطوارئ"
    },
    settings: {
      title: "إعدادات نظام الطوارئ",
      autoCall: "الاتصال التلقائي بالطوارئ",
      sendSMS: "إرسال رسائل SMS",
      sendLocation: "إرسال الموقع الجغرافي",
      callAfterFall: "الاتصال بعد السقوط",
      countdown: "العد التنازلي للطوارئ",
      maxRetries: "عدد محاولات إعادة الاتصال",
      reset: "إعادة التعيين",
      clearHistory: "مسح السجل",
      description: "تخصيص كيفية عمل نظام الطوارئ والإشعارات"
    }
  },

  // الإعدادات
  settings: {
    title: "الإعدادات",
    profile: "الملف الشخصي",
    deviceInfo: "معلومات الجهاز",
    language: "اللغة", 
    changeLanguage: "تغيير اللغة", 
    generalSettings: "الإعدادات العامة",
    testSystem: "اختبار النظام",
    testNotifications: "اختبار الإشعارات",
    refreshData: "تحديث البيانات",
    actions: "الإجراءات",
    notifications: "الإشعارات",
    vibration: "الاهتزاز",
    sound: "الصوت",
    autoConnect: "الاتصال التلقائي",
    fallDetection: "كشف السقوط",
    vitalMonitoring: "مراقبة المؤشرات الحيوية",
    logout: "تسجيل الخروج",
    help: "المساعدة والدعم",
    privacy: "سياسة الخصوصية",
    about: "حول التطبيق"
  },

  // أخطاء
  errors: {
    network: "تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت",
    server: "خطأ في الخادم",
    unauthorized: "غير مصرح به",
    forbidden: "ممنوع الوصول",
    notFound: "غير موجود",
    timeout: "انتهت مهلة الاتصال",
    unknown: "حدث خطأ غير معروف"
  },

  // رسائل نجاح
  success: {
    saved: "تم الحفظ بنجاح",
    updated: "تم التحديث بنجاح",
    deleted: "تم الحذف بنجاح",
    sent: "تم الإرسال بنجاح",
    connected: "تم الاتصال بنجاح",
    registered: "تم التسجيل بنجاح",
    loggedIn: "تم تسجيل الدخول بنجاح",
    loggedOut: "تم تسجيل الخروج بنجاح"
  },

  // التواريخ والأوقات
  datetime: {
    today: "اليوم",
    yesterday: "أمس",
    daysAgo: "قبل {{count}} يوم",
    hoursAgo: "قبل {{count}} ساعة",
    minutesAgo: "قبل {{count}} دقيقة",
    secondsAgo: "قبل {{count}} ثانية"
  },

  // حالة النظام
  system: {
    connected: "متصل",
    disconnected: "غير متصل",
    good: "جيدة",
    medium: "متوسطة",
    low: "منخفضة",
    highRisk: "خطر مرتفع",
    mediumRisk: "خطر متوسط",
    lowRisk: "خطر منخفض",
    safe: "آمن",
    critical: "حرج",
    warning: "تحذير",
    info: "معلومات",
    unknown: "غير معروف",
    lastSeen: "آخر ظهور",
    version: "الإصدار"
  }
};