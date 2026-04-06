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

module.exports = () => {
  const baseConfig = { ...appJson.expo };
  return withCleartextTraffic(baseConfig);
};
