export default {
  // App
  app: {
    name: "Fall Detection",
    tagline: "Smart fall detection system",
    version: "Version 2.0"
  },

  // Common parts
  common: {
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    loading: "Loading...",
    error: "Error occurred",
    retry: "Retry",
    back: "Back",
    next: "Next",
    finish: "Finish",
    search: "Search",
    edit: "Edit",
    delete: "Delete",
    update: "Update",
    create: "Create",
    send: "Send",
    close: "Close",
    done: "Done",
    yes: "Yes",
    no: "No",
    ok: "OK",
    select: "Select",
    all: "All",
    none: "None",
    required: "Required",
    optional: "Optional",
    success: "Success",
    failed: "Failed",
    warning: "Warning",
    info: "Info",
    years: "years",
    male: "Male",
    female: "Female",
    unknown: "Unknown"
  },

  // Direction
  direction: "ltr",

  // Language
  language: {
    title: "Language",
    arabic: "Arabic",
    english: "English",
    change: "Change Language",
    changeTitle: "Change Language",
    changeMessage: "Do you want to change language to {{language}}?",
    restartMessage: "The app will restart to apply changes",
    current: "Current Language", 
    selectLanguage: "Select your preferred language"
  },

  // Authentication screens
  auth: {
    languageSwitch: "Arabic / تغيير اللغة",
    languageOption: "العربية",
    welcome: "Welcome to Fall Detection System",
    login: {
      title: "Login",
      email: "Email",
      password: "Password",
      remember: "Remember me",
      forgot: "Forgot password?",
      noAccount: "Don't have an account?",
      signUp: "Sign up now",
      or: "Or",
      continueWith: "Continue with",
      biometric: "Login with biometrics"
    },
    register: {
      title: "Create New Account",
      name: "Full name",
      phone: "Phone number",
      confirmPassword: "Confirm password",
      terms: "I agree to terms and conditions",
      haveAccount: "Already have an account?",
      signIn: "Sign in"
    },
    forgotPassword: {
      title: "Reset Password",
      instruction: "Enter your email and we'll send you a reset link",
      send: "Send link",
      back: "Back to login"
    },
    resetPassword: {
      title: "Set New Password",
      newPassword: "New password",
      confirmNew: "Confirm new password",
      reset: "Reset"
    },
    biometric: {
      title: "Biometric Authentication",
      enable: "Enable",
      disable: "Disable",
      use: "Use",
      skip: "Skip",
      description: "Use fingerprint or face recognition for quick login"
    }
  },

  // Validation
  validation: {
    required: "This field is required",
    invalidEmail: "Invalid email address",
    invalidPhone: "Invalid phone number",
    passwordMatch: "Passwords do not match",
    passwordWeak: "Weak password. Must contain uppercase, lowercase, number and special character",
    minLength: "Must be at least {{min}} characters",
    maxLength: "Must not exceed {{max}} characters",
    acceptTerms: "Must agree to terms and conditions"
  },

  // Home screen
  home: {
    title: "Home",
    status: "System Status",
    deviceConnected: "Device connected",
    deviceDisconnected: "Device disconnected",
    battery: "Battery",
    fallRisk: "Fall Risk",
    recentAlerts: "Recent Alerts",
    noAlerts: "No alerts currently",
    everythingOk: "Everything is OK 👍",
    safetyTips: "Safety Tips",
    tip1: "Ensure walkways are clear of obstacles",
    tip2: "Use good lighting at home during night",
    tip3: "Wear appropriate non-slip shoes",
    tip4: "Always keep the alert device with you"
  },

  // Alerts
  alerts: {
    title: "Alerts",
    all: "All",
    pending: "Pending",
    resolved: "Resolved",
    critical: "Critical",
    totalAlerts: "Total Alerts",
    pendingAlerts: "Pending",
    resolvedAlerts: "Resolved",
    criticalAlerts: "Critical",
    noAlerts: "No alerts",
    filter: "Filter",
    acknowledge: "Acknowledge",
    resolve: "Resolve",
    fallDetected: "Fall detected",
    vitalAbnormal: "Abnormal vitals",
    deviceOffline: "Device offline",
    recentAlerts: "Recent Alerts"
  },

  // Emergency
  emergency: {
    title: "Emergency",
    sosButton: "Request Help",
    sosCountdown: "SOS Countdown",
    sosSending: "Sending request...",
    emergencyContacts: "Emergency Contacts",
    emergencySettings: "Emergency System Settings",
    testSystem: "Test Emergency System",
    testSMS: "Test SMS sending",
    contacts: {
      title: "Emergency Contacts",
      add: "Add contact",
      edit: "Edit contact",
      delete: "Delete contact",
      import: "Import from phone",
      name: "Name",
      phone: "Phone number",
      relationship: "Relationship",
      priority: "Priority",
      active: "Active",
      high: "High",
      medium: "Medium",
      low: "Low",
      family: "Family",
      friend: "Friend",
      doctor: "Doctor",
      neighbor: "Neighbor",
      description: "Manage phone numbers to be called in emergencies"
    },
    settings: {
      title: "Settings",
      autoCall: "Auto call emergency",
      sendSMS: "Send SMS messages",
      sendLocation: "Send location",
      callAfterFall: "Call after fall",
      countdown: "SOS countdown",
      maxRetries: "Max retry attempts",
      reset: "Reset settings",
      clearHistory: "Clear history",
      description: "Customize how the emergency system and notifications work",
      language: "Language", 
      changeLanguage: "Change Language",
    }
  },

  // Settings
  settings: {
    title: "Settings",
    profile: "Profile",
    deviceInfo: "Device Info",
    generalSettings: "General Settings",
    testSystem: "Test System",
    testNotifications: "Test Notifications",
    refreshData: "Refresh Data",
    actions: "Actions",
    notifications: "Notifications",
    vibration: "Vibration",
    sound: "Sound",
    autoConnect: "Auto connect",
    fallDetection: "Fall detection",
    vitalMonitoring: "Vital monitoring",
    logout: "Logout",
    help: "Help & Support",
    privacy: "Privacy Policy",
    about: "About App"
  },

  // Errors
  errors: {
    network: "Cannot connect to server. Please check your internet connection",
    server: "Server error",
    unauthorized: "Unauthorized",
    forbidden: "Access forbidden",
    notFound: "Not found",
    timeout: "Connection timeout",
    unknown: "Unknown error occurred"
  },

  // Success messages
  success: {
    saved: "Saved successfully",
    updated: "Updated successfully",
    deleted: "Deleted successfully",
    sent: "Sent successfully",
    connected: "Connected successfully",
    registered: "Registered successfully",
    loggedIn: "Logged in successfully",
    loggedOut: "Logged out successfully"
  },

  // Dates and times
  datetime: {
    today: "Today",
    yesterday: "Yesterday",
    daysAgo: "{{count}} days ago",
    hoursAgo: "{{count}} hours ago",
    minutesAgo: "{{count}} minutes ago",
    secondsAgo: "{{count}} seconds ago"
  },

  // System status
  system: {
    connected: "Connected",
    disconnected: "Disconnected",
    good: "Good",
    medium: "Medium",
    low: "Low",
    highRisk: "High risk",
    mediumRisk: "Medium risk",
    lowRisk: "Low risk",
    safe: "Safe",
    critical: "Critical",
    warning: "Warning",
    info: "Info",
    unknown: "Unknown",
    lastSeen: "Last seen",
    version: "Version"
  }
};