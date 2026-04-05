import { registerRootComponent } from 'expo';
import { StyleSheet } from 'nativewind';
import compiled from './src/nativewind.generated.json';
import './global.css';
import App from './App';

// Ensure NativeWind styles are registered at runtime (especially for production builds)
StyleSheet.registerCompiled(compiled);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
