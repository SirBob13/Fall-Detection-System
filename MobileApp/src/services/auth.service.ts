
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Platform, Alert } from 'react-native';
import { API_CONFIG } from '../utils/constants';
import { AUTH_CONFIG } from '../constants/auth';
import { 
  AuthResponse, 
  UserCredentials, 
  RegisterData, 
  UserProfile, 
  SessionData,
  AccountStatus,
  UserSession,
  BiometricData
} from '../types/auth';

// فئة محسنة لإدارة الطلبات
class RequestManager {
  private static instance: RequestManager;
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 30000; // 30 ثانية

  static getInstance(): RequestManager {
    if (!RequestManager.instance) {
      RequestManager.instance = new RequestManager();
    }
    return RequestManager.instance;
  }

  async execute<T>(
    key: string,
    requestFn: () => Promise<T>,
    useCache: boolean = true
  ): Promise<T> {
    // التحقق من الكاش أولاً
    if (useCache) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        console.log(`📦 [Cache] Using cached data for: ${key}`);
        return cached.data;
      }
    }

    // منع الطلبات المتكررة
    if (this.pendingRequests.has(key)) {
      console.log(`⏳ [Queue] Request already pending for: ${key}`);
      return await this.pendingRequests.get(key)!;
    }

    // إنشاء طلب جديد
    const promise = (async () => {
      try {
        console.log(`🚀 [Request] Starting request for: ${key}`);
        const result = await requestFn();
        
        // حفظ في الكاش
        if (useCache) {
          this.cache.set(key, {
            data: result,
            timestamp: Date.now()
          });
        }
        
        return result;
      } finally {
        // إزالة من الطلبات المعلقة
        this.pendingRequests.delete(key);
        console.log(`✅ [Request] Completed request for: ${key}`);
      }
    })();

    this.pendingRequests.set(key, promise);
    return await promise;
  }

  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
      this.pendingRequests.delete(key);
    } else {
      this.cache.clear();
      this.pendingRequests.clear();
    }
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}

class AuthService {
  private static instance: AuthService;
  private baseURL: string;
  private currentSession: SessionData | null = null;
  private requestManager: RequestManager;
  private lastConnectionCheck: number = 0;
  private readonly CONNECTION_CACHE_DURATION = 60000; // دقيقة واحدة
  private connectionCheckInProgress: boolean = false;

  private constructor() {
    this.baseURL = `${API_CONFIG.BASE_URL}/auth`;
    this.requestManager = RequestManager.getInstance();
  }

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  // ==================== دالات الشبكة والاتصال ====================
  
  async checkNetwork(): Promise<boolean> {
    return await this.requestManager.execute(
      'network-status',
      async () => {
        try {
          const netInfo = await NetInfo.fetch();
          const isConnected = netInfo.isConnected ?? false;
          console.log('🌐 Network status:', isConnected);
          return isConnected;
        } catch (error) {
          console.error('Network check error:', error);
          return false;
        }
      },
      true // استخدام الكاش
    );
  }

  async testDatabaseConnection(): Promise<boolean> {
    const now = Date.now();
    
    // استخدام الكاش لتجنب التكرار
    if (now - this.lastConnectionCheck < this.CONNECTION_CACHE_DURATION) {
      console.log('📦 [Cache] Using cached connection status');
      return true; // نفترض أن الاتصال جيد لعدم عرقلة المستخدم
    }

    // منع طلبات متعددة متزامنة
    if (this.connectionCheckInProgress) {
      console.log('⏳ [Queue] Connection check already in progress');
      return true; // نعود بنجاح لعدم عرقلة العملية
    }

    this.connectionCheckInProgress = true;

    try {
      console.log('🔍 [Connection] Checking database connection...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${API_CONFIG.BASE_URL.replace('/auth', '')}/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.error('❌ Connection check HTTP error:', response.status);
        return false;
      }
      
      const data = await response.json();
      console.log('📊 [Connection] Response:', data);
      
      const isConnected = data.status === 'healthy';
      
      if (isConnected) {
        this.lastConnectionCheck = Date.now();
      }
      
      return isConnected;
      
    } catch (error) {
      console.error('❌ Connection check failed:', error);
      return false;
    } finally {
      this.connectionCheckInProgress = false;
    }
  }

  async checkUserExists(email: string): Promise<boolean> {
    return await this.requestManager.execute(
      `user-exists-${email}`,
      async () => {
        try {
          console.log(`🔍 [Email Check] Checking: ${email}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          
          const response = await fetch(`${this.baseURL}/check-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ email }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            console.warn(`⚠️ [Email Check] HTTP ${response.status} for ${email}`);
            return false; // نفترض أن البريد غير موجود في حالة الخطأ
          }
          
          const data = await response.json();
          const exists = data.exists === true;
          
          console.log(`📊 [Email Check] ${email} exists: ${exists}`);
          return exists;
          
        } catch (error) {
          console.warn(`⚠️ [Email Check] Error for ${email}:`, error);
          return false; // في حالة الخطأ، نفترض أن البريد غير موجود
        }
      },
      true // استخدام الكاش (تذكر أن البريد إما موجود أو لا)
    );
  }

  // ==================== التسجيل ====================
  
  async register(userData: RegisterData): Promise<AuthResponse> {
    try {
      console.log('📝 [Register] Starting registration process...');
      
      // فحص سريع للاتصال (بدون انتظار طويل)
      const isConnected = await this.testDatabaseConnection();
      if (!isConnected) {
        return {
          success: false,
          message: 'لا يمكن الاتصال بخادم قاعدة البيانات. يرجى التحقق من اتصال الإنترنت.',
        };
      }

      // تحقق سريع من وجود البريد
      const emailExists = await this.checkUserExists(userData.email);
      if (emailExists) {
        return {
          success: false,
          message: 'البريد الإلكتروني مسجل بالفعل في قاعدة البيانات',
          shouldRedirectToLogin: true
        };
      }

      // إعداد بيانات التسجيل
      const registerPayload = {
        name: userData.name,
        email: userData.email,
        phone: userData.phone || '',
        password: userData.password,
        confirm_password: userData.confirm_password,
        age: userData.age || null,
        gender: userData.gender || null,
        weight: userData.weight || null,
        height: userData.height || null,
        medical_conditions: userData.medical_conditions || '',
        emergency_contact: userData.emergency_contact || '',
      };

      console.log('📤 [Register] Sending registration request...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(`${this.baseURL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(registerPayload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      console.log('📡 [Register] Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [Register] Failed:', errorText);
        
        let errorMessage = 'فشل إنشاء الحساب في قاعدة البيانات';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 100)}`;
        }
        
        return {
          success: false,
          message: errorMessage,
        };
      }

      const result = await response.json();
      console.log('✅ [Register] Response:', result);

      if (result.success && result.access_token && result.user) {
        // حفظ الجلسة لمدة 30 يوم
        const session: SessionData = {
          user: {
            id: result.user.id?.toString() || '',
            email: result.user.email,
            name: result.user.name,
            phone: result.user.phone,
            age: result.user.age,
            gender: result.user.gender,
            weight: result.user.weight,
            height: result.user.height,
            medical_conditions: result.user.medical_conditions,
            emergency_contact: result.user.emergency_contact,
            created_at: result.user.created_at,
            updated_at: result.user.updated_at,
            is_active: result.user.is_active || true,
            email_verified: result.user.email_verified || false,
            phone_verified: result.user.phone_verified || false
          },
          token: result.access_token,
          refresh_token: result.refresh_token || result.access_token,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };

        await this.saveSession(session);
        await this.updateLastActivity();

        console.log('✅ [Register] Registration successful, session saved');
        
        return {
          success: true,
          user: session.user,
          token: result.access_token,
          message: 'تم إنشاء الحساب بنجاح في قاعدة البيانات',
        };
      } else {
        return {
          success: false,
          message: result.message || 'فشل إنشاء الحساب',
        };
      }
      
    } catch (error: any) {
      console.error('❌ [Register] Error:', error);
      
      return {
        success: false,
        message: `خطأ في الاتصال: ${error.message || 'غير معروف'}`,
        error: error.message,
      };
    }
  }

  // ==================== تسجيل الدخول ====================
  
  async login(credentials: UserCredentials): Promise<AuthResponse> {
    try {
      console.log('🔐 [Login] Starting login process...');
      
      // فحص سريع للاتصال
      const isConnected = await this.testDatabaseConnection();
      if (!isConnected) {
        return {
          success: false,
          message: 'لا يمكن الاتصال بخادم قاعدة البيانات. يرجى المحاولة لاحقاً.',
        };
      }

      console.log('📤 [Login] Sending login request...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(`${this.baseURL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      console.log('📡 [Login] Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [Login] Failed:', errorText);
        
        let errorMessage = 'فشل تسجيل الدخول من قاعدة البيانات';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 100)}`;
        }
        
        return {
          success: false,
          message: errorMessage,
        };
      }

      const result = await response.json();
      console.log('✅ [Login] Response received');

      if (result.success && result.access_token && result.user) {
        // حفظ الجلسة لمدة 30 يوم
        const session: SessionData = {
          user: {
            id: result.user.id?.toString() || '',
            email: result.user.email,
            name: result.user.name,
            phone: result.user.phone,
            age: result.user.age,
            gender: result.user.gender,
            weight: result.user.weight,
            height: result.user.height,
            medical_conditions: result.user.medical_conditions,
            emergency_contact: result.user.emergency_contact,
            created_at: result.user.created_at,
            updated_at: result.user.updated_at,
            is_active: result.user.is_active || true,
            email_verified: result.user.email_verified || false,
            phone_verified: result.user.phone_verified || false
          },
          token: result.access_token,
          refresh_token: result.refresh_token || result.access_token,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };

        await this.saveSession(session);
        await this.updateLastActivity();

        console.log('✅ [Login] Login successful, session saved');
        
        return {
          success: true,
          user: session.user,
          token: result.access_token,
          message: 'تم تسجيل الدخول بنجاح من قاعدة البيانات',
        };
      } else {
        return {
          success: false,
          message: 'استجابة غير صالحة من خادم قاعدة البيانات',
        };
      }
      
    } catch (error: any) {
      console.error('❌ [Login] Error:', error);
      
      return {
        success: false,
        message: `خطأ في الاتصال: ${error.message || 'غير معروف'}`,
        error: error.message,
      };
    }
  }

  // ==================== إدارة الجلسات ====================
  
  private async saveSession(session: SessionData): Promise<void> {
    try {
      this.currentSession = session;
      
      // حفظ الجلسة في AsyncStorage
      await AsyncStorage.setItem(
        AUTH_CONFIG.STORAGE_KEYS.USER_SESSION,
        JSON.stringify(session)
      );
      
      console.log('✅ [Session] Session saved successfully');
    } catch (error) {
      console.error('❌ [Session] Error saving session:', error);
      throw error;
    }
  }

  async loadSession(): Promise<SessionData | null> {
    return await this.requestManager.execute(
      'load-session',
      async () => {
        try {
          const sessionString = await AsyncStorage.getItem(
            AUTH_CONFIG.STORAGE_KEYS.USER_SESSION
          );
          
          if (sessionString) {
            const session = JSON.parse(sessionString) as SessionData;
            
            // التحقق من صحة الجلسة محلياً
            if (this.isSessionValid(session)) {
              this.currentSession = session;
              console.log('✅ [Session] Session loaded from storage');
              return session;
            } else {
              console.log('❌ [Session] Session expired, clearing...');
              await this.clearSession();
              return null;
            }
          }
          
          return null;
        } catch (error) {
          console.error('❌ [Session] Error loading session:', error);
          return null;
        }
      },
      true // استخدام الكاش (الجلسة لا تتغير كثيراً)
    );
  }

  private isSessionValid(session: SessionData): boolean {
    try {
      const expiresAt = new Date(session.expires_at);
      const now = new Date();
      
      // الجلسة صالحة إذا بقي لها أكثر من 5 دقائق
      const isValid = expiresAt.getTime() - now.getTime() > 5 * 60 * 1000;
      
      console.log(`⏰ [Session] Expires at: ${expiresAt.toLocaleString()}`);
      console.log(`✅ [Session] Valid: ${isValid}`);
      
      return isValid;
    } catch (error) {
      console.error('❌ [Session] Error checking session validity:', error);
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return await this.requestManager.execute(
      'check-authentication',
      async () => {
        try {
          // 1. تحميل الجلسة من AsyncStorage
          const session = await this.loadSession();
          
          if (!session) {
            console.log('❌ [Auth] No session found');
            return false;
          }
          
          console.log('✅ [Auth] Session found for:', session.user?.email);
          
          // 2. التحقق من صحة الجلسة محلياً (دون الاتصال بالخادم)
          const expiresAt = new Date(session.expires_at);
          const now = new Date();
          
          // الجلسة صالحة لمدة 30 يوم من التخزين
          const isSessionValid = expiresAt > now;
          
          if (!isSessionValid) {
            console.log('❌ [Auth] Session expired locally');
            await this.clearSession();
            return false;
          }
          
          // 3. تحديث آخر نشاط
          await this.updateLastActivity();
          
          console.log('✅ [Auth] User is authenticated (local check)');
          return true;
          
        } catch (error) {
          console.error('❌ [Auth] Error checking authentication:', error);
          return false;
        }
      },
      true // استخدام الكاش (نتائج المصادقة لا تتغير كثيراً)
    );
  }

  async updateUserActivity(userId: string): Promise<void> {
    try {
      const session = await this.loadSession();
      if (!session) return;
      
      // إرسال طلب تحديث النشاط للخادم (في الخلفية، لا ننتظر)
      fetch(`${this.baseURL}/update-activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      }).catch(error => {
        console.warn('⚠️ [Activity] Failed to update:', error);
      });
      
      // تحديث النشاط محلياً
      await this.updateLastActivity();
      
    } catch (error) {
      console.warn('⚠️ [Activity] Error updating:', error);
    }
  }

  async updateLastActivity(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        AUTH_CONFIG.STORAGE_KEYS.LAST_ACTIVITY,
        Date.now().toString()
      );
    } catch (error) {
      console.error('❌ [Activity] Error updating:', error);
    }
  }

  async logout(): Promise<AuthResponse> {
    try {
      // إرسال طلب تسجيل الخروج للخادم (لا ننتظر)
      const session = await this.loadSession();
      if (session) {
        fetch(`${this.baseURL}/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.token}`,
          },
        }).catch(error => {
          console.warn('⚠️ [Logout] Server logout failed:', error);
        });
      }
      
      // مسح الجلسة محلياً
      await this.clearSession();
      
      // مسح الكاش
      this.requestManager.clearCache();
      
      return {
        success: true,
        message: 'تم تسجيل الخروج بنجاح',
      };
    } catch (error: any) {
      console.error('❌ [Logout] Error:', error);
      return {
        success: false,
        message: 'حدث خطأ أثناء تسجيل الخروج',
        error: error.message,
      };
    }
  }

  async clearSession(): Promise<void> {
    try {
      this.currentSession = null;
      await AsyncStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.USER_SESSION);
      await AsyncStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.LOGIN_ATTEMPTS);
      await AsyncStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.LAST_ACTIVITY);
      console.log('✅ [Session] Session cleared');
    } catch (error) {
      console.error('❌ [Session] Error clearing:', error);
    }
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    const session = await this.loadSession();
    return session?.user || null;
  }

  // ==================== أدوات مساعدة ====================
  
  async checkBiometricSupport(): Promise<BiometricData> {
    // هذه الدالة للتوافق مع الأنظمة التي تدعم البصمة
    return {
      isAvailable: false,
      biometryType: undefined,
      keysExist: false
    };
  }

  async authenticateWithBiometrics(): Promise<AuthResponse> {
    // حالياً لا ندعم المصادقة البيومترية
    return {
      success: false,
      message: 'المصادقة البيومترية غير مدعومة حالياً'
    };
  }

  async forgotPassword(email: string): Promise<AuthResponse> {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.baseURL}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        signal: controller.signal
      });
      
      if (response.ok) {
        const data = await response.json();
        return {
          success: data.success || false,
          message: data.message || 'تم إرسال رابط إعادة التعيين'
        };
      } else {
        return {
          success: false,
          message: 'فشل إرسال رابط إعادة التعيين'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `خطأ في الاتصال: ${error.message}`
      };
    }
  }

  async resetPassword(data: { token: string; password: string; confirm_password: string }): Promise<AuthResponse> {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.baseURL}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      
      if (response.ok) {
        const result = await response.json();
        return {
          success: result.success || false,
          message: result.message || 'تم إعادة تعيين كلمة المرور'
        };
      } else {
        return {
          success: false,
          message: 'فشل إعادة تعيين كلمة المرور'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `خطأ في الاتصال: ${error.message}`
      };
    }
  }

  async getAccountStatus(email: string): Promise<AccountStatus> {
    try {
      const exists = await this.checkUserExists(email);
      
      if (exists) {
        const session = await this.loadSession();
        return {
          exists: true,
          email_verified: session?.user?.email_verified || false,
          phone_verified: session?.user?.phone_verified || false,
          is_active: session?.user?.is_active || true,
          has_password: true,
          social_accounts: []
        };
      }
      
      return {
        exists: false,
        email_verified: false,
        phone_verified: false,
        is_active: false,
        has_password: false,
        social_accounts: []
      };
    } catch (error) {
      console.error('Error getting account status:', error);
      return {
        exists: false,
        email_verified: false,
        phone_verified: false,
        is_active: false,
        has_password: false,
        social_accounts: []
      };
    }
  }

  async getActiveSessions(): Promise<UserSession[]> {
    try {
      const session = await this.loadSession();
      if (!session) return [];
      
      return [{
        id: 'current-session',
        device_info: Platform.OS === 'ios' ? 'iPhone' : 'Android',
        ip_address: '127.0.0.1',
        created_at: new Date().toISOString(),
        expires_at: session.expires_at
      }];
    } catch (error) {
      console.error('Error getting active sessions:', error);
      return [];
    }
  }

  async terminateSession(sessionId: string): Promise<boolean> {
    try {
      if (sessionId === 'current-session') {
        await this.clearSession();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error terminating session:', error);
      return false;
    }
  }

  async refreshToken(oldToken: string): Promise<AuthResponse> {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.baseURL}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: oldToken }),
        signal: controller.signal
      });
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.success && result.access_token) {
          // تحديث الجلسة الحالية
          const session = await this.loadSession();
          if (session) {
            session.token = result.access_token;
            session.expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            await this.saveSession(session);
          }
          
          return {
            success: true,
            token: result.access_token,
            message: 'تم تجديد التوكن بنجاح'
          };
        }
      }
      
      return {
        success: false,
        message: 'فشل تجديد التوكن'
      };
    } catch (error: any) {
      return {
        success: false,
        message: `خطأ في الاتصال: ${error.message}`
      };
    }
  }

  // ==================== أدوات التطوير والتصحيح ====================
  
  async simulateConnectionError(): Promise<void> {
    console.log('🔧 Simulating connection error for testing');
    await AsyncStorage.setItem('@test:simulate_error', 'true');
  }

  async clearTestData(): Promise<void> {
    await AsyncStorage.removeItem('@test:simulate_error');
    console.log('🧹 Test data cleared');
  }

  async getSessionInfo(): Promise<{ isValid: boolean; expiresIn: string; userEmail: string }> {
    const session = await this.loadSession();
    if (!session) {
      return { isValid: false, expiresIn: '0 days', userEmail: '' };
    }
    
    const expiresAt = new Date(session.expires_at);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    return {
      isValid: diffDays > 0,
      expiresIn: `${diffDays} يوم`,
      userEmail: session.user.email
    };
  }

  // دالة جديدة لمسح الكاش المحدد
  invalidateCache(key: string): void {
    this.requestManager.invalidate(key);
  }

  // دالة لفحص حالة الكاش
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: 0, // سيتم تنفيذ هذا في RequestManager الفعلي
      keys: []
    };
  }
}

export const authService = AuthService.getInstance();