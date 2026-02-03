import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';

export interface BiometricConfig {
  enabled: boolean;
  type?: 'fingerprint' | 'face' | 'iris';
  requireConfirmation: boolean;
  maxAttempts: number;
}

export class BiometricService {
  private static instance: BiometricService;
  private readonly BIOMETRIC_KEY = 'user_biometric_key';
  private readonly MAX_ATTEMPTS = 3;
  private attempts = 0;

  static getInstance(): BiometricService {
    if (!BiometricService.instance) {
      BiometricService.instance = new BiometricService();
    }
    return BiometricService.instance;
  }

  async isBiometricAvailable(): Promise<{
    available: boolean;
    type: 'fingerprint' | 'face' | 'none';
    enrolled: boolean;
  }> {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) {
        return { available: false, type: 'none', enrolled: false };
      }

      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      
      let type: 'fingerprint' | 'face' | 'none' = 'none';
      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        type = 'fingerprint';
      } else if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        type = 'face';
      }

      return {
        available: compatible && enrolled,
        type,
        enrolled
      };
    } catch (error) {
      console.error('Biometric check error:', error);
      return { available: false, type: 'none', enrolled: false };
    }
  }

  async authenticate(
    promptMessage: string = 'Authenticate to continue',
    fallbackEnabled: boolean = true
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.attempts >= this.MAX_ATTEMPTS) {
        return {
          success: false,
          error: 'Too many attempts. Please use password.'
        };
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        disableDeviceFallback: !fallbackEnabled,
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use Password'
      });

      if (result.success) {
        this.attempts = 0;
        return { success: true };
      } else {
        this.attempts++;
        return {
          success: false,
          error: result.error || 'Authentication failed'
        };
      }
    } catch (error: any) {
      console.error('Biometric authentication error:', error);
      return {
        success: false,
        error: error.message || 'Authentication error'
      };
    }
  }

  async saveBiometricKey(key: string, value: string): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(`${this.BIOMETRIC_KEY}_${key}`, value);
      return true;
    } catch (error) {
      console.error('Save biometric key error:', error);
      return false;
    }
  }

  async getBiometricKey(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(`${this.BIOMETRIC_KEY}_${key}`);
    } catch (error) {
      console.error('Get biometric key error:', error);
      return null;
    }
  }

  async deleteBiometricKey(key: string): Promise<boolean> {
    try {
      await SecureStore.deleteItemAsync(`${this.BIOMETRIC_KEY}_${key}`);
      return true;
    } catch (error) {
      console.error('Delete biometric key error:', error);
      return false;
    }
  }

  resetAttempts(): void {
    this.attempts = 0;
  }

  async setupBiometric(): Promise<{ success: boolean; message: string }> {
    try {
      const { available, type } = await this.isBiometricAvailable();
      
      if (!available) {
        return {
          success: false,
          message: 'Biometric authentication not available on this device'
        };
      }

      const result = await this.authenticate(
        `Setup ${type} authentication for quick login`
      );

      if (result.success) {
        return {
          success: true,
          message: `${type} authentication setup successfully`
        };
      } else {
        return {
          success: false,
          message: result.error || 'Setup failed'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Setup error'
      };
    }
  }
}

export const biometricService = BiometricService.getInstance();