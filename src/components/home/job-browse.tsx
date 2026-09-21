import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { BrowseLink } from '@/components/home/browse-link';
import { formatNumber } from '@/lib/utils';
import type { BrowseCounts } from '@/lib/queries/browse';
import type { DistrictRow } from '@/lib/supabase/database.types';

/** Enough to choose from in one look; the board itself holds the rest. */
const MAX_ROWS = 6;

/**
 * The ways into the board, with how much is behind each.
 *
 * An index, and set like one: a label, a figure, a hairline. Not tiles — a
 * grid of twelve equal boxes each holding one word is the most space a page
 * can spend saying the least, and it asks the eye to read in two directions.
 * A column of aligned rows is read in one, and the figures line up so the
 * busiest district is visible before any name has been read.
 *
 * Every row exists because a live listing does. Nothing is listed at zero, the
 * groups order themselves by what is actually open, and a group with nothing
 * behind it — company type, until companies have said what they are — is not
 * drawn at all. When the board is empty the whole module steps aside.
 *
 * Each row opens the board with that one filter applied, where it shows as a
 * removable token; the figure here and the count there come from the same two
 * predicates under the same anonymous policy, so they agree.
 */
export async function JobBrowse({
  locale,
  counts,
  districts,
  embedded = false,
}: {
  locale: Locale;
  counts: BrowseCounts | null;
  districts: DistrictRow[];
  /**
   * Inside a page that already has its own shell and rhythm — the signed-in
   * home — rather than as a full-width band of the landing page.
   */
  embedded?: boolean;
}) {
  if (!counts || counts.total === 0) return null;

  const t = await getTranslations('landingPage.browse');
  const tTrack = await getTranslations('track');
  const tCompanyType = await getTranslations('companyType');

  const districtById = new Map(districts.map((district) => [district.id, district]));

  const groups = [
    {
      key: 'location',
      title: t('byDistrict'),
      rows: counts.districts
        .map(({ districtId, count }) => {
          const district = districtById.get(districtId);
          return district
            ? {
                key: district.slug,
                label: localized(locale, district.name_ar, district.name_en),
                count,
                query: { district: district.slug },
                event: 'homepage_job_browse_location' as const,
              }
            : null;
        })
        .filter((row) => row !== null)
        .slice(0, MAX_ROWS),
    },
    {
      key: 'track',
      title: t('byTrack'),
      rows: counts.tracks.slice(0, MAX_ROWS).map(({ track, count }) => ({
        key: track,
        label: tTrack(track),
        count,
        query: { track },
        event: 'homepage_job_browse_category' as const,
      })),
    },
    {
      key: 'companyType',
      title: t('byCompanyType'),
      rows: (counts.companyTypes ?? []).map(({ type, count }) => ({
        key: type,
        label: tCompanyType(`${type}_jobs`),
        count,
        query: { ctype: type },
        event: 'homepage_job_browse_company_type' as const,
      })),
    },
  ].filter((group) => group.rows.length > 0);

  if (groups.length === 0) return null;

  return (
    <section
      aria-labelledby="browse-heading"
      className={embedded ? undefined : 'border-b border-border'}
    >
      <div className={embedded ? undefined : 'shell py-8 sm:py-10'}>
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="browse-heading" className="text-lg font-bold sm:text-xl">
            {t('title')}
          </h2>
          <Link
            href="/jobs"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {t.rich('allJobs', {
              count: formatNumber(counts.total, locale),
              v: (chunks) => <span className="numeral">{chunks}</span>,
            })}
            <ArrowRight className="rtl-flip size-3.5" aria-hidden />
          </Link>
        </div>

        <div
          className={
            groups.length === 3
              ? 'mt-4 grid gap-x-12 gap-y-7 lg:grid-cols-3'
              : 'mt-4 grid gap-x-12 gap-y-7 lg:grid-cols-2'
          }
        >
          {groups.map((group) => (
            <div key={group.key}>
              <h3 className="border-b border-foreground/80 pb-2 text-[13px] font-semibold text-muted-foreground">
                {group.title}
              </h3>

              {/* Two columns on a phone, where a single column of six rows per
                  group is three screens of scrolling to reach the listings;
                  one from `lg`, where the groups already sit side by side. */}
              <ul className="grid grid-cols-2 gap-x-6 lg:grid-cols-1">
                {group.rows.map((row) => (
                  <li key={row.key} className="border-b border-border">
                    <BrowseLink
                      href={{ pathname: '/jobs', query: row.query }}
                      event={row.event}
                      value={row.key}
                      className="group/row flex min-h-11 items-center justify-between gap-3 text-[15px] transition-colors hover:text-primary"
                    >
                      <span className="truncate font-medium">{row.label}</span>
                      {/* The figure is decoration for the eye and a sentence
                          for a screen reader, which would otherwise announce a
                          bare number after the district's name. */}
                      <span
                        aria-hidden
                        className="numeral shrink-0 text-sm text-muted-foreground group-hover/row:text-primary"
                      >
                        {formatNumber(row.count, locale)}
                      </span>
                      <span className="sr-only">{t('jobsCount', { count: row.count })}</span>
                    </BrowseLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
