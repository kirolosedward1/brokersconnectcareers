import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import type { useCaptcha } from '~/features/auth/captcha';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { space } from '~/theme/tokens';

/**
 * The captcha, where the form can see it: nothing at all while it works out of
 * sight (nearly always), the widget and one line when Cloudflare wants a tap,
 * and a way to try again when it could not load.
 */
export function CaptchaStatus({ captcha }: { captcha: ReturnType<typeof useCaptcha> }) {
  const t = useTranslations('app.auth');

  return (
    <View style={{ gap: space[2] }}>
      {captcha.view}
      {captcha.status === 'interactive' ? (
        <Text variant="small" tone="mutedForeground">
          {t('captchaPrompt')}
        </Text>
      ) : captcha.status === 'failed' ? (
        <View style={{ gap: space[2] }}>
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {t('captchaFailed')}
          </Text>
          <Button label={t('captchaRetry')} variant="outline" size="sm" onPress={captcha.renew} />
        </View>
      ) : null}
    </View>
  );
}

/** Whether a password form can go yet: the config has answered and, if a captcha is asked for, it has a token. */
export function captchaBlocks(captcha: ReturnType<typeof useCaptcha>): boolean {
  return captcha.loading || (captcha.status !== 'off' && captcha.status !== 'ready');
}
