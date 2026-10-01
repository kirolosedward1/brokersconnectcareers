import type { ReactNode } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import { FileText } from '~/components/ui/lucide';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { useAcceptPolicies, usePolicyStatus } from '~/features/policies';
import { env } from '~/lib/env';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * The website's PolicyNotice: somebody signed in who has not agreed to the
 * Terms of use and the Privacy policy as they are now is asked to read them
 * and agree. Not a wall — the privacy policy promises notice of changes, and
 * this is it — and nothing is asked when the answer could not be kept.
 */
export function PolicyNotice() {
  const t = useTranslations();
  const { colors } = useTheme();
  const status = usePolicyStatus();
  const accept = useAcceptPolicies();

  if (status !== 'outdated') return null;

  const open = (path: '/terms' | '/privacy') => () => WebBrowser.openBrowserAsync(`${env.siteUrl}${path}`).catch(() => {});
  const link = (path: '/terms' | '/privacy') =>
    function PolicyLink(chunks: ReactNode) {
      return (
        <Text variant="small" weight="semibold" tone="primary" onPress={open(path)} suppressHighlighting accessibilityRole="link">
          {chunks}
        </Text>
      );
    };

  return (
    <Notice tone="muted" title={t('legal.updatedTitle')} icon={<FileText size={16} color={colors.primary} />}>
      <View style={{ gap: space[3] }}>
        <Text variant="small">{t.rich('legal.updatedBody', { terms: link('/terms'), privacy: link('/privacy') })}</Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button label={t('legal.agree')} size="sm" loading={accept.isPending} onPress={() => accept.mutate()} />
        </View>
        {accept.isError ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {t('legal.agreeFailed')}
          </Text>
        ) : null}
      </View>
    </Notice>
  );
}
