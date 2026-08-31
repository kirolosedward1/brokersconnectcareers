'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileX2, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { formatDate, isoDate, whatsappLink } from '@/lib/utils';
import { employerOpener } from '@/lib/whatsapp';
import { setApplicationStatus } from '@/lib/actions/applications';
import type { ApplicationStatus, ExperienceBand } from '@/lib/supabase/database.types';
import type { Locale } from '@/i18n/routing';

const STATUSES: ApplicationStatus[] = ['new', 'shortlisted', 'interview', 'hired', 'rejected'];

const STATUS_VARIANT: Record<ApplicationStatus, 'default' | 'primary' | 'success' | 'destructive'> = {
  new: 'default',
  shortlisted: 'primary',
  interview: 'primary',
  hired: 'success',
  rejected: 'destructive',
};

export function ApplicantCard({
  application,
  jobTitle,
  companyName,
  locale,
}: {
  application: {
    id: string;
    status: ApplicationStatus;
    created_at: string;
    note: string | null;
    cv_path: string | null;
    experience_band: ExperienceBand | null;
    candidate: { full_name: string; whatsapp_phone: string } | null;
  };
  jobTitle: string;
  companyName: string;
  locale: Locale;
}) {
  const t = useTranslations('employer');
  const tStatus = useTranslations('applicationStatus');
  const tExp = useTranslations('experienceBand');
  const tJobs = useTranslations('jobs');

  const router = useRouter();
  const [status, setStatus] = useState(application.status);
  const [pending, startTransition] = useTransition();

  const candidate = application.candidate;

  function onStatusChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as ApplicationStatus;
    const previous = status;
    setStatus(next);

    startTransition(async () => {
      const result = await setApplicationStatus({ applicationId: application.id, status: next });
      if (!result.ok) setStatus(previous);
      else router.refresh();
    });
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{candidate?.full_name ?? '—'}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {application.experience_band ? (
              <Badge variant="outline">{tExp(application.experience_band)}</Badge>
            ) : null}
            <time dateTime={isoDate(application.created_at)} className="numeral">
              {tJobs('postedOn', { date: formatDate(application.created_at, locale) })}
            </time>
          </p>
        </div>

        <Badge variant={STATUS_VARIANT[status]} size="lg">
          {tStatus(status)}
        </Badge>
      </div>

      {application.note ? (
        <p className="mt-3 rounded-lg bg-muted p-3 text-sm leading-relaxed">{application.note}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Contact in this market is WhatsApp, with the opener already written. */}
        {candidate ? (
          <Button asChild size="sm">
            <a
              href={whatsappLink(
                candidate.whatsapp_phone,
                employerOpener({
                  candidateName: candidate.full_name,
                  jobTitle,
                  companyName,
                  locale,
                }),
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle />
              {t('whatsappCandidate')}
            </a>
          </Button>
        ) : null}

        {application.cv_path ? (
          <Button asChild variant="outline" size="sm">
            {/* Route handler mints a 5-minute signed URL per click. */}
            <a href={`/api/cv/${application.id}`} target="_blank" rel="noopener noreferrer">
              <Download />
              {t('downloadCv')}
            </a>
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileX2 className="size-3.5" aria-hidden />
            {t('noCv')}
          </span>
        )}

        <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          {t('moveTo')}
          <Select value={status} onChange={onStatusChange} disabled={pending} className="h-8 w-auto">
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {tStatus(value)}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </article>
  );
}
