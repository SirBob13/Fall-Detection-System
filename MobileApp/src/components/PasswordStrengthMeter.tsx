// components/PasswordStrengthMeter.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface PasswordStrengthMeterProps {
  password: string;
}

export const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({ password }) => {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[@$!%*?&]/.test(password),
  };
  
  const score = Object.values(checks).filter(Boolean).length;
  
  const getStrengthConfig = () => {
    switch (score) {
      case 0: return { color: '#9E9E9E', text: 'Very Weak', icon: 'sentiment-very-dissatisfied' };
      case 1: return { color: '#F44336', text: 'Very Weak', icon: 'sentiment-dissatisfied' };
      case 2: return { color: '#FF9800', text: 'Weak', icon: 'sentiment-neutral' };
      case 3: return { color: '#FFC107', text: 'Fair', icon: 'sentiment-satisfied' };
      case 4: return { color: '#4CAF50', text: 'Good', icon: 'sentiment-satisfied-alt' };
      case 5: return { color: '#2196F3', text: 'Strong', icon: 'sentiment-very-satisfied' };
      default: return { color: '#9E9E9E', text: '', icon: 'sentiment-neutral' };
    }
  };

  const config = getStrengthConfig();

  if (password.length === 0) return null;

  return (
    <View className="mt-4">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-sm font-medium text-dark">Strength:</Text>
        <View className="flex-row items-center">
          <MaterialIcons name={config.icon as any} size={18} color={config.color} />
          <Text className="text-sm font-bold ml-2" style={{ color: config.color }}>
            {config.text}
          </Text>
        </View>
      </View>
      
      {/* Strength Bar */}
      <View className="h-2 bg-lightGray rounded-full overflow-hidden mb-4">
        <View 
          className="h-full rounded-full transition-all duration-300"
          style={{ 
            width: `${(score / 5) * 100}%`,
            backgroundColor: config.color
          }}
        />
      </View>
      
      {/* Requirements Checklist */}
      <View className="space-y-2">
        {[
          { label: 'At least 8 characters', met: checks.length },
          { label: 'Uppercase letter (A-Z)', met: checks.uppercase },
          { label: 'Lowercase letter (a-z)', met: checks.lowercase },
          { label: 'Number (0-9)', met: checks.number },
          { label: 'Special character (@$!%*?&)', met: checks.special },
        ].map((req, index) => (
          <View key={index} className="flex-row items-center">
            <MaterialIcons
              name={req.met ? 'check-circle' : 'radio-button-unchecked'}
              size={16}
              color={req.met ? '#4CAF50' : '#9E9E9E'}
            />
            <Text className={`text-xs ml-2 ${req.met ? 'text-success' : 'text-gray'}`}>
              {req.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};
