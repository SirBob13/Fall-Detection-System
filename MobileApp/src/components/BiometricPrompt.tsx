import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
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
    if (visible) {
      checkBiometricAvailability();
    }
  }, [visible]);

  const checkBiometricAvailability = async () => {
    const info = await biometricService.isBiometricAvailable();
    setBiometricInfo(info);
  };

  const handleAuthenticate = async () => {
    setLoading(true);
    setError(null);

    const result = await biometricService.authenticate(
      title || t('auth.biometric.title')
    );

    setLoading(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || t('auth.biometric.failed'));
    }
  };

  const getIconName = () => {
    switch (biometricInfo.type) {
      case 'fingerprint': return 'fingerprint';
      case 'face': return 'face-recognition';
      default: return 'shield-lock';
    }
  };

  const getBiometricName = () => {
    switch (biometricInfo.type) {
      case 'fingerprint': return t('auth.biometric.fingerprint');
      case 'face': return t('auth.biometric.face');
      default: return t('auth.biometric.title');
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
          {/* Header */}
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

          {/* Error Message */}
          {error && (
            <View style={styles.errorContainer}>
              <MaterialCommunityIcons name="alert-circle" size={20} color="#C62828" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.authButton]}
              onPress={handleAuthenticate}
              disabled={loading || !biometricInfo.available}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name={getIconName()} size={20} color="#FFF" />
                  <Text style={styles.authButtonText}>
                    {t('auth.biometric.use')} {getBiometricName()}
                  </Text>
                </>
              )}
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
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>

          {/* Footer Info */}
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)', // تغميق الخلفية قليلاً للتركيز على المودال
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E3F2FD', // أزرق فاتح مريح
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#212121', // نص داكن صريح
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#616161',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE', // خلفية حمراء باهتة للخطأ
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorText: {
    fontSize: 13,
    color: '#C62828',
    marginLeft: 8,
    flex: 1,
    fontWeight: '500',
  },
  buttonContainer: {
    gap: 10,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
  },
  authButton: {
    backgroundColor: '#2196F3', // اللون الرئيسي
  },
  authButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  fallbackButton: {
    backgroundColor: '#F0F7F0',
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  fallbackButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2E7D32',
  },
  cancelButton: {
    backgroundColor: '#F5F5F5',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#757575',
  },
  infoContainer: {
    marginTop: 24,
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