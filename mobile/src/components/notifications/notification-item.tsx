import type { ComponentType } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import {
  BadgeCheck,
  Ban,
  Bell,
  Briefcase,
  CalendarClock,
  CalendarX2,
  CirclePause,
  CircleSlash,
  Eye,
  EyeOff,
  FileCheck2,
  FileWarning,
  FileX2,
  KeyRound,
  LifeBuoy,
  Scale,
  Send,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserRound,
  type LucideProps,
} from '~/components/ui/lucide';
import { formatDate } from '@/lib/format';
import { isKnownNotificationKind, notificationTitle, type Translate } from '@/lib/notifications/title';
import type { NotificationKind, NotificationRow } from '@/lib/supabase/database.types';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import type { Colors } from '~/theme/tokens';
import { radius, space } from '~/theme/tokens';

/**
 * One notification — the website's NotificationItem, icon for icon and tone
 * for tone. The row holds data; the sentence is built here from the shared
 * notificationTitle, so the bell, the website and a push say the same thing.
 * A kind this build does not know yet is a plain notice rather than an error.
 */
const ICONS: Record<NotificationKind, ComponentType<LucideProps>> = {
  application_submitted: Send,
  application_received: UserRound,
  application_withdrawn: UserMinus,
  application_moved: Send,
  job_published: FileCheck2,
  job_rejected: FileX2,
  company_verified: BadgeCheck,
  account_approved: UserCheck,
  account_rejected: CircleSlash,
  job_expiring: CalendarClock,
  job_expired: CalendarX2,
  company_verification_needed: FileWarning,
  profile_visibility_changed: Eye,
  password_changed: KeyRound,
  support_replied: LifeBuoy,
  report_reviewed: ShieldCheck,
  company_suspended: Ban,
  company_restored: BadgeCheck,
  profile_restricted: EyeOff,
  profile_restored: Eye,
  account_held: CirclePause,
  appeal_decided: Scale,
  new_jobs: Briefcase,
};

type Tone = 'success' | 'primary' | 'muted' | 'destructive' | 'warning';

const TONES: Record<NotificationKind, Tone> = {
  application_submitted: 'success',
  application_received: 'primary',
  application_withdrawn: 'muted',
  application_moved: 'primary',
  job_published: 'success',
  job_rejected: 'destructive',
  company_verified: 'success',
  account_approved: 'success',
  account_rejected: 'destructive',
  job_expiring: 'warning',
  job_expired: 'muted',
  company_verification_needed: 'destructive',
  profile_visibility_changed: 'primary',
  // A security notice reads as one.
  password_changed: 'warning',
  support_replied: 'primary',
  report_reviewed: 'primary',
  company_suspended: 'destructive',
  company_restored: 'success',
  profile_restricted: 'destructive',
  profile_restored: 'success',
  account_held: 'warning',
  appeal_decided: 'primary',
  new_jobs: 'primary',
};

function toneColors(tone: Tone, colors: Colors): { background: string; foreground: string } {
  switch (tone) {
    case 'success':
      return { background: colors.successMuted, foreground: colors.success };
    case 'primary':
      return { background: colors.secondary, foreground: colors.primary };
    case 'destructive':
      return { background: colors.destructiveMuted, foreground: colors.destructive };
    case 'warning':
      return { background: colors.warningMuted, foreground: colors.warning };
    case 'muted':
      return { background: colors.muted, foreground: colors.mutedForeground };
  }
}

export function NotificationItem({
  notification,
  onPress,
  opening = false,
}: {
  notification: NotificationRow;
  onPress: () => void;
  /** Following it is under way: the row waits rather than taking a second tap. */
  opening?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const { colors } = useTheme();

  const known = isKnownNotificationKind(notification.kind);
  const Icon = known ? ICONS[notification.kind] : Bell;
  const tone = toneColors(known ? TONES[notification.kind] : 'muted', colors);
  const title = notificationTitle(notification, locale, t as unknown as Translate);
  const body = notification.payload?.note || null;
  const unread = !notification.read_at;
  const date = formatDate(notification.created_at, locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, body, date, unread ? t('notifications.unread') : null]
        .filter(Boolean)
        .join(locale === 'ar' ? '، ' : ', ')}
      accessibilityState={{ busy: opening }}
      disabled={opening}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3],
        padding: space[3],
        borderRadius: radius.xl,
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.lg,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tone.background,
        }}
      >
        <Icon size={16} color={tone.foreground} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" weight={unread ? 'medium' : 'regular'}>
          {title}
        </Text>
        {body ? (
          <Text variant="small" tone="mutedForeground">
            {body}
          </Text>
        ) : null}
        <Text variant="caption" tone="mutedForeground">
          {date}
        </Text>
      </View>

      {/* Unread is a dot, not a colour wash, as on the website. */}
      {opening ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : unread ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: space[2], backgroundColor: colors.primary }} />
      ) : null}
    </Pressable>
  );
}
