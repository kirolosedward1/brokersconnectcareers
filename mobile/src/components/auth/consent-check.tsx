import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import { Check } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { withAppMarker } from '~/lib/app-marker';
import { env } from '~/lib/env';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

function openSitePage(path: '/terms' | '/privacy') {
  WebBrowser.openBrowserAsync(withAppMarker(`${env.siteUrl}${path}`)).catch(() => {});
}

/**
 * "I am 18 or older, and I have read and agree to the Terms of use and the
 * Privacy policy" — the website's agreement, which nothing is created
 * without (completeOnboarding). One element to VoiceOver, which cannot reach
 * the links inside it: they are offered as its actions too, and neither
 * ticks the box. Its error, when there is one, under it.
 */
export function ConsentCheck({
  ref,
  agreed,
  onChange,
  error,
}: {
  ref?: Ref<ViewInstance>;
  agreed: boolean;
  onChange: (agreed: boolean) => void;
  error?: string;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[1] }}>
      <Pressable
        ref={ref}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        accessibilityActions={[
          { name: 'terms', label: t('footer.terms') },
          { name: 'privacy', label: t('footer.privacy') },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'terms') openSitePage('/terms');
          if (event.nativeEvent.actionName === 'privacy') openSitePage('/privacy');
        }}
        onPress={() => onChange(!agreed)}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space[3],
          minHeight: 44,
          padding: space[4],
          ...corner('xl'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: agreed ? colors.primary : colors.border,
          backgroundColor: colors.card,
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            marginTop: 3,
            ...corner('md'),
            borderWidth: 1.5,
            borderColor: agreed ? colors.primary : colors.input,
            backgroundColor: agreed ? colors.primary : colors.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {agreed ? <Check size={16} color={colors.primaryForeground} /> : null}
        </View>
        <Text variant="small" style={{ flex: 1 }}>
          {t.rich('onboarding.consent', {
            terms: (chunks: ReactNode) => (
              <Text variant="small" weight="semibold" tone="primary" onPress={() => openSitePage('/terms')} suppressHighlighting>
                {chunks}
              </Text>
            ),
            privacy: (chunks: ReactNode) => (
              <Text variant="small" weight="semibold" tone="primary" onPress={() => openSitePage('/privacy')} suppressHighlighting>
                {chunks}
              </Text>
            ),
          })}
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
