import Constants from 'expo-constants';

const configAppId =
  Constants.expoConfig?.extra?.agoraAppId ||
  process.env.EXPO_PUBLIC_AGORA_APP_ID ||
  '';

export const AGORA_CONFIG = {
  APP_ID: configAppId,
};
