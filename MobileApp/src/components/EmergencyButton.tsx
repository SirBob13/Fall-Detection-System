import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Vibration,
  Animated,
  Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { emergencyService } from '../services/emergency.service';
import { COLORS } from '../utils/constants';

interface EmergencyButtonProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  showCountdown?: boolean;
}

export const EmergencyButton: React.FC<EmergencyButtonProps> = ({
  onPress,
  onLongPress,
  disabled = false,
  showCountdown = true,
}) => {
  const [isPressed, setIsPressed] = useState(false);
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const scaleAnim = useState(new Animated.Value(1))[0];

  const handlePressIn = () => {
    setIsPressed(true);
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
    Vibration.vibrate(100);
  };

  const handlePressOut = () => {
    setIsPressed(false);
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    if (disabled) return;
    
    if (showCountdown) {
      startCountdown();
    } else {
      triggerEmergency();
    }
    
    if (onPress) onPress();
  };

  const startCountdown = () => {
    setIsCountingDown(true);
    let remaining = 5;
    
    const countdownInterval = setInterval(() => {
      remaining--;
      setCountdown(remaining);
      
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        triggerEmergency();
        setIsCountingDown(false);
        setCountdown(5);
      }
    }, 1000);

    // إلغاء العد التنازلي إذا لم يكتمل
    setTimeout(() => {
      if (isCountingDown) {
        clearInterval(countdownInterval);
        setIsCountingDown(false);
        setCountdown(5);
      }
    }, 6000);
  };

  const triggerEmergency = async () => {
    Alert.alert(
      '🆘 طلب مساعدة عاجل',
      'سيتم إرسال طلب المساعدة إلى جهات الاتصال الطارئة. هل تريد المتابعة؟',
      [
        {
          text: 'إلغاء',
          style: 'cancel',
          onPress: () => {
            emergencyService.cancelSOSCountdown();
          },
        },
        {
          text: 'نعم، إرسال',
          onPress: async () => {
            Vibration.vibrate([500, 500, 500]);
            const success = await emergencyService.triggerEmergency('manual');
            
            if (success) {
              Alert.alert(
                '✅ تم الإرسال',
                'تم إرسال طلب المساعدة إلى جهات الاتصال الطارئة',
                [{ text: 'تم' }]
              );
            } else {
              Alert.alert(
                '⚠️ تحذير',
                'فشل إرسال طلب المساعدة. يرجى المحاولة مرة أخرى',
                [{ text: 'حسناً' }]
              );
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const handleLongPress = () => {
    if (disabled) return;
    
    Alert.alert(
      '🚨 طوارئ قصوى',
      'هذا سيبدأ اتصالاً طارئاً فورياً مع خدمات الطوارئ. هل أنت متأكد؟',
      [
        {
          text: 'إلغاء',
          style: 'cancel',
        },
        {
          text: 'اتصال طارئ',
          onPress: () => {
            Vibration.vibrate([1000, 1000, 1000]);
            // الاتصال المباشر بالطوارئ
            Linking.openURL('tel:123');
          },
          style: 'destructive',
        },
      ]
    );
    
    if (onLongPress) onLongPress();
  };

  return (
    <View style={styles.container}>
      {isCountingDown && (
        <View style={styles.countdownContainer}>
          <Text style={styles.countdownText}>🆘 {countdown}</Text>
          <Text style={styles.countdownLabel}>سيتم إرسال الطلب...</Text>
        </View>
      )}
      
      <TouchableOpacity
        style={[
          styles.buttonContainer,
          isPressed && styles.buttonContainerPressed,
          disabled && styles.buttonContainerDisabled,
        ]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        onLongPress={handleLongPress}
        delayLongPress={2000}
        activeOpacity={0.8}
        disabled={disabled || isCountingDown}
      >
        <Animated.View
          style={[
            styles.button,
            { transform: [{ scale: scaleAnim }] },
            isCountingDown && styles.buttonCountingDown,
          ]}
        >
          <MaterialIcons name="warning" size={48} color={COLORS.white} />
        </Animated.View>
        
        <View style={styles.labelsContainer}>
          <Text style={[styles.mainLabel, disabled && styles.labelDisabled]}>
            {isCountingDown ? 'جاري الإرسال...' : 'طلب المساعدة'}
          </Text>
          <Text style={[styles.subLabel, disabled && styles.subLabelDisabled]}>
            {isCountingDown ? 'اضغط للإلغاء' : 'اضغط مطولاً للطوارئ القصوى'}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 24,
  },
  countdownContainer: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: COLORS.danger,
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
  countdownLabel: {
    fontSize: 14,
    color: COLORS.danger,
    marginTop: 4,
  },
  buttonContainer: {
    alignItems: 'center',
  },
  buttonContainerPressed: {
    opacity: 0.9,
  },
  buttonContainerDisabled: {
    opacity: 0.5,
  },
  button: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.danger,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  buttonCountingDown: {
    backgroundColor: '#FF9800',
    shadowColor: '#FF9800',
  },
  labelsContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  mainLabel: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.danger,
    marginBottom: 8,
  },
  labelDisabled: {
    color: COLORS.gray,
  },
  subLabel: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
  },
  subLabelDisabled: {
    color: COLORS.lightGray,
  },
});