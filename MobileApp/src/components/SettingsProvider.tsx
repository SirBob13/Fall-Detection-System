import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'nativewind';
import { storageService } from '../services/storage';

export type AppSettings = {
  notifications: boolean;
  autoConnect: boolean;
  fallDetection: boolean;
  vitalMonitoring: boolean;
  offlineMode: boolean;
  voiceCommands: boolean;
  automaticSOS: boolean;
  familyPortal: boolean;
  healthInsights: boolean;
  theme: 'system' | 'light' | 'dark';
  defaultDeviceId?: string | null;
};

const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  autoConnect: true,
  fallDetection: true,
  vitalMonitoring: true,
  offlineMode: true,
  voiceCommands: false,
  automaticSOS: true,
  familyPortal: false,
  healthInsights: true,
  theme: 'system',
  defaultDeviceId: null,
};

interface SettingsContextValue {
  settings: AppSettings;
  isDark: boolean;
  updateSetting: (key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  isDark: false,
  updateSetting: async () => undefined,
  updateSettings: async () => undefined,
  refreshSettings: async () => undefined,
});

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const { colorScheme, setColorScheme } = useColorScheme();

  const applyTheme = (nextTheme: AppSettings['theme']) => {
    const resolved = nextTheme === 'system' ? 'system' : nextTheme;
    setColorScheme(resolved);
  };

  const refreshSettings = async () => {
    const stored = await storageService.getSettings();
    const merged = stored
      ? {
          ...DEFAULT_SETTINGS,
          ...(stored || {}),
        }
      : DEFAULT_SETTINGS;
    setSettings(merged);
    applyTheme(merged.theme);
  };

  const updateSettings = async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...patch };
      storageService.saveSettings(updated);
      if (patch.theme) {
        applyTheme(updated.theme);
      }
      return updated;
    });
  };

  const updateSetting = async (
    key: keyof AppSettings,
    value: AppSettings[keyof AppSettings]
  ) => {
    await updateSettings({ [key]: value } as Partial<AppSettings>);
  };

  useEffect(() => {
    refreshSettings().catch(() => undefined);
  }, []);

  const contextValue = useMemo(
    () => ({
      settings,
      isDark: colorScheme === 'dark',
      updateSetting,
      updateSettings,
      refreshSettings,
    }),
    [settings, colorScheme]
  );

  return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
};
