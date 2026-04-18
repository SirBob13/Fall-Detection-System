import React, { createContext, useContext } from 'react';
import { THEME_CONFIG } from '../config/theme.config';

interface ThemeContextType {
  colors: any;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  colors: THEME_CONFIG.colors,
  toggleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const colors = THEME_CONFIG.colors;

  return (
    <ThemeContext.Provider value={{ colors, toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
};
