import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  compact?: boolean;
  showBack?: boolean;
  onBack?: () => void;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  compact = false,
  showBack = false,
  onBack,
}) => {
  const navigation = useNavigation<any>();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  return (
    <View
      className="mx-4 overflow-hidden bg-primary/10 border border-primary/20"
      style={{
        marginTop: compact ? 8 : 16,
        marginBottom: compact ? 16 : 24,
        borderRadius: compact ? 26 : 32,
      }}
    >
      <View
        className="absolute rounded-full bg-primary/20"
        style={{
          right: compact ? -14 : -32,
          top: compact ? -18 : -32,
          width: compact ? 74 : 96,
          height: compact ? 74 : 96,
        }}
      />
      <View
        className="absolute rounded-full bg-primary/10"
        style={{
          left: compact ? -32 : -40,
          bottom: compact ? -38 : -40,
          width: compact ? 104 : 128,
          height: compact ? 104 : 128,
        }}
      />
      <View style={{ paddingHorizontal: 20, paddingVertical: compact ? 18 : 20 }}>
        {showBack ? (
          <TouchableOpacity
            className="self-start mb-3 w-10 h-10 rounded-full bg-white/80 border border-primary/15 items-center justify-center"
            onPress={handleBack}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color="#2196F3" />
          </TouchableOpacity>
        ) : null}
        <Text
          className="font-bold text-dark"
          style={{ fontSize: compact ? 20 : 24 }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="text-gray mt-1"
            style={{ fontSize: compact ? 13 : 12, lineHeight: compact ? 18 : 16 }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
};
