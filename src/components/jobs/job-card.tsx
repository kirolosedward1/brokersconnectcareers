import { useTranslations } from 'next-intl';
import { Briefcase, MapPin, Star, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { VerifiedBadge } from '@/components/verified-badge';
import { CompanyLogo } from '@/components/companies/company-logo';
import { LeadsSourceBadge, SalaryLine } from '@/components/jobs/compensation';
import { formatNumber } from '@/lib/utils';
import type { JobListItem } from '@/lib/queries/jobs';

export function JobCard({ job, locale }: { job: JobListItem; locale: string }) {
  const t = useTranslations('jobs');
  const tTrack = useTranslations('track');
  const tType = useTranslations('employmentType');
  const tExp = useTranslations('experienceBand');
  const tCompanies = useTranslations('companies');

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const district = localized(locale, job.district.name_ar, job.district.name_en);

  return (
    <article className="lift reveal group relative rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-primary/30">
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

        {/* The seats count is how this market reads a listing, so it gets the
            most prominent corner of the card. */}
        <div className="bg-brand-gradient shrink-0 rounded-xl px-3.5 py-2.5 text-center text-primary-foreground shadow-[var(--shadow-primary)]">
          <p className="numeral text-xl font-bold leading-none">
            {formatNumber(job.seats, locale)}
          </p>
          <p className="mt-1 text-[11px] leading-tight opacity-90">
            {t('seatsLabel', { count: job.seats })}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm">
        <SalaryLine job={job} locale={locale} />
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <LeadsSourceBadge job={job} />
        <Badge variant="outline">
          <Briefcase aria-hidden />
          {tTrack(job.track)}
        </Badge>
        <Badge variant="outline">{tType(job.employment_type)}</Badge>
        <Badge variant="outline">
          <Users aria-hidden />
          {tExp(job.experience_band)}
        </Badge>
      </div>
    </article>
  );
}
