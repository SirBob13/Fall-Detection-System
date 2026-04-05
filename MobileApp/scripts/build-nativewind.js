// scripts/build-nativewind.js
// Builds Tailwind CSS and converts it to NativeWind runtime data
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const inputCss = path.resolve(projectRoot, 'global.css');
const outputCss = path.resolve(projectRoot, '.nativewind.css');
const outputJson = path.resolve(projectRoot, 'src', 'nativewind.generated.json');

async function buildCss() {
  const { build } = require('tailwindcss/lib/cli/build');
  await build({
    '--input': inputCss,
    '--output': outputCss,
  });
}

async function main() {
  if (!fs.existsSync(inputCss)) {
    console.error('[NativeWind] global.css not found:', inputCss);
    process.exit(1);
  }

  await buildCss();
  const css = fs.readFileSync(outputCss, 'utf8');
  const { cssToReactNativeRuntime } = require('react-native-css-interop/dist/css-to-rn');
  const compiled = cssToReactNativeRuntime(css, {
    inlineRem: 14,
  });

  fs.writeFileSync(outputJson, JSON.stringify(compiled));
  console.log('[NativeWind] Generated', outputJson);
}

main().catch((err) => {
  console.error('[NativeWind] build failed', err);
  process.exit(1);
});
