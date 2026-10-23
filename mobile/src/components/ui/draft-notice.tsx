import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import { History } from '~/components/ui/lucide';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { markupTags } from '~/i18n/rich';
import type { KeptDraftState } from '~/lib/use-kept-draft';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * Says that a form was filled from a draft kept on the phone, or that one is
 * waiting — the website's DraftNotice, in its words. Never silent: a form that
 * opened filled in with no word why reads as somebody else's work, and starting
 * again would mean emptying every field by hand.
 */
export function DraftNotice({ draft }: { draft: KeptDraftState }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const when = (at: number) => formatDateTime(new Date(at), locale);

  if (draft.offeredAt !== null) {
    return (
      <Notice tone="warning" icon={<History size={16} color={colors.warning} />}>
        <View style={{ gap: space[3] }}>
          <Text variant="small">{t.markup('drafts.offered', { when: when(draft.offeredAt), ...markupTags })}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Button label={t('drafts.restore')} size="sm" variant="outline" onPress={draft.accept} />
            <Button label={t('drafts.discard')} size="sm" variant="ghost" onPress={draft.discard} />
          </View>
        </View>
      </Notice>
    );
  }

  if (draft.restoredAt !== null) {
    return (
      <Notice tone="muted" icon={<History size={16} color={colors.mutedForeground} />}>
        <View style={{ gap: space[2] }}>
          <Text variant="small" style={{ color: colors.mutedForeground }}>
            {t.markup('drafts.restored', { when: when(draft.restoredAt), ...markupTags })}
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <Button label={t('drafts.startOver')} size="sm" variant="ghost" onPress={draft.discard} />
          </View>
        </View>
      </Notice>
    );
  }

  return null;
}
