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
 * The website's pages the app has screens for, which Android opens in the app
 * (App Links) — the list the iOS file names (src/lib/apple/app-site-association.ts,
 * OPEN_IN_THE_APP; a test keeps the two together), under /en too for the day
 * English is published. A section is its own page and the pages under it
 * (`/jobs`, `/jobs/…`), never whatever begins the same: /employers is the
 * website's page for companies, not the employer's console.
 * Android verifies them against the site's /.well-known/assetlinks.json,
 * which names this package and its signing certificate (ANDROID_CERT_SHA256 on
 * the website); until then they open in the browser.
 */
const APP_LINK_PATHS = [
  '/jobs',
  '/jobs/*',
  '/companies',
  '/companies/*',
  '/agents',
  '/agents/*',
  '/notifications',
  '/dashboard',
  '/dashboard/*',
  '/employer',
  '/employer/*',
  '/auth/confirm',
];

/**
 * The EAS project's id: `npx eas-cli@latest init` prints it, and it goes here
 * in place of null. It is not a secret. Push tokens are issued for it, and the
 * build server reads this file again, so an id kept only in a local shell
 * never reaches a build. EAS_PROJECT_ID overrides it, for a fork's own project.
 */
const EAS_PROJECT_ID: string | null = null;
const easProjectId = process.env.EAS_PROJECT_ID || EAS_PROJECT_ID;

/**
 * The Face ID purpose string, for the app lock (expo-local-authentication) —
 * the base language's; the English one is in assets/locales. expo-secure-store
 * writes the same Info.plist key, so it is handed the same words: whichever
 * plugin runs last, the prompt says this.
 */
const FACE_ID_PURPOSE = 'بنستخدم Face ID عشان تقفل التطبيق وتفتحه، لو انت شغّلت القفل بنفسك.';

/**
 * Over-the-air updates (EAS Update): JavaScript and images published after a
 * build reach the phones running it without a new review. Native code cannot
 * change that way — a new native module still needs a build.
 *
 * Each build listens on its profile's channel (eas.json) and takes only
 * updates made for its own native code: the runtime version is a fingerprint
 * of this configuration and the native modules, so an update made against
 * other native code is never offered to it. That fingerprint depends on the
 * environment this file is evaluated in, which is why updates are published
 * with scripts/publish-update.mjs and the build profile's own values.
 *
 * Without an EAS project there is nowhere to fetch from: updates are off, and
 * a build runs the code it was built with.
 */
const updates = easProjectId
  ? { url: `https://u.expo.dev/${easProjectId}`, checkAutomatically: 'ON_LOAD' as const, fallbackToCacheTimeout: 0 }
  : { enabled: false };

/**
 * An update for Expo Go (`pnpm run ota expo-go`, scripts/publish-update.mjs)
 * runs on Expo Go's native code, not this app's: its runtime version is Expo
 * Go's SDK ("exposdk:57.0.0"), which no fingerprint of this app matches.
 */
const forExpoGo = process.env.EXPO_GO_UPDATE === '1';

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
  // Checked at launch and downloaded in the background; it runs from the next
  // launch on, so nobody's screen changes under them (fallbackToCacheTimeout 0).
  runtimeVersion: forExpoGo ? { policy: 'sdkVersion' } : { policy: 'fingerprint' },
  updates,
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
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: ['', '/en'].flatMap((locale) =>
          APP_LINK_PATHS.map((path) =>
            path.endsWith('/*')
              ? { scheme: 'https', host: SITE_HOST, pathPrefix: `${locale}${path.slice(0, -1)}` }
              : { scheme: 'https', host: SITE_HOST, path: `${locale}${path}` },
          ),
        ),
      },
    ],
    // Drawing over other apps, which the template asks for and the app never
    // does; Google Play reviews it as a sensitive permission.
    blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    // Firebase's google-services.json, without which Android has no push token:
    // an EAS file variable (GOOGLE_SERVICES_JSON, a path to it on the build
    // server) — not committed, the repository is public. Unset, the Android app
    // does not offer pushes (pushAvailable, src/features/push/device.ts).
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || undefined,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        // The theme's page colours (src/theme/tokens.ts), so the launch screen
        // gives way to the first screen without a change of tone.
        backgroundColor: '#F6F4F0',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
        dark: { backgroundColor: '#0A0C10', image: './assets/images/splash-icon.png' },
      },
    ],
    // The session key sits in the keychain without a biometric gate. The Face
    // ID purpose string is the app lock's, given to both plugins because both
    // write it (the secure store's default is an English sentence).
    ['expo-secure-store', { faceIDPermission: FACE_ID_PURPOSE }],
    ['expo-local-authentication', { faceIDPermission: FACE_ID_PURPOSE }],
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
