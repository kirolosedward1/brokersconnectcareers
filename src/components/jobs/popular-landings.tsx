import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { getBrowseCounts } from '@/lib/queries/browse';
import { optional } from '@/lib/queries/error';
import { getDistricts } from '@/lib/queries/taxonomy';
import { buildLandingSlug } from '@/lib/taxonomy';
import { cn, formatNumber } from '@/lib/utils';

/**
 * The track-in-district pages that have live listings, busiest first.
 *
 * These are the board's indexable landing pages, and until now nothing but
 * each other linked to them — a crawler could reach them only from the
 * sitemap. Listed from the live counts, so every link here opens a page with
 * roles on it; a pair with nothing open simply is not offered.
 *
 * Renders nothing when the counts cannot be read or nothing is live.
 */
export async function PopularLandings({
  locale,
  limit = 12,
  className = 'mt-10 border-t border-border pt-6',
  id = 'popular-landings',
  tone = 'default',
}: {
  locale: Locale;
  limit?: number;
  className?: string;
  id?: string;
  /** Footer passes `onDark` so these links match the other footer links. */
  tone?: 'default' | 'onDark';
}) {
  const [counts, districts] = await Promise.all([
    optional(getBrowseCounts(), null),
    optional(getDistricts(), []),
  ]);

  const byId = new Map(districts.map((district) => [district.id, district]));
  const pairs = (counts?.pairs ?? [])
    .filter((pair) => byId.has(pair.districtId))
    .slice(0, limit);

  if (!pairs.length) return null;

  const t = await getTranslations('landing');
  const tTrack = await getTranslations('track');

  return (
    <nav aria-labelledby={id} className={className}>
      <h2 id={id} className={cn('text-sm', tone === 'onDark' ? 'font-medium text-white' : 'font-semibold')}>
        {t('popularTitle')}
      </h2>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {pairs.map((pair) => {
          const district = byId.get(pair.districtId)!;
          const districtName = localized(locale, district.name_ar, district.name_en);
          return (
            <li key={`${pair.track}:${pair.districtId}`}>
              <Link
                href={`/jobs/${buildLandingSlug(pair.track, district.slug)}`}
                className={cn(
                  'inline-flex min-h-8 items-center gap-2 underline-offset-4 hover:underline',
                  tone === 'onDark'
                    ? 'text-white/70 hover:text-white'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('title', { track: tTrack(pair.track), district: districtName })}
                <span className="numeral text-xs">{formatNumber(pair.count, locale)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
