import { View } from 'react-native';
import type { JobListItem } from '@/lib/job-list';
import { JobCard } from '~/components/jobs/job-card';
import { useAppliedLast } from '~/features/jobs/marks';
import { space } from '~/theme/tokens';

/**
 * A short run of listings — a company's open roles, an area's page, Home's
 * newest — each marked "applied" where the reader has, and those moved to the
 * foot of the run, as on the board.
 */
export function JobCardList({ jobs, gap = space[2] }: { jobs: JobListItem[]; gap?: number }) {
  const { jobs: ordered, applied } = useAppliedLast(jobs);
  return (
    <View style={{ gap }}>
      {ordered.map((job) => (
        <JobCard key={job.id} job={job} applied={applied.has(job.id)} />
      ))}
    </View>
  );
}
