import { useEffect, type ReactNode } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
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
import { roomForScreen } from '~/components/ui/keyboard-room';
import { useHiddenCompaniesLoaded } from '~/features/moderation/hidden-companies';
import { I18nProvider } from '~/i18n/provider';
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
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
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
  );
}

/**
 * The screens, once the tab bar can be drawn for the person using the app —
 * the same person a link that opened the app was routed for (+native-intent).
 */
function AppStack() {
  const { settled } = useSession();
  // A cold start draws the board kept from the last run at once: not before
  // the phone has said whose listings the reader hid.
  const hiddenKnown = useHiddenCompaniesLoaded();
  const ready = settled && hiddenKnown;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <UpdateGate>
      <Stack screenOptions={{ headerShown: false }} screenLayout={roomForScreen}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
        <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="mfa" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="auth/confirm" options={{ presentation: 'modal' }} />
        <Stack.Screen name="auth/callback" options={{ presentation: 'modal' }} />
      </Stack>
      <SessionGate />
      <PendingPath />
      <PushBridge />
      <AppleCredentialWatch />
    </UpdateGate>
  );
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
