// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    // NativeWind v4 config is a preset (adds jsx importSource + worklets plugin)
    presets: ['babel-preset-expo', 'nativewind/babel'],
    plugins: [
      // Must be last
      'react-native-reanimated/plugin',
    ],
  };
};
