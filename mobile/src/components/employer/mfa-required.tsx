import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { useCompanyRules } from '~/features/employer/rules';
import { supabase } from '~/lib/supabase';
import { space } from '~/theme/tokens';

/**
 * The company requires a second factor and this session has not used one
 * (Phase B 05, migration 380): until it does, the database shows it nothing
 * of the company. Said, with the way through: verify an authenticator already
 * set up, or set one up here.
 */
export function CompanyMfaNotice() {
  const t = useTranslations();
  const rules = useCompanyRules().data;
  const [hasFactor, setHasFactor] = useState<boolean | null>(null);
  const shut = Boolean(rules?.requireMfa && !rules.mfaSatisfied);
  useEffect(() => {
    if (!shut) return;
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => setHasFactor(data?.nextLevel === 'aal2'))
      .catch(() => setHasFactor(false));
  }, [shut]);
  if (!shut) return null;
  return (
    <Notice tone="warning" title={t('app.rules.mfaShutTitle')}>
      <View style={{ gap: space[2] }}>
        <Text variant="small">{t('app.rules.mfaShutBody')}</Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            size="sm"
            label={hasFactor ? t('app.rules.mfaVerify') : t('account.mfaSetup')}
            onPress={() => router.push(hasFactor ? '/mfa' : '/mfa-enrol')}
          />
        </View>
      </View>
    </Notice>
  );
}
