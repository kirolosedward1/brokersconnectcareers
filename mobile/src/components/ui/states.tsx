import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslations } from 'use-intl';
import { ApiError, noAnswer } from '~/lib/api';
import { useHasBoard } from '~/lib/use-tabs';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';
import { Button } from './button';
import { Text } from './text';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6], gap: space[3] }}>
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

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <Centered>
      <Text variant="title" weight="semibold" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text tone="mutedForeground" style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {action}
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

  const [title, body] =
    noAnswer(error)
      ? [t('app.offline.title'), t('app.offline.body')]
      : status === 503
        ? [t('app.unavailable.title'), t('app.unavailable.body')]
        : [t('common.error'), t('common.errorBody')];

  return (
    <EmptyState
      title={title}
      body={body}
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
