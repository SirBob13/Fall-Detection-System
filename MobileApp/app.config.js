const { withAndroidManifest } = require('@expo/config-plugins');
const appJson = require('./app.json');

const withCleartextTraffic = (config) =>
  withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application?.$) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return config;
  });

const getGoogleIosUrlScheme = (iosClientId) => {
  if (!iosClientId || typeof iosClientId !== 'string') {
    return null;
  }

  const suffix = '.apps.googleusercontent.com';
  if (!iosClientId.endsWith(suffix)) {
    return null;
  }

  const clientPrefix = iosClientId.slice(0, -suffix.length);
  return `com.googleusercontent.apps.${clientPrefix}`;
};

module.exports = () => {
  const baseConfig = { ...appJson.expo };
  const existingPlugins = Array.isArray(baseConfig.plugins) ? [...baseConfig.plugins] : [];
  const googlePluginName = '@react-native-google-signin/google-signin';
  const googleIosUrlScheme = getGoogleIosUrlScheme(baseConfig.extra?.googleAuth?.iosClientId);

  if (googleIosUrlScheme) {
    const nextGooglePlugin = [googlePluginName, { iosUrlScheme: googleIosUrlScheme }];
    const existingGooglePluginIndex = existingPlugins.findIndex((plugin) =>
      Array.isArray(plugin) ? plugin[0] === googlePluginName : plugin === googlePluginName
    );

    if (existingGooglePluginIndex >= 0) {
      existingPlugins[existingGooglePluginIndex] = nextGooglePlugin;
    } else {
      existingPlugins.push(nextGooglePlugin);
    }
  }

  baseConfig.plugins = existingPlugins;

  return withCleartextTraffic(baseConfig);
};
