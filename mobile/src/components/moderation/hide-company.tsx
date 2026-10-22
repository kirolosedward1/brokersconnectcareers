import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { EyeOff } from '~/components/ui/lucide';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { hideAgent, unhideAgent, useHiddenAgents } from '~/features/moderation/hidden-agents';
import { hideCompany, unhideCompany, useHiddenCompanies } from '~/features/moderation/hidden-companies';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';
import { dialog } from '~/lib/dialog';

/**
 * "Hide this company", asked once with what it does (see hidden-companies.ts).
 * Gone once it is hidden: the page's HiddenNotice then says so and takes it
 * back, as Account → "Hidden on this phone" does from anywhere.
 */
export function HideCompany({
  companyId,
  companyName,
  companySlug,
}: {
  companyId: string;
  companyName: string;
  companySlug: string;
}) {
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
        dialog.alert(t('app.moderation.hideTitle', { company: companyName }), t('app.moderation.hideBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('app.moderation.hideConfirm'),
            style: 'destructive',
            onPress: () => hideCompany(companyId, { name: companyName, slug: companySlug }),
          },
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

/**
 * "Hide this consultant", the directory's block (see hidden-agents.ts): asked
 * once with what it does, and gone once they are hidden, when the profile's
 * HiddenAgentNotice says so and takes it back.
 */
export function HideAgent({ agentId, name, slug }: { agentId: string; name: string; slug: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const hidden = useHiddenAgents().has(agentId);

  if (hidden) return null;

  return (
    <Button
      label={t('app.moderation.hideAgent')}
      variant="ghost"
      icon={<EyeOff size={16} color={colors.foreground} />}
      onPress={() =>
        dialog.alert(t('app.moderation.hideAgentTitle', { name }), t('app.moderation.hideAgentBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          // Its own word: the company's is feminine in Arabic, a consultant's is not.
          { text: t('app.moderation.hideAgentConfirm'), style: 'destructive', onPress: () => hideAgent(agentId, { name, slug }) },
        ])
      }
    />
  );
}

/** Shown on a hidden consultant's profile, which the reader opened anyway (a link, an applicant's card). */
export function HiddenAgentNotice({ agentId }: { agentId: string }) {
  const t = useTranslations('app.moderation');
  const hidden = useHiddenAgents().has(agentId);
  if (!hidden) return null;
  return (
    <Notice tone="muted">
      <View style={{ gap: space[2] }}>
        <Text variant="small">{t('hiddenAgent')}</Text>
        <Button label={t('unhideAgent')} variant="outline" size="sm" onPress={() => unhideAgent(agentId)} />
      </View>
    </Notice>
  );
}
