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
    decision_note: string | null;
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
  const tCommon = useTranslations('common');

  const router = useRouter();
  const [status, setStatus] = useState(application.status);
  const [reason, setReason] = useState(application.decision_note ?? '');
  const [savedReason, setSavedReason] = useState(application.decision_note ?? '');
  const [pending, startTransition] = useTransition();

  const candidate = application.candidate;

  function save(next: ApplicationStatus, decisionNote: string) {
    const previousStatus = status;
    const previousReason = savedReason;
    setStatus(next);
    setSavedReason(decisionNote);

    startTransition(async () => {
      const result = await setApplicationStatus({
        applicationId: application.id,
        status: next,
        decisionNote,
      });
      if (!result.ok) {
        setStatus(previousStatus);
        setSavedReason(previousReason);
        setReason(previousReason);
        return;
      }
      router.refresh();
    });
  }

  function onStatusChange(event: React.ChangeEvent<HTMLSelectElement>) {
    save(event.target.value as ApplicationStatus, reason);
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

      {/* Shown once a decision has been made. Not on `new`, where there is
          nothing to explain yet, and never required — a mandatory field here
          fills up with "not a fit", which looks like an answer and is not. */}
      {status !== 'new' ? (
        <div className="mt-4 border-t border-border pt-4">
          <label htmlFor={`reason-${application.id}`} className="text-xs font-medium text-muted-foreground">
            {t('decisionNote')}
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('decisionNoteHint')}</p>

          <div className="mt-2 flex flex-wrap items-start gap-2">
            <textarea
              id={`reason-${application.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder={t('decisionNotePlaceholder')}
              className="min-w-0 flex-1 rounded-lg border border-input bg-background p-2.5 text-sm shadow-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || reason.trim() === savedReason.trim()}
              onClick={() => save(status, reason)}
            >
              {reason.trim() === savedReason.trim() && savedReason ? t('decisionNoteSaved') : tCommon('save')}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
