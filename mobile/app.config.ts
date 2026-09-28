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
    // Sign in with Apple, natively (the entitlement). Supabase's Apple provider
    // must list this bundle id among its client ids for the identity token to pass.
    usesAppleSignIn: true,
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
    'expo-apple-authentication',
    [
      'expo-notifications',
      {
        // The APNs environment the build signs for: a development build talks
        // to the sandbox, everything installed from TestFlight, an internal
        // (ad hoc) link or the App Store to production. No background mode:
        // a push is shown by the system and opened by a tap, never handled
        // silently.
        mode: /^development/.test(process.env.EAS_BUILD_PROFILE ?? 'development') ? 'development' : 'production',
      },
    ],
    [
      'expo-image-picker',
      {
        // The base language's strings; the English ones are in assets/locales.
        photosPermission:
          'بنستخدم صورك عشان تختار صورتك الشخصية أو لوجو شركتك، ومفيش حاجة بتترفع غير اللي انت تختاره.',
        cameraPermission: 'بنستخدم الكاميرا عشان تصوّر صورتك الشخصية أو مستندات شركتك.',
        microphonePermission: false,
      },
    ],
  ],
  // The app's name and the permission prompts in each language the app speaks.
  locales: {
    ar: './assets/locales/ar.json',
    en: './assets/locales/en.json',
  },
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
