import { useTranslations } from 'next-intl';
import { Briefcase, CircleDot, Lock, MapPin, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Avatar } from '@/components/ui/avatar';
import { ShortlistToggle } from '@/components/agents/shortlist-toggle';
import { formatList, formatNumber } from '@/lib/utils';
import type { AgentCardRow, DistrictRow } from '@/lib/supabase/database.types';

/**
 * A directory card, anonymised until the company is verified.
 *
 * An unverified company sees experience, tracks and districts — enough to
 * judge whether somebody is worth verifying for — and no name, no photo and
 * no way to make contact. That gate is enforced in the database; this only
 * has to render honestly on either side of it, and it links by id where the
 * slug would have spelled the name.
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
  shortlistable = false,
  shortlisted = false,
}: {
  agent: AgentCardRow;
  locale: string;
  districts: Map<number, DistrictRow>;
  /** Whether the viewer has a company to keep this consultant in, and the card is open. */
  shortlistable?: boolean;
  shortlisted?: boolean;
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
  const href = `/agents/${agent.slug ?? agent.id}`;

  return (
    <article className="lift relative h-full rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5">
      <div className="flex gap-3 sm:gap-4">
        {/* A monogram rather than a silhouette when there is no photo, and a
            fallback when the photo fails to load. A locked profile keeps the
            silhouette — an initial is more than an anonymous card may say. */}
        {agent.is_unlocked ? (
          <Avatar
            name={agent.full_name ?? ''}
            src={agent.avatar_url}
            seed={agent.slug ?? agent.id}
            size="md"
            className="ring-2 ring-primary/10 sm:size-16 sm:text-2xl"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-muted ring-2 ring-primary/10 sm:size-16"
          >
            <UserRound className="size-5 text-muted-foreground sm:size-7" aria-hidden />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-base font-semibold leading-tight sm:text-lg">
            <Link href={href} className="after:absolute after:inset-0">
              <bdi>{agent.is_unlocked && agent.full_name ? agent.full_name : t('anonymous')}</bdi>
            </Link>
            {agent.is_unlocked ? null : (
              <Lock className="size-3.5 shrink-0 text-muted-foreground" role="img" aria-label={t('locked')} />
            )}
          </h3>

          {headline ? (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {headline}
            </p>
          ) : null}

          {agent.tracks.length ? (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
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

        {shortlistable ? (
          <ShortlistToggle
            agentId={agent.id}
            initialSaved={shortlisted}
            labels={{ add: t('shortlistAdd'), remove: t('shortlistRemove') }}
            className="-mt-1 -me-1"
          />
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 text-sm text-muted-foreground sm:mt-5 sm:gap-x-5 sm:pt-4">
        <span className="inline-flex items-center gap-1.5">
          <Briefcase className="size-4" aria-hidden />
          {t('yearsExperience', { count: agent.years_experience })}
        </span>

        {areas.length ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4" aria-hidden />
            {formatList(areas.map((d) => localized(locale, d.name_ar, d.name_en)), locale)}
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
