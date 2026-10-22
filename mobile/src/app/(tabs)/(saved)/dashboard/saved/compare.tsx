import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslations } from 'use-intl';
import type { JobListItem } from '@/lib/job-list';
import { jobIsLive } from '@/lib/job-state';
import { CompareTable } from '~/components/saved/compare-table';
import { Button } from '~/components/ui/button';
import { Scale } from '~/components/ui/lucide';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { COMPARE_MIN, parseCompareIds } from '~/features/saved/compare';
import { useSavedJobs } from '~/features/saved/queries';

/**
 * The saved listings chosen in Saved, side by side (`ids`, in the order they
 * were chosen). An app screen of its own — the website has no such page — in
 * the Saved tab's stack, with Back to the choosing.
 *
 * Drawn from the saved list the tab has already read, so it opens at once;
 * a listing no longer saved, or no longer hiring (closed, or past its closing
 * date) — as Saved lets only open ones be chosen — drops out, at once or at
 * the list's next read, and with fewer than two left there is nothing to
 * compare, which it says.
 */
export default function CompareScreen() {
  const t = useTranslations();
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const saved = useSavedJobs();
  const wanted = parseCompareIds(ids);
  const jobs = wanted
    .map((id) => saved.data?.find((job) => job.id === id && jobIsLive(job)))
    .filter((job): job is JobListItem => Boolean(job));

  let body: React.ReactNode;
  if (saved.isPending) {
    body = <LoadingState />;
  } else if (saved.isError && !saved.data) {
    body = <ErrorState error={saved.error} onRetry={() => saved.refetch()} />;
  } else if (jobs.length < COMPARE_MIN) {
    body = (
      <EmptyState
        icon={Scale}
        title={t('app.saved.compare.tooFew')}
        body={t('app.saved.compare.tooFewBody')}
        action={
          <Button
            label={t('app.saved.compare.back')}
            variant="outline"
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/dashboard/saved'))}
          />
        }
      />
    );
  } else {
    body = <CompareTable jobs={jobs} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: t('app.saved.compare.title') }} />
      {body}
    </>
  );
}
