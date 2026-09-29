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

/**
 * The EAS project's id: `npx eas-cli@latest init` prints it, and it goes here
 * in place of null. It is not a secret. Push tokens are issued for it, and the
 * build server reads this file again, so an id kept only in a local shell
 * never reaches a build. EAS_PROJECT_ID overrides it, for a fork's own project.
 */
const EAS_PROJECT_ID: string | null = null;
const easProjectId = process.env.EAS_PROJECT_ID || EAS_PROJECT_ID;

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
    /*
      The app's own privacy manifest. No tracking, and no analytics or
      advertising SDK. What it collects is what an account holds on the
      website — linked to the person, used only to run the service — and it
      must say the same as the App Store's privacy answers (docs/app-store.md).
      The system APIs with required reasons are declared by the libraries that
      call them (React Native, AsyncStorage and the Expo modules ship their own
      manifests); the four here are the ones React Native's own template
      declares, repeated for any library that does not.
    */
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        'NSPrivacyCollectedDataTypeName',
        'NSPrivacyCollectedDataTypeEmailAddress',
        'NSPrivacyCollectedDataTypePhoneNumber',
        'NSPrivacyCollectedDataTypePhotosorVideos',
        'NSPrivacyCollectedDataTypeOtherUserContent',
        'NSPrivacyCollectedDataTypeCustomerSupport',
        'NSPrivacyCollectedDataTypeSearchHistory',
        'NSPrivacyCollectedDataTypeUserID',
        'NSPrivacyCollectedDataTypeDeviceID',
        'NSPrivacyCollectedDataTypeOtherDataTypes',
      ].map((type) => ({
        NSPrivacyCollectedDataType: type,
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
      })),
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
      ],
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
    // Drawing over other apps, which the template asks for and the app never
    // does; Google Play reviews it as a sensitive permission.
    blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
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
    // The session key sits in the keychain without a biometric gate, so no
    // Face ID purpose string (the plugin's default is an English one).
    ['expo-secure-store', { faceIDPermission: false }],
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
    eas: easProjectId ? { projectId: easProjectId } : undefined,
    // Right to left in Expo Go, which reads these from the manifest
    // (expo-manifests: supportsRTL, forcesRTL); a build of the app gets the
    // same from the expo-localization plugin above.
    supportsRTL: true,
    forcesRTL: true,
  },
});
