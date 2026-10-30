import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { SettingsGroup, SwitchRow } from '~/components/ui/settings-list';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { RulesRefused, useSaveRules, type CompanyRules } from '~/features/employer/rules';
import { ApiError } from '~/lib/api';
import { westernDigits } from '@/lib/search/arabic';
import { space } from '~/theme/tokens';

/**
 * The rules a company sets for its own team (Phase B 05): declines and a live
 * listing's pay approved by an admin, a monthly spending ceiling, a second
 * factor for everyone, CVs for admins only. Every one is kept by the
 * database, not by this screen. A company admin's; saved together.
 */
export function RulesSettings({ rules }: { rules: CompanyRules }) {
  const t = useTranslations();
  const save = useSaveRules();
  const [approveDecline, setApproveDecline] = useState(rules.approveDecline);
  const [approvePayChange, setApprovePayChange] = useState(rules.approvePayChange);
  const [requireMfa, setRequireMfa] = useState(rules.requireMfa);
  const [cvAdminsOnly, setCvAdminsOnly] = useState(rules.cvAdminsOnly);
  const [ceiling, setCeiling] = useState(rules.spendCeilingMonthEgp === null ? '' : String(rules.spendCeilingMonthEgp));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = () => {
    setError(null);
    setSaved(false);
    const digits = westernDigits(ceiling).replace(/[^\d]/g, '');
    save.mutate(
      { approveDecline, approvePayChange, requireMfa, cvAdminsOnly, spendCeilingMonthEgp: digits ? Number(digits) : null },
      {
        onSuccess: () => setSaved(true),
        onError: (failure) =>
          setError(
            failure instanceof RulesRefused && failure.reason === 'mfa_required'
              ? t('app.rules.mfaFirst')
              : failure instanceof ApiError && failure.status === 0
                ? t('app.offline.body')
                : t('common.errorBody'),
          ),
      },
    );
  };

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('app.rules.title')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('app.rules.body')}
        </Text>
      </View>
      <SettingsGroup>
        <SwitchRow label={t('app.rules.approveDecline')} hint={t('app.rules.approveDeclineHint')} value={approveDecline} onChange={setApproveDecline} testID="rule-decline" />
        <SwitchRow label={t('app.rules.approvePay')} hint={t('app.rules.approvePayHint')} value={approvePayChange} onChange={setApprovePayChange} testID="rule-pay" />
        <SwitchRow label={t('app.rules.cvAdmins')} hint={t('app.rules.cvAdminsHint')} value={cvAdminsOnly} onChange={setCvAdminsOnly} testID="rule-cv" />
        <SwitchRow label={t('app.rules.requireMfa')} hint={t('app.rules.requireMfaHint')} value={requireMfa} onChange={setRequireMfa} testID="rule-mfa" />
      </SettingsGroup>
      <Field label={t('app.rules.ceiling')} hint={t('app.rules.ceilingHint')}>
        <TextField value={ceiling} onChangeText={setCeiling} accessibilityLabel={t('app.rules.ceiling')} keyboardType="number-pad" ltr />
      </Field>
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Button label={t('app.rules.save')} loading={save.isPending} onPress={submit} />
        {saved ? (
          <Text variant="small" tone="success" accessibilityLiveRegion="polite">
            {t('app.hiring.saved')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
