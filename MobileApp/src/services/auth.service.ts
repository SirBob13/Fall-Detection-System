import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Platform, Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { API_CONFIG } from '../utils/constants';
import { AUTH_CONFIG } from '../constants/auth';
import { notificationService } from './notifications';
import { 
  AuthResponse, 
  UserCredentials, 
  RegisterData, 
  UserProfile, 
  SessionData,
  AccountStatus,
  UserSession,
  BiometricData,
  SocialLoginData
} from '../types/auth';

// ==================== Types Enhancements ====================

// إضافة أنواع جديدة لنتائج التحقق
interface ValidationResult {
  isValid: boolean;
  reason?: string;
  needsRefresh?: boolean;
  session?: SessionData | null;
}

interface SessionDetails {
  session: SessionData | null;
  validation: ValidationResult;
  deviceInfo: string;
  remainingTime: string;
  lastActivity?: string;
}

// ==================== Enhanced Request Manager ====================

class RequestManager {
  private static instance: RequestManager;
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 30000; // 30 seconds

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
    // Check cache first
    if (useCache) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        console.log(`📦 [Cache] Using cached data for: ${key}`);
        return cached.data;
      }
    }

    // Prevent duplicate requests
    if (this.pendingRequests.has(key)) {
      console.log(`⏳ [Queue] Request already pending for: ${key}`);
      return await this.pendingRequests.get(key)!;
    }

    // Create new request
    const promise = (async () => {
      try {
        console.log(`🚀 [Request] Starting request for: ${key}`);
        const result = await requestFn();
        
        // Save to cache
        if (useCache) {
          this.cache.set(key, {
            data: result,
            timestamp: Date.now()
          });
        }
        
        return result;
      } finally {
        // Remove from pending requests
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

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

const safeRegisterPushToken = async (token?: string) => {
  if (!token) return;
  try {
    await notificationService.registerPushToken(token);
  } catch (error) {
    console.warn('⚠️ Push token registration failed:', error);
  }
};

// ==================== Enhanced Auth Service ====================

class AuthService {
  private static instance: AuthService;
  private baseURL: string;
  private currentSession: SessionData | null = null;
  private requestManager: RequestManager;
  private lastConnectionCheck: number = 0;
  private readonly CONNECTION_CACHE_DURATION = 60000; // 1 minute
  private connectionCheckInProgress: boolean = false;
  private sessionMonitorInterval: NodeJS.Timeout | null = null;
  private sessionTimeoutListeners: Set<() => void> = new Set();
  private authStateListeners: Set<(isAuthenticated: boolean) => void> = new Set();

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

  // ==================== Enhanced Session Validation Functions ====================

  async validateSession(options?: { 
    skipServerCheck?: boolean; 
    autoRefresh?: boolean;
  }): Promise<ValidationResult> {
    try {
      // Load session from local storage
      const session = await this.loadSession();
      if (!session) {
        return { 
          isValid: false, 
          reason: 'No active session found',
          session: null
        };
      }

      // Local validation first (fast)
      const expiresAt = new Date(session.expires_at);
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      
      // If session is expired locally
      if (timeUntilExpiry <= 0) {
        console.log('❌ [Session] Locally expired');
        return { 
          isValid: false, 
          reason: 'Session expired locally',
          needsRefresh: true,
          session
        };
      }

      // If session is about to expire (less than 5 minutes)
      const isNearExpiry = timeUntilExpiry < 5 * 60 * 1000; // 5 minutes
      
      // If we requested to skip server check
      if (options?.skipServerCheck) {
        return { 
          isValid: true, 
          needsRefresh: isNearExpiry,
          session
        };
      }

      // Validate with server (if we're not near expiry)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(`${this.baseURL}/validate-token`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.token}`,
            'Content-Type': 'application/json',
            'X-Client-Version': API_CONFIG.VERSION || '1.0.0',
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          console.log('✅ [Session] Server validation successful');
          return { 
            isValid: true, 
            needsRefresh: isNearExpiry,
            session
          };
        } else if (response.status === 401) {
          console.log('⚠️ [Session] Token invalid on server');
          
          // Try to auto-refresh token if enabled
          if (options?.autoRefresh) {
            const refreshResult = await this.smartTokenRefresh();
            if (refreshResult.success) {
              console.log('✅ [Session] Token refreshed successfully');
              const newSession = await this.loadSession();
              return { 
                isValid: true, 
                needsRefresh: false,
                session: newSession
              };
            }
          }
          
          return { 
            isValid: false, 
            reason: 'Token invalid on server',
            needsRefresh: true,
            session
          };
        } else {
          console.warn(`⚠️ [Session] Server error: ${response.status}`);
          // On server error, rely on local validation
          return { 
            isValid: !isNearExpiry, // Consider valid if not near expiry
            reason: `Server error: ${response.status}`,
            needsRefresh: isNearExpiry,
            session
          };
        }
        
      } catch (error) {
        console.warn('⚠️ [Session] Network error during validation:', error);
        // On network issue, rely on local validation
        return { 
          isValid: !isNearExpiry, // Consider valid if not near expiry
          reason: 'Network error, using local validation',
          needsRefresh: isNearExpiry,
          session
        };
      }
      
    } catch (error) {
      console.error('❌ [Session] Validation error:', error);
      return { 
        isValid: false, 
        reason: 'Validation process failed',
        session: null
      };
    }
  }

  /**
   * Start background session monitoring
   */
  async startSessionMonitor(intervalMinutes: number = 15): Promise<void> {
    console.log('👁️ [Session Monitor] Starting...');
    
    // Stop any existing monitor
    this.stopSessionMonitor();
    
    this.sessionMonitorInterval = setInterval(async () => {
      try {
        console.log('👁️ [Session Monitor] Checking session...');
        const validation = await this.validateSession({ 
          skipServerCheck: false,
          autoRefresh: true 
        });
        
        if (!validation.isValid) {
          console.log('🔄 [Session Monitor] Session invalid, triggering refresh...');
          this.sessionTimeoutListeners.forEach((listener) => {
            try {
              listener();
            } catch (err) {
              console.warn('⚠️ [Session Monitor] Listener error:', err);
            }
          });
          // Emit event for UI refresh
          // EventEmitter.emit('session-expired');
          
          // Try automatic refresh
          await this.smartTokenRefresh();
        } else if (validation.needsRefresh && validation.session) {
          console.log('🔄 [Session Monitor] Session near expiry, refreshing...');
          await this.smartTokenRefresh();
        } else {
          console.log('✅ [Session Monitor] Session is valid');
        }
      } catch (error) {
        console.warn('⚠️ [Session Monitor] Error:', error);
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop session monitoring
   */
  stopSessionMonitor(): void {
    if (this.sessionMonitorInterval) {
      clearInterval(this.sessionMonitorInterval);
      this.sessionMonitorInterval = null;
      console.log('👁️ [Session Monitor] Stopped');
    }
  }

  onSessionTimeout(listener: () => void): { remove: () => void } {
    this.sessionTimeoutListeners.add(listener);
    return {
      remove: () => {
        this.sessionTimeoutListeners.delete(listener);
      }
    };
  }

  onAuthStateChanged(listener: (isAuthenticated: boolean) => void): { remove: () => void } {
    this.authStateListeners.add(listener);
    return {
      remove: () => {
        this.authStateListeners.delete(listener);
      }
    };
  }

  private emitAuthState(isAuthenticated: boolean): void {
    this.authStateListeners.forEach((listener) => {
      try {
        listener(isAuthenticated);
      } catch (error) {
        console.warn('⚠️ [Auth State] Listener error:', error);
      }
    });
  }

  /**
   * Ensure session is valid before performing critical operation
   */
  async ensureValidSession(operation: string): Promise<boolean> {
    console.log(`🔐 [Ensure Session] Checking for operation: ${operation}`);
    
    const validation = await this.validateSession({ 
      skipServerCheck: false,
      autoRefresh: true 
    });
    
    if (!validation.isValid) {
      console.error(`❌ [Ensure Session] Cannot perform "${operation}" - Session invalid: ${validation.reason}`);
      
      // Show alert to user
      if (Platform.OS !== 'web') {
        Alert.alert(
          'Session Expired',
          'Please login again to continue',
          [
            { text: 'Login', onPress: () => {
              // Navigate to login screen
              // navigation.navigate('Login');
            }},
            { text: 'Later', style: 'cancel' }
          ]
        );
      }
      
      return false;
    }
    
    console.log(`✅ [Ensure Session] Session valid for: ${operation}`);
    return true;
  }

  /**
   * Smart token refresh with request management
   */
  async smartTokenRefresh(): Promise<AuthResponse> {
    try {
      const session = await this.loadSession();
      if (!session) {
        return { success: false, message: 'No session found' };
      }
      
      console.log('🔄 [Smart Refresh] Refreshing token...');
      
      // Cancel any pending refresh requests for same token
      const cacheKey = `refresh-${session.token.substring(0, 10)}`;
      this.requestManager.invalidate(cacheKey);
      
      const result = await this.requestManager.execute(
        cacheKey,
        async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          
          const response = await fetch(`${this.baseURL}/refresh`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.token}`
            },
            body: JSON.stringify({ 
              refresh_token: session.refresh_token,
              device_id: await this.getDeviceId()
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Token refresh failed`);
          }
          
          const data = await response.json();
          
          if (data.success && data.access_token) {
            // Update session
            const updatedSession: SessionData = {
              ...session,
              token: data.access_token,
              refresh_token: data.refresh_token || data.access_token,
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              last_refresh: new Date().toISOString()
            };
            
            await this.saveSession(updatedSession);
            
            // Clear old request cache
            this.requestManager.clearCache();
            
            return {
              success: true,
              token: data.access_token,
              message: 'Token refreshed successfully'
            };
          } else {
            throw new Error(data.message || 'Invalid refresh response');
          }
        },
        false // Don't use cache for token refresh
      );
      
      return result;
    } catch (error: any) {
      console.error('❌ [Smart Refresh] Error:', error);
      return {
        success: false,
        message: `Token refresh failed: ${error.message}`,
        shouldLogout: true
      };
    }
  }

  /**
   * Get device identifier
   */
  private async getDeviceId(): Promise<string> {
    try {
      let deviceId = await AsyncStorage.getItem('@auth:device_id');
      if (!deviceId) {
        deviceId = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await AsyncStorage.setItem('@auth:device_id', deviceId);
      }
      return deviceId;
    } catch (error) {
      return 'unknown-device';
    }
  }

  /**
   * Login with session validation
   */
  async loginWithValidation(credentials: UserCredentials): Promise<AuthResponse> {
    // Normal login
    const loginResult = await this.login(credentials);
    
    if (loginResult.success) {
      // Validate session after login
      const validation = await this.validateSession({ skipServerCheck: false });
      
      if (!validation.isValid) {
        console.warn('⚠️ Login succeeded but session validation failed');
        return {
          ...loginResult,
          warning: 'Login successful but session validation failed'
        };
      }
      
      // Start session monitoring after successful login
      this.startSessionMonitor();
      
      return loginResult;
    }
    
    return loginResult;
  }

  /**
   * Get detailed session information
   */
  async getSessionDetails(): Promise<SessionDetails> {
    const session = await this.loadSession();
    const validation = await this.validateSession({ skipServerCheck: true });
    const deviceId = await this.getDeviceId();
    
    let remainingTime = 'N/A';
    let lastActivity = 'N/A';
    
    if (session) {
      // Calculate remaining time
      const expiresAt = new Date(session.expires_at);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      
      if (diffMs > 0) {
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        remainingTime = `${days} days ${hours} hours ${minutes} minutes`;
      } else {
        remainingTime = 'Expired';
      }
      
      // Get last activity
      try {
        const lastActivityTimestamp = await AsyncStorage.getItem(
          AUTH_CONFIG.STORAGE_KEYS.LAST_ACTIVITY
        );
        if (lastActivityTimestamp) {
          const lastActivityDate = new Date(parseInt(lastActivityTimestamp));
          lastActivity = lastActivityDate.toLocaleString();
        }
      } catch (error) {
        console.warn('Error getting last activity:', error);
      }
    }
    
    return {
      session,
      validation,
      deviceInfo: deviceId,
      remainingTime,
      lastActivity
    };
  }

  async updateProfile(userData: Partial<UserProfile>): Promise<AuthResponse> {
    try {
      const session = await this.loadSession();
      if (!session) {
        return { success: false, message: 'No active session' };
      }

      const response = await fetch(`${this.baseURL}/profile`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      });

      if (response.ok) {
        const result = await response.json();
        // Update local session
        const updatedSession: SessionData = {
          ...session,
          user: { ...session.user, ...userData }
        };
        
        await this.saveSession(updatedSession);
        
        // Invalidate profile cache
        this.requestManager.invalidate(`profile-${session.user.id}`);
        
        return { success: true, user: updatedSession.user };
      } else {
        return { success: false, message: 'Failed to update profile' };
      }
    } catch (error) {
      return { success: false, message: 'Network error' };
    }
  }

  // ==================== Network & Connectivity Functions ====================
  
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
      true // Use cache
    );
  }

  async testDatabaseConnection(): Promise<boolean> {
    const now = Date.now();
    
    // Use cache to avoid repeated checks
    if (now - this.lastConnectionCheck < this.CONNECTION_CACHE_DURATION) {
      console.log('📦 [Cache] Using cached connection status');
      return true; // Assume connection is good to not block user
    }

    // Prevent multiple concurrent connection checks
    if (this.connectionCheckInProgress) {
      console.log('⏳ [Queue] Connection check already in progress');
      return true; // Return success to not block operation
    }

    this.connectionCheckInProgress = true;

    try {
      console.log('🔍 [Connection] Checking database connection...');
      
      const controller = new AbortController();
      const timeoutMs = Math.max(API_CONFIG.TIMEOUT, 8000);
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const healthBase = API_CONFIG.BASE_URL.replace(/\/auth$/, '');
      
      const response = await fetch(`${healthBase}/health`, {
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
      
    } catch (error: any) {
      const message = error?.message || '';
      const isAbort = error?.name === 'AbortError' || message.includes('Abort');
      if (isAbort && this.lastConnectionCheck > 0) {
        console.warn('⚠️ [Connection] Health check timed out, using last known status');
        return true;
      }
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
            return false; // Assume email doesn't exist on error
          }
          
          const data = await response.json();
          const exists = data.exists === true;
          
          console.log(`📊 [Email Check] ${email} exists: ${exists}`);
          return exists;
          
        } catch (error) {
          console.warn(`⚠️ [Email Check] Error for ${email}:`, error);
          return false; // On error, assume email doesn't exist
        }
      },
      true // Use cache (email either exists or doesn't)
    );
  }

  // ==================== Registration ====================
  
  async register(userData: RegisterData): Promise<AuthResponse> {
    try {
      console.log('📝 [Register] Starting registration process...');
      
      // Quick connection check (without long wait)
      const isConnected = await this.testDatabaseConnection();
      if (!isConnected) {
        console.warn('⚠️ [Register] Connection check failed, attempting registration anyway');
      }

      // Quick email existence check
      const emailExists = await this.checkUserExists(userData.email);
      if (emailExists) {
        return {
          success: false,
          message: 'Email is already registered in the database',
          shouldRedirectToLogin: true
        };
      }

      // Prepare registration payload
      const registerPayload: Record<string, any> = {
        name: userData.name,
        email: userData.email,
        phone: userData.phone || '',
        password: userData.password,
        confirm_password: userData.confirm_password,
        age: userData.age ?? undefined,
        gender: userData.gender ?? undefined,
        medical_conditions: userData.medical_conditions || '',
        emergency_contact: userData.emergency_contact || '',
      };

      if (typeof userData.weight === 'number' && Number.isFinite(userData.weight)) {
        registerPayload.weight = userData.weight;
      }

      if (typeof userData.height === 'number' && Number.isFinite(userData.height)) {
        registerPayload.height = userData.height;
      }

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
        
        let errorMessage = 'Failed to create account in database';
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
        // Save session for 30 days
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
            phone_verified: result.user.phone_verified || false,
            profile_complete: result.user.profile_complete,
            missing_fields: result.user.missing_fields
          },
          token: result.access_token,
          refresh_token: result.refresh_token || result.access_token,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };

        await this.saveSession(session);
        await this.updateLastActivity();

        // Start session monitoring
        this.startSessionMonitor();

        // Invalidate cached email existence and auth/session checks
        if (userData.email) {
          this.invalidateCache(`user-exists-${userData.email}`);
        }
        this.invalidateCache('load-session');
        this.invalidateCache('check-authentication');

        // Notify listeners that auth state changed
        this.emitAuthState(true);

        await safeRegisterPushToken(result.access_token);

        console.log('✅ [Register] Registration successful, session saved');
        
        return {
          success: true,
          user: session.user,
          token: result.access_token,
          message: 'Account created successfully in database',
        };
      } else {
        return {
          success: false,
          message: result.message || 'Account creation failed',
        };
      }
      
    } catch (error: any) {
      console.error('❌ [Register] Error:', error);
      
      return {
        success: false,
        message: `Connection error: ${error.message || 'Unknown'}`,
        error: error.message,
      };
    }
  }

  // ==================== Login ====================
  
  async login(credentials: UserCredentials): Promise<AuthResponse> {
    try {
      console.log('🔐 [Login] Starting login process...');
      
      // Quick connection check
      const isConnected = await this.testDatabaseConnection();
      if (!isConnected) {
        console.warn('⚠️ [Login] Connection check failed, attempting login anyway');
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
        
        let errorMessage = 'Login failed from database';
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
        // Save session for 30 days
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
            phone_verified: result.user.phone_verified || false,
            profile_complete: result.user.profile_complete,
            missing_fields: result.user.missing_fields
          },
          token: result.access_token,
          refresh_token: result.refresh_token || result.access_token,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };

        await this.saveSession(session);
        await this.updateLastActivity();

        // Start session monitoring
        this.startSessionMonitor();

        // Notify listeners that auth state changed
        this.emitAuthState(true);

        await safeRegisterPushToken(result.access_token);

        console.log('✅ [Login] Login successful, session saved');
        
        return {
          success: true,
          user: session.user,
          token: result.access_token,
          message: 'Login successful from database',
        };
      } else {
        return {
          success: false,
          message: 'Invalid response from database server',
        };
      }
      
    } catch (error: any) {
      console.error('❌ [Login] Error:', error);
      
      return {
        success: false,
        message: `Connection error: ${error.message || 'Unknown'}`,
        error: error.message,
      };
    }
  }

  // ==================== Social Login ====================

  async socialLogin(data: SocialLoginData): Promise<AuthResponse> {
    try {
      console.log(`🔐 [Social Login] Starting ${data.provider} login...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${this.baseURL}/social-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          provider: data.provider,
          token: data.token,
          user_info: data.user_info,
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('📡 [Social Login] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [Social Login] Failed:', errorText);

        let errorMessage = 'Social login failed';
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
      console.log('✅ [Social Login] Response received');

      if (result.success && result.access_token && result.user) {
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
            phone_verified: result.user.phone_verified || false,
            profile_complete: result.user.profile_complete,
            missing_fields: result.user.missing_fields
          },
          token: result.access_token,
          refresh_token: result.refresh_token || result.access_token,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };

        await this.saveSession(session);
        await this.updateLastActivity();
        this.startSessionMonitor();
        this.emitAuthState(true);

        await safeRegisterPushToken(result.access_token);

        return {
          success: true,
          user: session.user,
          token: result.access_token,
          message: result.message || 'Social login successful',
        };
      }

      return {
        success: false,
        message: result.message || 'Social login failed',
      };
    } catch (error: any) {
      console.error('❌ [Social Login] Error:', error);
      return {
        success: false,
        message: `Connection error: ${error.message || 'Unknown'}`,
        error: error.message,
      };
    }
  }

  // ==================== Session Management ====================
  
  private async saveSession(session: SessionData): Promise<void> {
    try {
      this.currentSession = session;
      
      // Save session to AsyncStorage
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
            
            // Validate session locally
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
      true // Use cache (sessions don't change often)
    );
  }

  private isSessionValid(session: SessionData): boolean {
    try {
      const expiresAt = new Date(session.expires_at);
      const now = new Date();
      
      // Session is valid if more than 5 minutes remaining
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
          // 1. Load session from AsyncStorage
          const session = await this.loadSession();
          
          if (!session) {
            console.log('❌ [Auth] No session found');
            return false;
          }
          
          console.log('✅ [Auth] Session found for:', session.user?.email);
          
          // 2. Validate session locally (without server call)
          const expiresAt = new Date(session.expires_at);
          const now = new Date();
          
          // Session is valid for 30 days from storage
          const isSessionValid = expiresAt > now;
          
          if (!isSessionValid) {
            console.log('❌ [Auth] Session expired locally');
            await this.clearSession();
            return false;
          }
          
          // 3. Update last activity
          await this.updateLastActivity();
          
          console.log('✅ [Auth] User is authenticated (local check)');
          return true;
          
        } catch (error) {
          console.error('❌ [Auth] Error checking authentication:', error);
          return false;
        }
      },
      true // Use cache (authentication results don't change often)
    );
  }

  async updateUserActivity(userId: string): Promise<void> {
    try {
      const session = await this.loadSession();
      if (!session) return;
      
      // Send activity update to server (in background, don't wait)
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
      
      // Update activity locally
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
      // Stop session monitoring
      this.stopSessionMonitor();
      
      // Send logout request to server (don't wait)
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
      
      // Clear session locally
      await this.clearSession();

      // Notify listeners that auth state changed
      this.emitAuthState(false);
      
      // Clear cache
      this.requestManager.clearCache();
      
      return {
        success: true,
        message: 'Logged out successfully',
      };
    } catch (error: any) {
      console.error('❌ [Logout] Error:', error);
      return {
        success: false,
        message: 'Error occurred during logout',
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
      this.emitAuthState(false);
    } catch (error) {
      console.error('❌ [Session] Error clearing:', error);
    }
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    const session = await this.loadSession();
    return session?.user || null;
  }

  async updateCurrentUser(updates: Partial<UserProfile>): Promise<UserProfile | null> {
    const session = await this.loadSession();
    if (!session?.user) {
      return null;
    }

    const normalizedUpdates: Partial<UserProfile> = {
      ...updates,
      id: updates.id !== undefined ? String(updates.id) : session.user.id,
    };

    const updatedUser: UserProfile = {
      ...session.user,
      ...normalizedUpdates,
    };

    const completion = this.getProfileCompletion(updatedUser);
    updatedUser.profile_complete = completion.complete;
    updatedUser.missing_fields = completion.missing;

    const updatedSession: SessionData = {
      ...session,
      user: updatedUser,
    };

    await this.saveSession(updatedSession);
    this.requestManager.clearCache('load-session');
    this.emitAuthState(true);
    return updatedUser;
  }

  // ==================== Helper Functions ====================

  getProfileCompletion(user?: UserProfile): { complete: boolean; missing: string[] } {
    const missing: string[] = [];
    const name = (user?.name || '').trim();
    const phone = (user?.phone || '').trim();
    const age = user?.age;
    const gender = user?.gender;

    if (!name) missing.push('name');
    if (!phone) missing.push('phone');
    if (!age) missing.push('age');
    if (gender !== 'male' && gender !== 'female') missing.push('gender');

    return { complete: missing.length === 0, missing };
  }

  isProfileComplete(user?: UserProfile): boolean {
    return this.getProfileCompletion(user).complete;
  }
  
  async checkBiometricSupport(): Promise<BiometricData> {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

      let biometryType: BiometricData['biometryType'] = undefined;
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        biometryType = 'FaceID';
      } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        biometryType = 'TouchID';
      } else if (supportedTypes.length > 0) {
        biometryType = 'Biometrics';
      }

      const session = await this.loadSession();
      const hasValidSession = session ? this.isSessionValid(session) : false;

      return {
        isAvailable: hasHardware && isEnrolled && hasValidSession,
        biometryType,
        keysExist: hasValidSession
      };
    } catch (error) {
      console.warn('⚠️ [Biometric] Support check failed:', error);
      return {
        isAvailable: false,
        biometryType: undefined,
        keysExist: false
      };
    }
  }

  async authenticateWithBiometrics(): Promise<AuthResponse> {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        return {
          success: false,
          message: 'Biometric authentication is not available on this device'
        };
      }

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to continue',
        fallbackLabel: 'Use Passcode',
        cancelLabel: 'Cancel',
      });

      if (!authResult.success) {
        return {
          success: false,
          message: authResult.error || 'Biometric authentication failed'
        };
      }

      const session = await this.loadSession();
      if (!session || !this.isSessionValid(session)) {
        await this.clearSession();
        return {
          success: false,
          message: 'No valid session found. Please login with your password first.'
        };
      }

      this.currentSession = session;
      this.emitAuthState(true);

      return {
        success: true,
        user: session.user,
        token: session.token,
        message: 'Biometric authentication successful'
      };
    } catch (error: any) {
      console.error('❌ [Biometric] Error:', error);
      return {
        success: false,
        message: error?.message || 'Biometric authentication failed'
      };
    }
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
          message: data.message || 'Reset link sent successfully'
        };
      } else {
        return {
          success: false,
          message: 'Failed to send reset link'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Connection error: ${error.message}`
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
          message: result.message || 'Password reset successful'
        };
      } else {
        return {
          success: false,
          message: 'Password reset failed'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Connection error: ${error.message}`
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
    // Use the enhanced smart token refresh
    return await this.smartTokenRefresh();
  }

  // ==================== Development & Debugging Tools ====================
  
  async simulateConnectionError(): Promise<void> {
    console.log('🔧 Simulating connection error for testing');
    await AsyncStorage.setItem('@test:simulate_error', 'true');
  }

  async clearTestData(): Promise<void> {
    await AsyncStorage.removeItem('@test:simulate_error');
    console.log('🧹 Test data cleared');
  }

  async getSessionInfo(): Promise<{ 
    isValid: boolean; 
    expiresIn: string; 
    userEmail: string 
  }> {
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
      expiresIn: `${diffDays} days`,
      userEmail: session.user.email
    };
  }

  // Function to clear specific cache
  invalidateCache(key: string): void {
    this.requestManager.invalidate(key);
  }

  // Function to check cache status
  getCacheStats(): { size: number; keys: string[] } {
    return this.requestManager.getCacheStats();
  }

  // Initialize session monitoring on service creation
  async initialize(): Promise<void> {
    // Start session monitoring if user is authenticated
    const isAuth = await this.isAuthenticated();
    if (isAuth) {
      this.startSessionMonitor();
    }
  }
}

export const authService = AuthService.getInstance();
