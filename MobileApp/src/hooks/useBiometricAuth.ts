// src/hooks/useBiometricAuth.ts
import * as LocalAuthentication from 'expo-local-authentication';

export const useAppBiometricAuth = () => {
  return {
    loginWithBiometrics: async () => {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to continue',
      });
      if (result.success) {
        // Auto-login logic
      }
      return result.success;
    },
    isBiometricAvailable: async () => LocalAuthentication.hasHardwareAsync(),
  };
};
