import { useTranslations } from 'next-intl';
import { Lock, MapPin, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import type { AgentCardRow, DistrictRow } from '@/lib/supabase/database.types';

/**
 * Anonymised by default. An unauthenticated visitor sees experience, tracks and
 * districts — enough to judge the depth of the directory — and no name, no
 * photo, no way to make contact.
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
    .slice(0, 3);

  return (
    <article className="relative h-full rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-muted"
        >
          {agent.is_unlocked && agent.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agent.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            <UserRound className="size-5 text-muted-foreground" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Link href={`/agents/${agent.slug}`} className="after:absolute after:inset-0">
              {agent.is_unlocked && agent.full_name ? agent.full_name : t('anonymous')}
            </Link>
            {agent.is_unlocked ? null : (
              <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('locked')} />
            )}
          </h3>

          <p className="numeral mt-0.5 text-sm text-muted-foreground">
            {t('yearsExperience', { count: agent.years_experience })}
          </p>
        </div>
      </div>

      {headline ? (
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {headline}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge variant="primary">{tAvailability(agent.availability)}</Badge>
        {agent.tracks.slice(0, 2).map((track) => (
          <Badge key={track} variant="outline">
            {tTrack(track)}
          </Badge>
        ))}
      </div>

      {areas.length ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" aria-hidden />
          {areas.map((d) => localized(locale, d.name_ar, d.name_en)).join(' · ')}
          {agent.district_ids.length > areas.length ? (
            <span className="numeral">
              +{formatNumber(agent.district_ids.length - areas.length, locale)}
            </span>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}
