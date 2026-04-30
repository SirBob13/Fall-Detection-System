import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { storageService } from '../services/storage';

export type AppSettings = {
  notifications: boolean;
  autoConnect: boolean;
  fallDetection: boolean;
  vitalMonitoring: boolean;
  offlineMode: boolean;
  voiceCommands: boolean;
  automaticSOS: boolean;
  healthInsights: boolean;
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
  healthInsights: true,
  defaultDeviceId: null,
};

interface SettingsContextValue {
  settings: AppSettings;
  isDark: false;
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

  const refreshSettings = async () => {
    const stored = await storageService.getSettings();
    const merged = stored
      ? {
          ...DEFAULT_SETTINGS,
          ...(stored || {}),
          notifications: true,
          autoConnect: true,
        }
      : DEFAULT_SETTINGS;
    setSettings(merged);
    if (stored && (stored.notifications !== true || stored.autoConnect !== true)) {
      await storageService.saveSettings(merged);
    }
  };

  const updateSettings = async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...patch };
      storageService.saveSettings(updated);
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
      isDark: false as const,
      updateSetting,
      updateSettings,
      refreshSettings,
    }),
    [settings]
  );

  return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
};
