import { useEffect } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { defaultLocale } from '@/lib/locale';
import { ErrorState } from '~/components/ui/states';
import { catalogues } from '~/i18n/provider';
import { hitTarget, palette, radius, space } from '~/theme/tokens';

/**
 * A screen that throws while it is drawn. In a release build nothing catches
 * that: the whole app goes, mid-tap, and opening it on the same data goes
 * again. So every screen is drawn inside this instead (the root layout's
 * `screenErrorBoundary`): that one screen says something went wrong and offers
 * to draw it again, and the header and the tab bar around it stay, so the
 * reader can also go back or elsewhere.
 */
export function ScreenError({ error, retry }: ErrorBoundaryProps) {
  return <ErrorState error={error} onRetry={() => void retry()} />;
}

/**
 * The same, when what failed is underneath every screen: the root layout and
 * the providers it draws (theme, catalogue, session, cache). None of them is
 * there to lean on, so this needs none of them: the phone's light or dark,
 * the tokens' colours, the system font and the app's own language. It also
 * takes the splash screen down, which would otherwise cover it for good: the
 * root layout lifts it only once it has drawn.
 */
export function AppError({ retry }: ErrorBoundaryProps) {
  const colors = palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const words = catalogues[defaultLocale];

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[3],
        padding: space[6],
        backgroundColor: colors.background,
      }}
    >
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 20, fontWeight: '600', textAlign: 'center' }}>
        {words.common.error}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 15, textAlign: 'center' }}>{words.common.errorBody}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={({ pressed }) => ({
          minHeight: hitTarget,
          justifyContent: 'center',
          paddingHorizontal: space[6],
          marginTop: space[2],
          borderRadius: radius.full,
          backgroundColor: pressed ? colors.primaryPressed : colors.primary,
        })}
      >
        <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '600' }}>{words.common.retry}</Text>
      </Pressable>
    </View>
  );
}
