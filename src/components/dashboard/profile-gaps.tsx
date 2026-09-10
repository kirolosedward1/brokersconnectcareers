import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { AgentProfileRow } from '@/lib/supabase/database.types';

/**
 * What is missing from this profile, and why each one matters.
 *
 * The page showed a percentage. A percentage is a score in a game nobody
 * agreed to play: it says 45 without saying which 55 is absent, or which of
 * the absent things would change anything, so the rational response is to
 * ignore it.
 *
 * The weights already exist and are already unequal — profile_completeness in
 * migration 12 gives a summary 20 points, a headline 15, districts 10 — so the
 * product already has an opinion about what matters. This states that opinion
 * out loud, in the order it holds it, with the reason attached.
 *
 * Every reason is a real mechanism in this product, not encouragement. Tracks
 * and districts genuinely order the roles on the dashboard; visibility
 * genuinely governs whether a verified company can see a name. Nothing here
 * says a field will "boost" anything, because nothing here measures that.
 */
export async function ProfileGaps({
  agent,
  completeness,
  hasExperience,
  hasEducation,
}: {
  agent: AgentProfileRow;
  completeness: number;
  hasExperience: boolean;
  hasEducation: boolean;
}) {
  const t = await getTranslations('cv');

  // Same tests and same weights as profile_completeness(), so the list and the
  // percentage can never disagree about what is done.
  const gaps = [
    { key: 'summary', points: 20, missing: !agent.summary_ar?.trim() },
    { key: 'headline', points: 15, missing: !agent.headline_ar?.trim() },
    { key: 'experience', points: 15, missing: !hasExperience },
    { key: 'tracks', points: 10, missing: !agent.tracks?.length },
    { key: 'districts', points: 10, missing: !agent.district_ids?.length },
    { key: 'years', points: 10, missing: !(agent.years_experience > 0) },
    { key: 'record', points: 10, missing: agent.units_closed == null && agent.volume_egp == null },
    { key: 'education', points: 10, missing: !hasEducation },
  ]
    .filter((gap) => gap.missing)
    // Biggest gain first: if somebody only does one thing today, it should be
    // the one that moves the most.
    .sort((a, b) => b.points - a.points);

  if (gaps.length === 0) return null;

  return (
    <section
      aria-labelledby="profile-gaps"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="profile-gaps" className="text-lg font-semibold">
          {t('gapsTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('gapsProgress', { percent: completeness })}
        </p>
      </div>

      <ul className="mt-4 space-y-3">
        {gaps.map((gap) => (
          <li key={gap.key} className="flex items-start gap-3 border-t border-border pt-3 first:border-0 first:pt-0">
            <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {t('gapsPoints', { points: gap.points })}
            </span>
            <div className="min-w-0">
              <p className="font-medium">{t(`gap_${gap.key}` as 'gap_summary')}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                {t(`gapWhy_${gap.key}` as 'gapWhy_summary')}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* Down the page rather than away from it: everything above is editable
          here, so the link is an anchor, not a navigation. */}
      <p className="mt-4">
        <Link
          href="/dashboard/profile#profile-form"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          {t('gapsCta')}
          <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
        </Link>
      </p>
    </section>
  );
}
