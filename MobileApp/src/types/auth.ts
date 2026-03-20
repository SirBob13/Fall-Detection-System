export interface UserCredentials {
  email: string;
  password: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  phone?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  weight?: number;
  height?: number;
  medical_conditions?: string;
  emergency_contact?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  profile_complete?: boolean;
  missing_fields?: string[];
}

export interface AuthResponse {
  success: boolean;
  user?: UserProfile;
  token?: string;
  refresh_token?: string;
  message?: string;
  error?: string;
}

export interface RegisterData {
  name: string;
  email: string;
  phone?: string;
  password: string;
  confirm_password: string;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  weight?: number;
  height?: number;
  medical_conditions?: string;
  emergency_contact?: string;
  accept_terms: boolean;
}

export interface ForgotPasswordData {
  email: string;
}

export interface ResetPasswordData {
  token: string;
  password: string;
  confirm_password: string;
}

export interface SocialLoginData {
  provider: 'google' | 'apple' | 'facebook';
  token: string;
  user_info: {
    id: string;
    email: string;
    name: string;
    photo?: string;
  };
}

export interface SessionData {
  user: UserProfile;
  token: string;
  refresh_token: string;
  expires_at: string;
}

export interface BiometricData {
  isAvailable: boolean;
  biometryType?: 'TouchID' | 'FaceID' | 'Biometrics';
  keysExist: boolean;
}

export interface AccountStatus {
  exists: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  is_active: boolean;
  has_password: boolean;
  social_accounts: Array<{
    provider: string;
    connected_at: string;
  }>;
}

export interface UserSession {
  id: string;
  device_info: string;
  ip_address: string;
  created_at: string;
  expires_at: string;
}

export interface VerifyEmailRequest {
  token: string;
}
