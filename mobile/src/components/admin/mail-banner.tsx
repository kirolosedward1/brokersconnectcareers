import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { useMailStatus } from '~/features/admin/ops';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

/**
 * The console-wide mail-off banner — the website's email page notice, on
 * every admin screen: when this deployment cannot send mail, it says so, and
 * names the variables in the way (never their values). An empty outbox and a
 * switched-off outbox are different facts, and the difference belongs where
 * somebody is already looking.
 *
 * Drawn only once the website has answered: nothing while it is asked, and
 * nothing while mail is on. A question that could not be answered is said as
 * that, with a retry — never taken for "mail is on".
 */
export function MailOffBanner() {
  const t = useTranslations();
  const { colors } = useTheme();
  const status = useMailStatus();

  if (status.isError && !status.data) {
    return (
      <Notice tone="muted">
        <View style={{ gap: space[2], alignItems: 'flex-start' }}>
          <Text variant="small" tone="mutedForeground">
            {t('app.admin.ops.mailUnknown')}
          </Text>
          <Button label={t('common.retry')} variant="outline" size="sm" onPress={() => void status.refetch()} />
        </View>
      </Notice>
    );
  }
  if (!status.data || status.data.configured) return null;

  const { missing } = status.data;
  return (
    <Notice tone="warning" title={t('admin.emailOffTitle')}>
      <View style={{ gap: space[2] }}>
        <Text variant="small">
          {missing.includes('SUPABASE_SERVICE_ROLE_KEY') ? t('admin.emailOffOutbox') : t('admin.emailOffSending')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
          {missing.map((name) => (
            <View key={name} style={{ paddingHorizontal: space[2], paddingVertical: 2, ...corner('md'), backgroundColor: colors.card }}>
              {/* A variable's name, as written: left to right whatever the language. */}
              <Text variant="caption" style={{ writingDirection: 'ltr' }}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Notice>
  );
}
