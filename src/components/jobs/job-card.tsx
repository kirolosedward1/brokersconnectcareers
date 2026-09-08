import { useTranslations } from 'next-intl';
import { BookmarkCheck, CheckCheck, CircleSlash, MapPin, Star } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { VerifiedBadge } from '@/components/verified-badge';
import { CompanyLogo } from '@/components/companies/company-logo';
import { LeadsSourceBadge, SalaryLine } from '@/components/jobs/compensation';
import { cn, formatNumber } from '@/lib/utils';
import type { JobListItem } from '@/lib/queries/jobs';

export function JobCard({
  job,
  locale,
  applied = false,
  saved = false,
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
}) {
  const t = useTranslations('jobs');
  const tCompanies = useTranslations('companies');

  /**
   * Whether this listing is still taking applications.
   *
   * Derived here rather than passed in, because the card already holds the
   * status and the expiry and every caller would otherwise have to remember
   * the same rule. The board only ever renders live roles, so this shows up
   * where it matters: a saved list, where a role can close after it was
   * bookmarked and used to look identical to one still open.
   */
  const closed =
    job.status !== 'active' || (job.expires_at != null && new Date(job.expires_at) <= new Date());

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const district = localized(locale, job.district.name_ar, job.district.name_en);

  return (
    <article
      className={cn(
        'lift reveal group relative rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-primary/30',
        // Still readable, still clickable — just no longer competing with the
        // roles somebody can actually apply to.
        closed && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        {/* The company's mark, so a listings page is scannable by who is
            hiring and not only by job title. */}
        <CompanyLogo
          name={company}
          logoUrl={job.company.logo_url}
          seed={job.company.slug}
          size="sm"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
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
            ) : saved ? (
              <Badge variant="outline">
                <BookmarkCheck aria-hidden />
                {t('saved')}
              </Badge>
            ) : null}
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{company}</span>
            <VerifiedBadge
              status={job.company.verification_status}
              label={tCompanies('verified')}
            />
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {district}
            </span>
          </p>
        </div>

      </div>

      {/* The pay and how many of them, on one line.
          Seats used to be a gradient panel in the corner, which outweighed the
          job title and forced it to wrap on a phone. It is a number people
          scan, not a headline — so it reads as one, beside the figure it
          belongs next to. */}
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
        <SalaryLine job={job} locale={locale} />
        <span aria-hidden className="text-muted-foreground">·</span>
        <span className="numeral inline-flex items-baseline gap-1 font-medium text-primary">
          {formatNumber(job.seats, locale)}
          <span className="text-xs font-normal text-muted-foreground">
            {t('seatsLabel', { count: job.seats })}
          </span>
        </span>
      </p>

      {/* One chip, not four.
          Track, employment type and experience band are the dimensions the
          filter rail already offers — repeating them on every result that
          matched them is restating the question as the answer. They are on the
          listing itself, where somebody has decided to read.

          Where the leads come from stays, because it is the claim this board
          is built on and the one thing a reader cannot infer from their own
          filters. */}
      <div className="mt-2.5">
        <LeadsSourceBadge job={job} />
      </div>
    </article>
  );
}
