import { Alert, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { EyeOff } from '~/components/ui/lucide';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { hideCompany, unhideCompany, useHiddenCompanies } from '~/features/moderation/hidden-companies';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * "Hide this company", asked once with what it does (see hidden-companies.ts).
 * Gone once it is hidden: the page's HiddenNotice then says so and takes it back.
 */
export function HideCompany({ companyId, companyName }: { companyId: string; companyName: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const hidden = useHiddenCompanies().has(companyId);

  if (hidden) return null;

  return (
    <Button
      label={t('app.moderation.hide')}
      variant="ghost"
      icon={<EyeOff size={16} color={colors.foreground} />}
      onPress={() =>
        Alert.alert(t('app.moderation.hideTitle', { company: companyName }), t('app.moderation.hideBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('app.moderation.hideConfirm'), style: 'destructive', onPress: () => hideCompany(companyId) },
        ])
      }
    />
  );
}

/** Shown on a hidden company's page and listings, which the reader opened anyway. */
export function HiddenNotice({ companyId }: { companyId: string }) {
  const t = useTranslations('app.moderation');
  const hidden = useHiddenCompanies().has(companyId);
  if (!hidden) return null;
  return (
    <Notice tone="muted">
      <View style={{ gap: space[2] }}>
        <Text variant="small">{t('hidden')}</Text>
        <Button label={t('unhide')} variant="outline" size="sm" onPress={() => unhideCompany(companyId)} />
      </View>
    </Notice>
  );
}
