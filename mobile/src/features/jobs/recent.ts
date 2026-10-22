import { useSession } from '~/lib/session';
import { createLocalList } from '~/lib/local-list';

/** A listing as the "recently viewed" row draws it: enough to show and open it without asking anyone. */
export type ViewedJob = {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string | null;
  company: { id: string; slug: string; name_ar: string; name_en: string | null; logo_url: string | null };
  district: { name_ar: string; name_en: string | null };
};

/** As many as the row shows, and a few to spare when one is hidden or closed. */
const KEPT = 10;

function isViewedJob(item: unknown): item is ViewedJob {
  const job = item as ViewedJob | null;
  return Boolean(job && typeof job.id === 'string' && typeof job.slug === 'string' && typeof job.title_ar === 'string' && job.company && typeof job.company.id === 'string' && job.district);
}

/**
 * The listings this person opened lately, newest first, on this phone only
 * (src/lib/local-list.ts): Home shows them again so a role looked at
 * yesterday is one tap away. Nothing about it reaches the website.
 */
export const recentJobs = createLocalList<ViewedJob>('bc.recent-jobs.v1', { max: KEPT, idOf: (job) => job.id, valid: isViewedJob });

/** Whose list it is: the signed-in person, or the phone's while signed out. */
export function useListOwner(): string {
  return useSession().session?.user.id ?? 'anon';
}

/** A listing as the row keeps it, from the page's own read. */
export function viewedFrom(job: {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string | null;
  company: { id: string; slug: string; name_ar: string; name_en: string | null; logo_url: string | null };
  district: { name_ar: string; name_en: string | null };
}): ViewedJob {
  return {
    id: job.id,
    slug: job.slug,
    title_ar: job.title_ar,
    title_en: job.title_en,
    company: { id: job.company.id, slug: job.company.slug, name_ar: job.company.name_ar, name_en: job.company.name_en, logo_url: job.company.logo_url },
    district: { name_ar: job.district.name_ar, name_en: job.district.name_en },
  };
}
