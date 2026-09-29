import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Bell } from '~/components/ui/lucide';
import { formatNumber } from '@/lib/format';
import { Text } from '~/components/ui/text';
import { useUnreadCount } from '~/features/notifications/queries';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { hitTarget, radius } from '~/theme/tokens';

/**
 * The bell, at the trailing end of each tab's first screen — the website keeps
 * it in every header, because a reply arrives wherever the reader happens to
 * be. The count is the unread feed; the feed opens in the tab the reader is in.
 * Nothing for somebody signed out, or not yet onboarded, who has no feed.
 */
export function HeaderBell() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const { colors } = useTheme();
  const { session, viewer } = useSession();
  const unread = useUnreadCount().data ?? 0;

  if (!session || !viewer?.profile) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('title')}
      accessibilityValue={unread > 0 ? { text: t('unreadCount', { count: unread }) } : undefined}
      onPress={() => router.push('/notifications')}
      hitSlop={4}
      style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
    >
      <View>
        <Bell size={22} color={colors.foreground} />
        {unread > 0 ? (
          // The badge hangs off the icon, as on the website. It grows with the
          // reader's text size up to a point: any larger would cover the bell,
          // and VoiceOver reads the count out anyway.
          <View
            style={{
              position: 'absolute',
              top: -6,
              end: -8,
              minWidth: 18,
              minHeight: 18,
              paddingHorizontal: 4,
              borderRadius: radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.destructive,
            }}
          >
            <Text
              weight="semibold"
              maxFontSizeMultiplier={1.4}
              style={{ fontSize: 11, lineHeight: 16, color: colors.destructiveForeground }}
            >
              {unread > 99 ? `${formatNumber(99, locale)}+` : formatNumber(unread, locale)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
