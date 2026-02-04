// babel.config.js
module.exports = function(api) {
  api.cache(true);
  return {
    // NativeWind must run last to set the JSX importSource
    presets: ['babel-preset-expo', 'nativewind/babel'],
    plugins: [],
  };
};
