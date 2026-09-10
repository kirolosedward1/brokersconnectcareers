import { Briefcase } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { localized } from '@/i18n/routing';
import { getJobBySlug } from '@/lib/queries/jobs';
import { optional } from '@/lib/queries/error';
import { safeNext } from '@/lib/safe-next';

/**
 * Why this person is being asked to sign in.
 *
 * The auth screens open with "أهلاً بيك تاني" whatever brought somebody to
 * them, which is fine for a returning user typing the URL and wrong for the
 * one path that matters: tapping Apply on a listing and being interrupted. The
 * destination is preserved and they do land back on the form — but at the
 * moment of the interruption the screen says nothing about the job, so the
 * gate reads as a demand for an account rather than as one step inside
 * something they already started.
 *
 * So the listing is named. It also quietly answers the question underneath the
 * hesitation, which is whether the application survives the detour.
 *
 * Real data only: the slug is read out of `next`, the listing is looked up, and
 * if it does not resolve — a stale link, a listing taken down between the click
 * and the redirect, the database unreachable — nothing renders at all rather
 * than a promise about a job that may not exist.
 */
export async function ReturnIntent({ next, locale }: { next?: string; locale: string }) {
  const target = safeNext(next);
  if (!target) return null;

  // Only the apply route. Every other destination is either self-explanatory or
  // somewhere a sentence about applying would simply be wrong.
  const match = /^\/jobs\/([^/?#]+)\/apply(?:[?#]|$)/.exec(target);
  if (!match) return null;

  const job = await optional(getJobBySlug(decodeURIComponent(match[1])), null);
  if (!job) return null;

  const t = await getTranslations('auth');
  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);

  return (
    <div className="mt-6 flex gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
      <Briefcase className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{t('applyingTo', { job: title })}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('applyingToCompany', { company })}</p>
      </div>
    </div>
  );
}
