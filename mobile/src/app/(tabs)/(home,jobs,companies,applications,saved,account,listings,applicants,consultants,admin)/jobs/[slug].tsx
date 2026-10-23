import { Stack, useLocalSearchParams } from 'expo-router';
import { parseLandingSlug } from '@/lib/taxonomy';
import { JobDetail } from '~/components/jobs/job-detail';
import { TrackDistrictLanding } from '~/components/jobs/landing';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { useLanding } from '~/features/browse/queries';
import { useJob } from '~/features/jobs/queries';
import { useDistricts } from '~/features/taxonomy';
import { ApiError } from '~/lib/api';
import { usePullRefresh } from '~/lib/use-pull-refresh';

/**
 * /jobs/<slug> is two things on the website, and here: a listing, or a
 * track-in-a-district page (/jobs/primary-sales-new-cairo). The website
 * decides in process. Here the landing route is asked only when the district
 * half is a district this phone already knows — a listing whose title starts
 * with a track (`resale-consultant-…`) parses the same way, and asking the
 * route for it answered 404 for every such listing. While the districts are
 * still loading, nothing is asked. If they could not be read, the route is
 * asked as before, so a real landing is not hidden behind that failure.
 */
export default function JobOrLandingScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = typeof raw === 'string' ? raw.toLowerCase() : '';
  const parsed = parseLandingSlug(slug);
  const districts = useDistricts();
  const known = parsed && districts.data?.some((row) => row.slug === parsed.districtSlug) ? parsed : null;
  const askLanding = Boolean(known) || Boolean(parsed && districts.isError && !districts.data);
  const landing = useLanding(askLanding ? slug : '');

  if (parsed && districts.isLoading) return <Loading />;
  if (askLanding && landing.isLoading) return <Loading />;
  if (known && landing.data) {
    return <TrackDistrictLanding slug={slug} track={known.track} districtSlug={known.districtSlug} />;
  }
  // Only "no such district" makes it a listing's address; a landing that could
  // not be read is not a listing that does not exist.
  if (askLanding && landing.isError && !(landing.error instanceof ApiError && landing.error.status === 404)) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <ErrorState error={landing.error} onRetry={() => landing.refetch()} />
      </>
    );
  }
  return <Job slug={slug} />;
}

function Job({ slug }: { slug: string }) {
  const job = useJob(slug);
  const pull = usePullRefresh(() => job.refetch());

  if (job.isPending) return <Loading />;
  // A failed re-read keeps what is on screen; only a first read that failed is an error page.
  if (job.isError && !job.data) {
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
  return <JobDetail data={job.data} refreshing={pull.refreshing} onRefresh={pull.onRefresh} />;
}

function Loading() {
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <LoadingState />
    </>
  );
}
