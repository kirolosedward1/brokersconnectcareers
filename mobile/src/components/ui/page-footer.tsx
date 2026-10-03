import { ActivityIndicator, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { noAnswer } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';
import { Button } from './button';
import { Text } from './text';

/** The part of an infinite query a list's end needs. */
type Paged = {
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  error: unknown;
  fetchNextPage: () => unknown;
};

/**
 * The end of a list read a page at a time: a spinner while the next page is on
 * its way and, when it did not come, why and a way to ask again. A page that
 * failed used to leave the list simply ending, with scrolling away and back
 * the only way to try again.
 */
export function PageFooter({ query }: { query: Paged }) {
  const t = useTranslations();
  const { colors } = useTheme();
  if (query.isFetchingNextPage) {
    return (
      <View style={{ paddingTop: space[4] }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!query.isFetchNextPageError) return null;
  return (
    <View style={{ alignItems: 'center', gap: space[2], paddingTop: space[4] }}>
      <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
        {noAnswer(query.error) ? t('app.offline.body') : t('common.errorBody')}
      </Text>
      <Button label={t('common.retry')} variant="outline" size="sm" onPress={() => void query.fetchNextPage()} />
    </View>
  );
}
