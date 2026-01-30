import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from './LanguageProvider';
import { COLORS } from '../utils/constants';

interface ScreenWrapperProps {
  children: React.ReactNode;
  style?: any;
  scrollable?: boolean;
  safeArea?: boolean;
  backgroundColor?: string;
}

export const ScreenWrapper: React.FC<ScreenWrapperProps> = ({
  children,
  style,
  scrollable = true,
  safeArea = true,
  backgroundColor = COLORS.light,
}) => {
  const { isRTL } = useLanguage();

  const Container = scrollable ? ScrollView : View;
  const Wrapper = safeArea ? SafeAreaView : View;

  return (
    <Wrapper style={[styles.wrapper, { backgroundColor }]}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={backgroundColor}
      />
      <Container
        style={[
          styles.container,
          style,
          { direction: isRTL ? 'rtl' : 'ltr' }
        ]}
        contentContainerStyle={scrollable ? styles.scrollContent : undefined}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </Container>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
});