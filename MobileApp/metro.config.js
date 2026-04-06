const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname, {
  // Enables CSS support in Metro (required by NativeWind v4)
  isCSSEnabled: true,
});

// Ensure package exports work reliably
config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
};

module.exports = withNativeWind(config, {
  input: './global.css',
  configPath: './tailwind.config.js',
});
