import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The app's native configuration.
 *
 * The website's host is where universal links and password AutoFill come from:
 * the site serves /.well-known/apple-app-site-association naming this bundle,
 * so a link to a listing opens here, and iOS offers passwords saved for the
 * website. Change the host only together with that file.
 *
 * Arabic only, right to left, like the website while ENGLISH_ENABLED is false.
 * The day English is published, `forcesRTL` goes and the language switch
 * decides the direction at run time.
 */
const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? 'https://www.brokersconnect.net';
const SITE_HOST = new URL(SITE_URL).host;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Brokers Connect',
  slug: 'brokers-connect',
  version: '1.0.0',
  orientation: 'portrait',
  // The website's mark on white, enlarged from the 450-pixel original in
  // public/brand; to be redrawn from a vector before the App Store.
  icon: './assets/images/icon.png',
  scheme: 'brokersconnect',
  userInterfaceStyle: 'automatic',
  ios: {
    // Permanent once the app is on the App Store: confirm before the first build.
    bundleIdentifier: 'net.brokersconnect.app',
    supportsTablet: false,
    associatedDomains: [`applinks:${SITE_HOST}`, `webcredentials:${SITE_HOST}`],
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleDevelopmentRegion: 'ar',
      CFBundleLocalizations: ['ar', 'en'],
    },
  },
  android: {
    package: 'net.brokersconnect.app',
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FDFDFF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
        dark: { backgroundColor: '#0B0F19', image: './assets/images/splash-icon.png' },
      },
    ],
    'expo-secure-store',
    ['expo-localization', { supportsRTL: true, forcesRTL: true }],
    'expo-web-browser',
    'expo-font',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    ...config.extra,
    // Set by `eas init` (EAS_PROJECT_ID in the environment, or written here).
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
