// src/hooks/useBiometricAuth.ts
import { useBiometricAuth } from 'react-native-biometric-authentication';

export const useAppBiometricAuth = () => {
  const { authenticate, isAvailable } = useBiometricAuth();
  
  return {
    loginWithBiometrics: async () => {
      const result = await authenticate('Authenticate to continue');
      if (result.success) {
        // Auto-login logic
      }
    },
    isBiometricAvailable: isAvailable,
  };
};