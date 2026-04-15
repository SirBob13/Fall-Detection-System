import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { biometricService } from '../services/biometric.service';
import { useLanguage } from './LanguageProvider';

interface BiometricPromptProps {
  visible: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  onFallback: () => void;
  title?: string;
  subtitle?: string;
}

export const BiometricPrompt: React.FC<BiometricPromptProps> = ({
  visible,
  onSuccess,
  onCancel,
  onFallback,
  title,
  subtitle,
}) => {
  const { t } = useLanguage();
  const [biometricInfo, setBiometricInfo] = useState<{
    available: boolean;
    type: 'fingerprint' | 'face' | 'none';
  }>({ available: false, type: 'none' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkBiometricAvailability();
  }, []);

  const checkBiometricAvailability = async () => {
    const info = await biometricService.isBiometricAvailable();
    setBiometricInfo(info);
  };

  const handleAuthenticate = async () => {
    setLoading(true);
    setError(null);

    const result = await biometricService.authenticate(
      title || 'Authenticate to continue'
    );

    setLoading(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Authentication failed');
    }
  };

  const getIconName = () => {
    switch (biometricInfo.type) {
      case 'fingerprint':
        return 'fingerprint';
      case 'face':
        return 'face-recognition';
      default:
        return 'shield-lock';
    }
  };

  const getBiometricName = () => {
    switch (biometricInfo.type) {
      case 'fingerprint':
        return t('auth.biometric.fingerprint');
      case 'face':
        return t('auth.biometric.face');
      default:
        return t('auth.biometric.title');
    }
  };

  if (!visible) return null;

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons
                name={getIconName()}
                size={48}
                color="#2196F3"
              />
            </View>
            <Text style={styles.title}>
              {title || t('auth.biometric.title')}
            </Text>
            <Text style={styles.subtitle}>
              {subtitle || `${getBiometricName()} ${t('auth.biometric.description')}`}
            </Text>
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <MaterialCommunityIcons name="alert-circle" size={20} color="#F44336" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.fallbackButton]}
              onPress={onFallback}
              disabled={loading}
            >
              <Text style={styles.fallbackButtonText}>
                {t('auth.biometric.usePassword')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.authButton]}
              onPress={handleAuthenticate}
              disabled={loading || !biometricInfo.available}
            >
              {loading ? (
                <Text style={styles.authButtonText}>...</Text>
              ) : (
                <>
                  <MaterialCommunityIcons name={getIconName()} size={20} color="#FFF" />
                  <Text style={styles.authButtonText}>
                    {t('auth.biometric.use')} {getBiometricName()}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>
              {t('auth.biometric.securityNote')}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#212121',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#757575',
    textAlign: 'center',
    lineHeight: 20,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#D32F2F',
    marginLeft: 8,
    flex: 1,
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    minHeight: 56,
  },
  cancelButton: {
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#757575',
  },
  fallbackButton: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  fallbackButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#388E3C',
  },
  authButton: {
    backgroundColor: '#2196F3',
    gap: 8,
  },
  authButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  infoContainer: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  infoText: {
    fontSize: 12,
    color: '#9E9E9E',
    textAlign: 'center',
    lineHeight: 16,
  },
});
