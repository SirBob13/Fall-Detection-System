import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { THEME_CONFIG } from '../config/theme.config';

interface ThemeContextType {
  isDark: boolean;
  colors: any;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  colors: THEME_CONFIG.colors.light,
  toggleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const colors = isDark ? THEME_CONFIG.colors.dark : THEME_CONFIG.colors.light;

  return (
    <ThemeContext.Provider value={{ isDark, colors, toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
};