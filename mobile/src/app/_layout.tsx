import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import { LocaleDirContext } from 'expo-router/react-navigation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
// The four weights the website uses, each from its own entry point: the
// package's index would bundle all seven files.
import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold';
import { IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold';
import { AppError, ScreenError } from '~/components/navigation/error-boundaries';
import { PendingPath } from '~/components/navigation/pending-path';
import { AppleCredentialWatch } from '~/components/navigation/apple-credential-watch';
import { PushBridge } from '~/components/navigation/push-bridge';
import { SessionGate } from '~/components/navigation/session-gate';
import { UpdateGate } from '~/components/navigation/update-gate';
import { WelcomeGate } from '~/components/navigation/welcome-gate';
import { roomForScreen } from '~/components/ui/keyboard-room';
import { InSheet } from '~/components/ui/states';
import { useHiddenCompaniesLoaded } from '~/features/moderation/hidden-companies';
import { useWelcomeDrawn } from '~/features/welcome';
import { I18nProvider } from '~/i18n/provider';
import { appDirection } from '~/lib/direction';
import { persistOptions, queryClient } from '~/lib/query';
import { SessionProvider, useSession } from '~/lib/session';
import { ThemeProvider, useTheme } from '~/theme/provider';
import { font } from '~/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * The tabs are always underneath: a link that opens straight onto a sheet (an
 * email link, onboarding) closes onto the app, not onto nothing. And every
 * screen is drawn inside ScreenError, so one that throws says so and offers to
 * draw itself again instead of taking the app down with it.
 */
export const unstable_settings = {
  anchor: '(tabs)',
  screenErrorBoundary: ScreenError,
};

/** When what throws is this layout or a provider it draws, which every screen stands on. */
export { AppError as ErrorBoundary };

/**
 * Everything the screens stand on: the website's font, cached server state,
 * the theme, the website's catalogue, and who is signed in. The splash screen
 * stays up until the font is ready and the phone has said who was signed in
 * last, so no screen is ever drawn in the system font first, nor with a tab
 * bar that changes a moment later.
 *
 * All of it in the app's direction (src/lib/direction.ts): every view laid
 * out in it, and every navigator's header and back gesture told it, whatever
 * direction the screen was created with — Expo Go creates it left to right.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  return (
    <View testID="app-direction" style={{ flex: 1, direction: appDirection }}>
      <LocaleDirContext.Provider value={appDirection}>
        {fontsLoaded || fontError ? (
          <SafeAreaProvider>
            <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
              <ThemeProvider>
                <I18nProvider>
                  <SessionProvider>
                    <Navigation>
                      <AppStack />
                    </Navigation>
                  </SessionProvider>
                </I18nProvider>
              </ThemeProvider>
            </PersistQueryClientProvider>
          </SafeAreaProvider>
        ) : null}
      </LocaleDirContext.Provider>
    </View>
  );
}

/** Longest the splash screen waits for the welcome to be drawn, once the app is ready. */
const WELCOME_WAIT_MS = 1500;

/**
 * The screens, once the tab bar can be drawn for the person using the app —
 * the same person a link that opened the app was routed for (+native-intent).
 * The splash screen comes down onto the first screen the launch is for: the
 * welcome, on a launch with nobody signed in (WelcomeGate), or Home.
 */
function AppStack() {
  const { settled } = useSession();
  // A cold start draws the board kept from the last run at once: not before
  // the phone has said whose listings the reader hid.
  const hiddenKnown = useHiddenCompaniesLoaded();
  const ready = settled && hiddenKnown;
  const [welcome, setWelcome] = useState<'deciding' | 'opened' | 'not'>('deciding');
  const welcomeDrawn = useWelcomeDrawn();
  const [waitedEnough, setWaitedEnough] = useState(false);
  const decided = useCallback((opened: boolean) => setWelcome(opened ? 'opened' : 'not'), []);

  // Never held for good, whatever the welcome does.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setWaitedEnough(true), WELCOME_WAIT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const firstScreen = welcome === 'not' || (welcome === 'opened' && welcomeDrawn) || waitedEnough;
  useEffect(() => {
    if (ready && firstScreen) SplashScreen.hideAsync().catch(() => {});
  }, [ready, firstScreen]);

  if (!ready) return null;

  return (
    <UpdateGate>
      <Stack screenOptions={{ headerShown: false }} screenLayout={rootScreenLayout}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
        <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="mfa" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="auth/confirm" options={{ presentation: 'modal' }} />
        <Stack.Screen name="auth/callback" options={{ presentation: 'modal' }} />
        {/* Answered rather than swiped away. At a launch it is under the splash
            screen at once; after a sign-out it fades in over the tabs. */}
        <Stack.Screen
          name="welcome"
          options={({ route }) => ({
            presentation: 'fullScreenModal',
            animation: (route.params as { after?: string } | undefined)?.after === 'sign-out' ? 'fade' : 'none',
            gestureEnabled: false,
          })}
        />
      </Stack>
      <WelcomeGate onDecided={decided} />
      <SessionGate />
      <PendingPath />
      <PushBridge />
      <AppleCredentialWatch />
    </UpdateGate>
  );
}

/** What an iPhone presents as a sheet: below the status bar, over the screen it came from. */
const SHEETS = new Set(['modal', 'formSheet', 'pageSheet']);

/**
 * Each of the root stack's screens: in a room for the keyboard
 * (roomForScreen), and, when an iPhone presents it as a sheet — the sign-in
 * sheet, the email links — told so (InSheet): what is drawn in a sheet is
 * measured from the sheet's own top, not the phone's.
 */
function rootScreenLayout(props: {
  route: { name: string };
  options: { presentation?: string };
  children: ReactElement;
}): ReactElement {
  const sheet = Platform.OS === 'ios' && SHEETS.has(props.options.presentation ?? '');
  return <InSheet.Provider value={sheet}>{roomForScreen(props)}</InSheet.Provider>;
}

/** The navigators' colours and title font, from the theme. */
function Navigation({ children }: { children: ReactNode }) {
  const { scheme, colors } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <NavigationTheme
      value={{
        ...base,
        colors: {
          ...base.colors,
          primary: colors.primary,
          background: colors.background,
          card: colors.card,
          text: colors.foreground,
          border: colors.border,
        },
        fonts: {
          regular: { fontFamily: font.regular, fontWeight: '400' },
          medium: { fontFamily: font.medium, fontWeight: '500' },
          bold: { fontFamily: font.semibold, fontWeight: '600' },
          heavy: { fontFamily: font.bold, fontWeight: '700' },
        },
      }}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </NavigationTheme>
  );
}
