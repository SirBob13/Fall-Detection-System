// src/utils/imageFallback.ts
export const getImageSource = (uri: string | undefined) => {
  if (uri && uri.startsWith('http')) {
    return { uri };
  }
  return require('../assets/images/default-avatar.png');
};