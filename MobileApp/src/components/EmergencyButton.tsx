import React from 'react';
import { View, Text, TouchableOpacity, Vibration } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../components/LanguageProvider';

interface EmergencyButtonProps {
  onPress: () => void;
  onLongPress: () => void;
  disabled?: boolean;
  large?: boolean;
}

export const EmergencyButton: React.FC<EmergencyButtonProps> = ({ 
  onPress, 
  onLongPress, 
  disabled = false,
  large = false,
}) => {
  const { t } = useLanguage();

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
      <TouchableOpacity
        className={`
          ${large ? 'w-40 h-40' : 'w-32 h-32'} rounded-full justify-center items-center
          ${disabled ? 'bg-gray-300' : 'bg-danger'}
          shadow-2xl shadow-red-500/30
          active:opacity-90 active:scale-95
          transition-all duration-200
        `}
        onPress={handlePress}
        onLongPress={handleLongPress}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <MaterialCommunityIcons name="alert-circle" size={large ? 64 : 50} color="white" />
        
        {/* Pulse Animation Effect */}
        <View className="absolute inset-0 border-4 border-red-300 rounded-full animate-pulse" />
      </TouchableOpacity>

      <Text className={`mt-4 ${large ? 'text-xl' : 'text-lg'} font-bold ${disabled ? 'text-gray' : 'text-danger'}`}>
        {t('emergency.sosButton')}
      </Text>
      
      <Text className={`${large ? 'text-base' : 'text-sm'} text-gray mt-2 text-center max-w-xs`}>
        {disabled ? t('emergency.loginRequired') : t('emergency.sosDescription')}
      </Text>
      
      {/* Press Instructions */}
      {!disabled && (
        <View className="flex-row mt-4">
          <View className="items-center mr-6">
            <View className={`${large ? 'w-12 h-12' : 'w-10 h-10'} rounded-full bg-blue-50 justify-center items-center mb-1`}>
              <Text className={`text-primary font-bold ${large ? 'text-base' : 'text-sm'}`}>{t('emergency.tapLabel')}</Text>
            </View>
            <Text className={`${large ? 'text-sm' : 'text-xs'} text-gray`}>{t('emergency.tapForHelp')}</Text>
          </View>
          
          <View className="items-center">
            <View className={`${large ? 'w-12 h-12' : 'w-10 h-10'} rounded-full bg-red-50 justify-center items-center mb-1`}>
              <Text className={`text-danger font-bold ${large ? 'text-base' : 'text-sm'}`}>{t('emergency.holdLabel')}</Text>
            </View>
            <Text className={`${large ? 'text-sm' : 'text-xs'} text-gray`}>{t('emergency.holdForEmergency')}</Text>
          </View>
        </View>
      )}
    </View>
  );
};
