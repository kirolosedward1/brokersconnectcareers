import { Linking } from 'react-native';
import { useTranslations } from 'use-intl';
import { OPERATOR } from '@/lib/business';
import { ShieldAlert } from '~/components/ui/lucide';
import { useMobileConfig } from '~/features/config';
import { dialog } from '~/lib/dialog';
import { Button } from './button';
import { EmptyState } from './states';

/**
 * A suspended account on a page it cannot use: what happened, and the one
 * thing it can do about it here — write to the people who decide. The
 * address is the website's (its config route, or its footer's fallback); a
 * phone with no mail app is told the address instead.
 */
export function SuspendedState() {
  const t = useTranslations();
  const config = useMobileConfig();
  const supportEmail = config.data?.supportEmail || OPERATOR.email;
  return (
    <EmptyState
      icon={ShieldAlert}
      title={t('account.suspendedTitle')}
      body={t('account.suspendedBody')}
      action={
        supportEmail ? (
          <Button
            label={t('app.account.contact')}
            variant="outline"
            onPress={() =>
              Linking.openURL(`mailto:${supportEmail}`).catch(() => dialog.alert(t('app.account.contact'), supportEmail))
            }
          />
        ) : null
      }
    />
  );
}
