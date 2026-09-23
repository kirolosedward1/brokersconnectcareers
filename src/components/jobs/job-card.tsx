import { useTranslations } from 'next-intl';
import { BookmarkCheck, CheckCheck, CircleSlash, MapPin, Star } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { FactLine } from '@/components/ui/fact-line';
import { VerifiedBadge } from '@/components/verified-badge';
import { CompanyLogo } from '@/components/companies/company-logo';
import { CommissionLine, LeadsSourceText, SalaryLine } from '@/components/jobs/compensation';
import { SaveJobToggle } from '@/components/jobs/save-job-toggle';
import { cn, formatNumber, formatRelativeDay } from '@/lib/utils';
import type { JobListItem } from '@/lib/queries/jobs';
import { jobIsLive } from '@/lib/job-state';

export function JobCard({
  job,
  locale,
  applied = false,
  saved = false,
  savable = false,
}: {
  job: JobListItem;
  locale: string;
  /**
   * What the reader has already done with this listing.
   *
   * Both default to false, which is what a signed-out visitor and every
   * non-board use of this card get — the home page and the saved list pass
   * neither, and neither needs to.
   */
  applied?: boolean;
  saved?: boolean;
  /**
   * Whether this reader can save. Only a signed-in consultant can — an
   * employer has no saved list, and a visitor has nowhere to put it — so the
   * bookmark appears where it would work and is absent where pressing it
   * would only produce a sign-in wall.
   */
  savable?: boolean;
}) {
  const t = useTranslations('jobs');
  const tCompanies = useTranslations('companies');
  const tTrack = useTranslations('track');
  const tBand = useTranslations('experienceBand');

  /**
   * Whether this listing is still taking applications.
   *
   * Derived here rather than passed in, because the card already holds the
   * status and the expiry and every caller would otherwise have to remember
   * the same rule. The board only ever renders live roles, so this shows up
   * where it matters: a saved list, where a role can close after it was
   * bookmarked and used to look identical to one still open.
   */
  const closed = !jobIsLive(job);

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const district = localized(locale, job.district.name_ar, job.district.name_en);

  /*
    The facts, in the order a consultant weighs them.

    Two lines of text rather than a row of tags. Who and where first, because
    that is what decides whether the rest is worth reading; then what it pays
    and where the clients come from, which is what decides whether to open it.
    Everything sits on a shared baseline and a shared left edge, so running an
    eye down a page of these compares like with like — which a wrapped cluster
    of pills, each a different width, never allowed.

    Track and experience are back on the row. They had been dropped as
    "restating the filter", which holds on a filtered board and nowhere else:
    the home page, a company's page, the saved list and an unfiltered board all
    show mixed tracks, and there the row could not say whether a role was
    resale or primary without being opened.
  */
  return (
    <article
      className={cn(
        'lift group relative rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5',
        // Still readable, still clickable — just no longer competing with the
        // roles somebody can actually apply to.
        closed && 'opacity-70',
      )}
    >
      {/*
        A grid rather than a flex row, for the phone.

        As a row, the facts shared their line with the logo on one side and
        the date on the other, which on a 360px screen left them about 190px —
        so two lines of facts wrapped to six and a results page showed one and
        a half jobs. Here the facts are a second grid row: beside the logo from
        `sm`, where there is room, and under it at the card's full width below
        that, which halves their height on a phone.
      */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3">
        {/* The company's mark, so a listings page is scannable by who is
            hiring and not only by job title. */}
        <CompanyLogo
          name={company}
          logoUrl={job.company.logo_url}
          seed={job.company.slug}
          size="sm"
        />

        <div className="min-w-0 self-center sm:self-start">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-base font-semibold leading-snug">
              {/* Stretched link keeps the whole card clickable without nesting
                  interactive elements inside an anchor. */}
              <Link
                href={`/jobs/${job.slug}`}
                className="after:absolute after:inset-0 group-hover:text-primary"
              >
                {title}
              </Link>
            </h3>
            {/* Featured is a paid placement, so it is labelled rather than
                disguised as an editorial pick. */}
            {job.is_featured ? (
              <Badge variant="accent">
                <Star aria-hidden />
                {t('featured')}
              </Badge>
            ) : null}

            {/* What the reader already did, next to the title where the eye
                already is. Applied wins when both are true: having applied is
                the stronger fact, and two badges on one card is the noise this
                is meant to save. */}
            {closed ? (
              <Badge variant="default">
                <CircleSlash aria-hidden />
                {t('closedShort')}
              </Badge>
            ) : null}

            {applied ? (
              <Badge variant="success">
                <CheckCheck aria-hidden />
                {t('applied')}
              </Badge>
            ) : saved && !savable ? (
              /* Only where there is no toggle. When the bookmark is on the
                 card, it already shows the state, and a badge saying the same
                 word beside it is the card repeating itself. */
              <Badge variant="outline">
                <BookmarkCheck aria-hidden />
                {t('saved')}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="col-span-3 row-start-2 mt-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:mt-0.5">
          <FactLine className="text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              {/* A company's name is whatever the company typed, often Latin
                  in an Arabic row. Isolated, so its punctuation cannot reorder
                  the facts around it. */}
              <bdi>{company}</bdi>
              <VerifiedBadge
                compact
                status={job.company.verification_status}
                label={tCompanies('verified')}
              />
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              {district}
            </span>
            <span>{tTrack(job.track)}</span>
            <span>{tBand(job.experience_band)}</span>
          </FactLine>

          {/* The pay, the commission where it is a number, where the clients
              come from, and how many of them. Seats used to be a gradient
              panel in the corner, which outweighed the job title; it is a
              figure people scan, so it reads as one. */}
          <FactLine className="mt-1.5 text-sm">
            <SalaryLine job={job} locale={locale} />
            {/* Only a stated percentage. "Undisclosed" and "split" are words,
                not terms, and the listing is where they are explained. */}
            {job.commission_type === 'percentage' && job.commission_value != null ? (
              <span className="text-muted-foreground">
                <CommissionLine job={job} locale={locale} />
              </span>
            ) : null}
            <span className="text-muted-foreground">
              <LeadsSourceText job={job} />
            </span>
            <span className="text-muted-foreground">
              <span className="numeral font-medium text-foreground">
                {formatNumber(job.seats, locale)}
              </span>{' '}
              {t('seatsLabel', { count: job.seats })}
            </span>
          </FactLine>
        </div>

        {/* Freshness at the inline end, above everything else in that column:
            it is the one fact read across rows rather than along one. */}
        <div className="col-start-3 row-start-1 flex shrink-0 flex-col items-end gap-1 sm:row-span-2">
          {job.published_at ? (
            <time
              dateTime={job.published_at}
              className="relative text-xs whitespace-nowrap text-muted-foreground"
            >
              {formatRelativeDay(job.published_at, locale)}
            </time>
          ) : null}
          {savable ? (
            <SaveJobToggle
              jobId={job.id}
              initialSaved={saved}
              labels={{ save: t('save'), remove: t('removeSaved') }}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
