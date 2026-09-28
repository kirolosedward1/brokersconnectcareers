import { Stack, useLocalSearchParams } from 'expo-router';
import { parseLandingSlug } from '@/lib/taxonomy';
import { JobDetail } from '~/components/jobs/job-detail';
import { TrackDistrictLanding } from '~/components/jobs/landing';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { useLanding } from '~/features/browse/queries';
import { useJob } from '~/features/jobs/queries';
import { ApiError } from '~/lib/api';

/**
 * /jobs/<slug> is two things on the website, and here: a listing, or a
 * track-in-a-district page (/jobs/primary-new-cairo). The landing form is
 * tried first, as the website does — it is a string match — and a slug that
 * only looks like one (a listing whose title starts with a track) falls
 * through to the listing when no such district exists.
 */
export default function JobOrLandingScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = typeof raw === 'string' ? raw.toLowerCase() : '';
  const parsed = parseLandingSlug(slug);
  const landing = useLanding(parsed ? slug : '');

  if (parsed && landing.isPending) return <Loading />;
  if (parsed && landing.data) {
    return <TrackDistrictLanding slug={slug} track={parsed.track} districtSlug={parsed.districtSlug} />;
  }
  return <Job slug={slug} />;
}

function Job({ slug }: { slug: string }) {
  const job = useJob(slug);

  if (job.isPending) return <Loading />;
  if (job.isError) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        {job.error instanceof ApiError && job.error.status === 404 ? (
          <NotFoundState />
        ) : (
          <ErrorState error={job.error} onRetry={() => job.refetch()} />
        )}
      </>
    );
  }
  return <JobDetail data={job.data} refreshing={job.isRefetching} onRefresh={() => job.refetch()} />;
}

function Loading() {
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <LoadingState />
    </>
  );
}
