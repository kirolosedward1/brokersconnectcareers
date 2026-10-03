import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type DimensionValue } from 'react-native';
import { router } from 'expo-router';
import { useTranslations } from 'use-intl';
import { CloudOff, Compass, TriangleAlert, WifiOff, type LucideIcon } from '~/components/ui/lucide';
import { ApiError, noAnswer } from '~/lib/api';
import { useHasBoard } from '~/lib/use-tabs';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { Button } from './button';
import { Text } from './text';

function Centered({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[8], gap: space[3] }}>
      {children}
    </View>
  );
}

export function LoadingState() {
  const { colors } = useTheme();
  const t = useTranslations('common');
  return (
    <Centered>
      <ActivityIndicator color={colors.primary} accessibilityLabel={t('loading')} />
    </Centered>
  );
}

/**
 * Nothing here, or nothing yet: an optional mark in a soft disc, what is so,
 * what to do about it, and the way to do it.
 */
/**
 * A list on its way: the shape of the cards that will fill it, still, in the
 * page's muted tone — the place the content will land, rather than a spinner
 * in the middle of nothing. Said as "loading" to VoiceOver, like the spinner.
 */
export function SkeletonList({
  count = 3,
  compact = false,
  inset = true,
}: {
  count?: number;
  compact?: boolean;
  /** Its own margin from the screen's edge; off inside a list that already has one. */
  inset?: boolean;
}) {
  const { colors } = useTheme();
  const t = useTranslations('common');
  const bar = (width: DimensionValue, height: number) => (
    <View style={{ width, height, borderRadius: height / 2, backgroundColor: colors.muted }} />
  );
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('loading')}
      style={{ flex: 1, padding: inset ? gutter : 0, gap: space[3] }}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={{
            ...corner('xl'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: space[4],
            gap: space[3],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <View style={{ width: 44, height: 44, ...corner('md'), backgroundColor: colors.muted }} />
            <View style={{ flex: 1, gap: space[2] }}>
              {bar('72%', 14)}
              {bar('44%', 10)}
            </View>
          </View>
          {compact ? null : (
            <View style={{ gap: space[2] }}>
              {bar('56%', 14)}
              {bar('38%', 10)}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon: Icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  /** A mark for the state, drawn in a soft disc above the title. */
  icon?: LucideIcon;
}) {
  const { colors } = useTheme();
  // At the accessibility sizes the disc gives its room to the words: on the
  // board it pushed the empty state's title to the bottom of the screen.
  const large = useLargeText();
  return (
    <Centered>
      {Icon && !large ? (
        <View
          accessible={false}
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.secondary,
            marginBottom: space[1],
          }}
        >
          <Icon size={26} color={colors.primary} strokeWidth={1.75} />
        </View>
      ) : null}
      <Text variant="headline" weight="semibold" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center', maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {/* As wide as the screen allows, so an action that asks to stretch can; one that does not stays centred. */}
      {action ? <View style={{ marginTop: space[2], alignItems: 'center', alignSelf: 'stretch' }}>{action}</View> : null}
    </Centered>
  );
}

/**
 * What went wrong, in terms the reader can act on: no connection, the service
 * down (their data is safe), or the website's generic "something went wrong".
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations();
  const status = error instanceof ApiError ? error.status : -1;

  const [title, body, Icon] = noAnswer(error)
    ? [t('app.offline.title'), t('app.offline.body'), WifiOff]
    : status === 503
      ? [t('app.unavailable.title'), t('app.unavailable.body'), CloudOff]
      : [t('common.error'), t('common.errorBody'), TriangleAlert];

  return (
    <EmptyState
      title={title}
      body={body}
      icon={Icon}
      action={onRetry ? <Button label={t('common.retry')} variant="outline" onPress={onRetry} /> : null}
    />
  );
}

/**
 * A link to something that is not there, or no longer is — the website's
 * not-found page: what happened, and the way back to the board (home, for
 * somebody whose tab bar has no board).
 */
export function NotFoundState() {
  const t = useTranslations();
  const hasBoard = useHasBoard();
  return (
    <EmptyState
      title={t('common.notFound')}
      body={t('common.notFoundBody')}
      icon={Compass}
      action={
        hasBoard ? (
          <Button label={t('nav.browseJobs')} variant="outline" onPress={() => router.navigate('/jobs')} />
        ) : (
          <Button label={t('app.tabs.home')} variant="outline" onPress={() => router.navigate('/')} />
        )
      }
    />
  );
}
