import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { whatsappLink } from '@/lib/whatsapp';
import { Card } from '~/components/ui/card';
import { ContactButtons } from '~/components/ui/contact-buttons';
import { Clock, CirclePause } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { dayRuns, weekdayName, type CompanyHiring } from '~/features/companies/hiring';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * A company that has paused hiring (Phase B 07a): its listings stay up, and
 * say plainly that no application can be sent now — and until when, when
 * the company named a day.
 */
export function PausedNotice({ hiring }: { hiring: CompanyHiring }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <Card style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <CirclePause size={18} color={colors.warning} />
        <Text weight="semibold" style={{ flex: 1 }}>
          {t('app.hiring.pausedTitle')}
        </Text>
      </View>
      <Text variant="small" tone="mutedForeground">
        {hiring.pausedUntil
          ? t('app.hiring.pausedUntil', { date: formatDate(`${hiring.pausedUntil}T12:00:00Z`, locale) })
          : t('app.hiring.pausedOpenEnded')}
      </Text>
    </Card>
  );
}

/** When the company answers, Cairo time: "Sunday–Thursday, 10:00 to 18:00". */
export function ReplyHoursLine({ hiring }: { hiring: CompanyHiring }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  if (!hiring.replyHours) return null;
  const days = dayRuns(hiring.replyHours.days, (day) => weekdayName(day, locale), t('app.hiring.daySeparator'));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
      <Clock size={15} color={colors.mutedForeground} style={{ marginTop: 3 }} />
      <Text variant="small" tone="mutedForeground" style={{ flex: 1 }} testID="reply-hours">
        {t.markup('app.hiring.replyHours', { days, from: hiring.replyHours.from, to: hiring.replyHours.to, ...markupTags })}
      </Text>
    </View>
  );
}

/** The company's own number for candidates, when it gave one, with when it answers. */
export function CompanyContact({ name, hiring }: { name: string; hiring: CompanyHiring }) {
  const t = useTranslations();
  if (!hiring.whatsapp && !hiring.replyHours) return null;
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="headline" weight="semibold" accessibilityRole="header">
        {t('app.hiring.contactTitle')}
      </Text>
      <ReplyHoursLine hiring={hiring} />
      {hiring.whatsapp ? <ContactButtons name={name} whatsappUrl={whatsappLink(hiring.whatsapp)} /> : null}
    </View>
  );
}
