import { useTranslations } from 'next-intl';
import { Briefcase, CircleDot, Lock, MapPin, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { formatNumber } from '@/lib/utils';
import type { AgentCardRow, DistrictRow } from '@/lib/supabase/database.types';

/**
 * A directory card, anonymised by default.
 *
 * An unauthenticated visitor sees experience, tracks and districts — enough to
 * judge the depth of the directory — and no name, no photo, no way to make
 * contact. That gate is enforced in the database; this only has to render
 * honestly on either side of it.
 *
 * Identity on top, facts underneath a rule. The three things an employer scans
 * a directory for — how experienced, where, and are they even looking — sit in
 * one row in the same place on every card, so the eye can run down the column
 * instead of hunting each card's layout.
 */
export function AgentCard({
  agent,
  locale,
  districts,
}: {
  agent: AgentCardRow;
  locale: string;
  districts: Map<number, DistrictRow>;
}) {
  const t = useTranslations('agents');
  const tTrack = useTranslations('track');
  const tAvailability = useTranslations('availability');

  const headline = localized(locale, agent.headline_ar, agent.headline_en);
  const areas = agent.district_ids
    .map((id) => districts.get(id))
    .filter((d): d is DistrictRow => Boolean(d))
    .slice(0, 2);
  const moreAreas = agent.district_ids.length - areas.length;

  const looking = agent.availability === 'actively_searching';

  return (
    <article className="lift reveal relative rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/30 sm:p-6">
      <div className="flex gap-4">
        <span
          aria-hidden
          className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-muted ring-2 ring-primary/10"
        >
          {agent.is_unlocked && agent.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agent.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            <UserRound className="size-7 text-muted-foreground" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-lg font-semibold leading-tight">
            <Link href={`/agents/${agent.slug}`} className="after:absolute after:inset-0">
              {agent.is_unlocked && agent.full_name ? agent.full_name : t('anonymous')}
            </Link>
            {agent.is_unlocked ? null : (
              <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('locked')} />
            )}
          </h3>

          {headline ? (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {headline}
            </p>
          ) : null}

          {agent.tracks.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {agent.tracks.slice(0, 3).map((track) => (
                <li
                  key={track}
                  className="rounded-full bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary"
                >
                  {tTrack(track)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <span className="numeral inline-flex items-center gap-1.5">
          <Briefcase className="size-4" aria-hidden />
          {t('yearsExperience', { count: agent.years_experience })}
        </span>

        {areas.length ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4" aria-hidden />
            {areas.map((d) => localized(locale, d.name_ar, d.name_en)).join('، ')}
            {moreAreas > 0 ? (
              <span className="numeral">+{formatNumber(moreAreas, locale)}</span>
            ) : null}
          </span>
        ) : null}

        {/* Availability carries a colour only when it is the answer somebody is
            hoping for. A green dot on "not looking" would be a lie told in
            green. */}
        <span
          className={`inline-flex items-center gap-1.5 ${looking ? 'font-medium text-success' : ''}`}
        >
          <CircleDot className="size-4" aria-hidden />
          {tAvailability(agent.availability)}
        </span>
      </div>
    </article>
  );
}
