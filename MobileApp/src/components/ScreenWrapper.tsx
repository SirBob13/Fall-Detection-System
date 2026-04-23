import React from 'react';
import { View, StatusBar, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from './LanguageProvider';

interface ScreenWrapperProps {
  children: React.ReactNode;
  className?: string;
  scrollable?: boolean;
  safeArea?: boolean;
  statusBarColor?: string;
}

export const ScreenWrapper: React.FC<ScreenWrapperProps> = ({ 
  children, 
  className = '',
  scrollable = true,
  safeArea = true,
  statusBarColor = '#2196F3'
}) => {
  const { isRTL } = useLanguage();

  const WrapperView = scrollable ? View : View;
  
  return (
    <View className={`flex-1 bg-light ${className}`} style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      <StatusBar 
        barStyle={Platform.OS === 'ios' ? 'light-content' : 'light-content'} 
        backgroundColor={statusBarColor}
      />
      
      {safeArea ? (
        <SafeAreaView className="flex-1">
          <WrapperView className="flex-1">
            {children}
          </WrapperView>
        </SafeAreaView>
      ) : (
        <WrapperView className="flex-1">
          {children}
        </WrapperView>
      )}
    </View>
  );
};