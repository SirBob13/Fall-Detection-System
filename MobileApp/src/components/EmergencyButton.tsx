import React from 'react';
import { View, Text, TouchableOpacity, Vibration } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../components/LanguageProvider';

interface EmergencyButtonProps {
  onPress: () => void;
  onLongPress: () => void;
  disabled?: boolean;
  large?: boolean;
  compact?: boolean;
}

export const EmergencyButton: React.FC<EmergencyButtonProps> = ({ 
  onPress, 
  onLongPress, 
  disabled = false,
  large = false,
  compact = false,
}) => {
  const { t } = useLanguage();

  const diameter = large ? 160 : compact ? 112 : 128;
  const iconSize = large ? 64 : compact ? 42 : 50;
  const labelSize = large ? 20 : compact ? 15 : 18;
  const descriptionSize = large ? 16 : compact ? 13 : 14;
  const helperBubbleSize = large ? 48 : compact ? 34 : 40;

  const handlePress = () => {
    if (!disabled) {
      Vibration.vibrate(50);
      onPress();
    }
  };

  const handleLongPress = () => {
    if (!disabled) {
      Vibration.vibrate([100, 100, 100]);
      onLongPress();
    }
  };

  return (
    <View className="items-center">
      <View
        className="absolute rounded-full border border-danger/20"
        style={{
          width: diameter + (compact ? 10 : 14),
          height: diameter + (compact ? 10 : 14),
          borderRadius: (diameter + (compact ? 10 : 14)) / 2,
        }}
      />
      <TouchableOpacity
        className={`
          rounded-full justify-center items-center
          ${disabled ? 'bg-gray-300' : 'bg-danger'}
          shadow-2xl shadow-red-500/30
          active:opacity-90 active:scale-95
          transition-all duration-200
        `}
        style={{
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          borderWidth: compact ? 3 : 4,
          borderColor: 'rgba(255,255,255,0.35)',
        }}
        onPress={handlePress}
        onLongPress={handleLongPress}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <MaterialCommunityIcons name="alert-circle" size={iconSize} color="white" />
      </TouchableOpacity>

      <Text
        className={`mt-4 font-bold ${disabled ? 'text-gray dark:text-darkTheme-muted' : 'text-danger'}`}
        style={{ fontSize: labelSize }}
      >
        {t('emergency.sosButton')}
      </Text>
      
      <Text
        className="text-gray dark:text-darkTheme-muted mt-2 text-center max-w-xs"
        style={{ fontSize: descriptionSize, lineHeight: compact ? 18 : undefined }}
      >
        {disabled ? t('emergency.loginRequired') : t('emergency.sosDescription')}
      </Text>
      
      {/* Press Instructions */}
      {!disabled && (
        <View className="flex-row mt-4">
          <View className="items-center mr-6">
            <View
              className="rounded-full bg-blue-50 justify-center items-center mb-1"
              style={{ width: helperBubbleSize, height: helperBubbleSize }}
            >
              <Text className="text-primary font-bold" style={{ fontSize: compact ? 12 : large ? 16 : 14 }}>
                {t('emergency.tapLabel')}
              </Text>
            </View>
            <Text className="text-gray dark:text-darkTheme-muted" style={{ fontSize: compact ? 11 : large ? 14 : 12 }}>
              {t('emergency.tapForHelp')}
            </Text>
          </View>
          
          <View className="items-center">
            <View
              className="rounded-full bg-red-50 justify-center items-center mb-1"
              style={{ width: helperBubbleSize, height: helperBubbleSize }}
            >
              <Text className="text-danger font-bold" style={{ fontSize: compact ? 12 : large ? 16 : 14 }}>
                {t('emergency.holdLabel')}
              </Text>
            </View>
            <Text className="text-gray dark:text-darkTheme-muted" style={{ fontSize: compact ? 11 : large ? 14 : 12 }}>
              {t('emergency.holdForEmergency')}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};
