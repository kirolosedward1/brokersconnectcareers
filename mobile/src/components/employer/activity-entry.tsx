import { useLocale } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import type { CompanyActivityRow } from '@/lib/supabase/database.types';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { activitySubject, useActivityWords } from '~/features/employer/activity';
import { space } from '~/theme/tokens';

/** One thing done: what, about whom or what, by whom and when (Cairo time). */
export function ActivityEntry({ row }: { row: CompanyActivityRow }) {
  const words = useActivityWords();
  const locale = useLocale();
  const subject = activitySubject(locale, row);
  return (
    <Card style={{ gap: space[1] }}>
      <Text weight="semibold">{words.action(row)}</Text>
      {subject ? (
        <Text variant="small" tone="mutedForeground">
          {subject}
        </Text>
      ) : null}
      <Text variant="caption" tone="mutedForeground">
        {`${words.actor(row)} · ${formatDateTime(row.at, locale)}`}
      </Text>
    </Card>
  );
}
