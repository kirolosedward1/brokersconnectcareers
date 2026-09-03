'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { GraduationCap, Award, Briefcase, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import {
  deleteCvEntry,
  saveCertification,
  saveEducation,
  saveExperience,
} from '@/lib/actions/cv';
import { JOB_TRACKS } from '@/lib/taxonomy';
import type {
  AgentCertificationRow,
  AgentEducationRow,
  AgentExperienceRow,
} from '@/lib/supabase/database.types';

/**
 * The CV sections, edited in place.
 *
 * Each section saves on its own rather than the page having one Save at the
 * bottom: these are independent records, and a validation error in a
 * certification should not hold a job you just typed hostage.
 *
 * Deletion is optimistic. A row here is cheap to retype and the alternative is
 * a list that feels broken for a second every time.
 */

type Props = {
  agentId: string;
  experience: AgentExperienceRow[];
  education: AgentEducationRow[];
  certifications: AgentCertificationRow[];
};

function Section({
  title,
  icon: Icon,
  hint,
  children,
}: {
  title: string;
  icon: typeof Briefcase;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Row({
  primary,
  secondary,
  meta,
  onDelete,
  pending,
  deleteLabel,
}: {
  primary: string;
  secondary?: string | null;
  meta?: string | null;
  onDelete: () => void;
  pending: boolean;
  deleteLabel: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{primary}</p>
        {secondary ? <p className="mt-0.5 text-sm text-muted-foreground">{secondary}</p> : null}
        {meta ? <p className="numeral mt-1 text-xs text-muted-foreground">{meta}</p> : null}
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={deleteLabel}
        className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

export function CvEditor({ agentId, experience, education, certifications }: Props) {
  const t = useTranslations('cv');
  const tCommon = useTranslations('common');
  const tTrack = useTranslations('track');

  const [jobs, setJobs] = useState(experience);
  const [schools, setSchools] = useState(education);
  const [certs, setCerts] = useState(certifications);

  const [open, setOpen] = useState<'experience' | 'education' | 'certification' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(section: 'experience' | 'education' | 'certification', id: string) {
    const before = { jobs, schools, certs };
    if (section === 'experience') setJobs((rows) => rows.filter((r) => r.id !== id));
    if (section === 'education') setSchools((rows) => rows.filter((r) => r.id !== id));
    if (section === 'certification') setCerts((rows) => rows.filter((r) => r.id !== id));

    startTransition(async () => {
      const result = await deleteCvEntry(section, id);
      if (!result.ok) {
        setJobs(before.jobs);
        setSchools(before.schools);
        setCerts(before.certs);
        setError(tCommon('errorBody'));
      }
    });
  }

  function submitExperience(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const track = String(form.get('track') ?? '');

    startTransition(async () => {
      const result = await saveExperience({
        agentId,
        companyName: String(form.get('companyName') ?? ''),
        title: String(form.get('title') ?? ''),
        track: track || null,
        started: String(form.get('started') ?? ''),
        ended: String(form.get('ended') ?? '') || null,
        highlights: String(form.get('highlights') ?? '') || null,
      });
      if (!result.ok) {
        setError(result.error === 'cap' ? t('capReached') : tCommon('errorBody'));
        return;
      }
      window.location.reload();
    });
  }

  function submitEducation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const year = String(form.get('graduated') ?? '');

    startTransition(async () => {
      const result = await saveEducation({
        agentId,
        institution: String(form.get('institution') ?? ''),
        degree: String(form.get('degree') ?? '') || null,
        field: String(form.get('field') ?? '') || null,
        graduated: year ? Number(year) : null,
      });
      if (!result.ok) {
        setError(result.error === 'cap' ? t('capReached') : tCommon('errorBody'));
        return;
      }
      window.location.reload();
    });
  }

  function submitCertification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await saveCertification({
        agentId,
        name: String(form.get('name') ?? ''),
        issuer: String(form.get('issuer') ?? '') || null,
        issued: String(form.get('issued') ?? '') || null,
        expires: String(form.get('expires') ?? '') || null,
      });
      if (!result.ok) {
        setError(result.error === 'cap' ? t('capReached') : tCommon('errorBody'));
        return;
      }
      window.location.reload();
    });
  }

  const addButton = (section: typeof open, label: string) => (
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(open === section ? null : section)}>
      <Plus aria-hidden />
      {label}
    </Button>
  );

  return (
    <div className="space-y-5">
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Section title={t('experience')} icon={Briefcase} hint={t('experienceHint')}>
        {jobs.length ? (
          <ul className="mb-4 space-y-2">
            {jobs.map((job) => (
              <Row
                key={job.id}
                primary={`${job.title} · ${job.company_name}`}
                secondary={job.track ? tTrack(job.track) : null}
                meta={`${job.started.slice(0, 7)} — ${job.ended ? job.ended.slice(0, 7) : t('present')}`}
                onDelete={() => remove('experience', job.id)}
                pending={pending}
                deleteLabel={tCommon('delete')}
              />
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">{t('experienceEmpty')}</p>
        )}

        {addButton('experience', t('addExperience'))}

        {open === 'experience' ? (
          <form onSubmit={submitExperience} className="mt-4 grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
            <Field label={t('company')} htmlFor="companyName">
              <Input id="companyName" name="companyName" required maxLength={120} />
            </Field>
            <Field label={t('jobTitle')} htmlFor="title">
              <Input id="title" name="title" required maxLength={120} />
            </Field>
            <Field label={t('track')} htmlFor="track">
              <Select id="track" name="track" defaultValue="">
                <option value="">—</option>
                {JOB_TRACKS.map((track) => (
                  <option key={track} value={track}>
                    {tTrack(track)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('started')} htmlFor="started">
                <Input id="started" name="started" type="date" required />
              </Field>
              <Field label={t('ended')} htmlFor="ended">
                <Input id="ended" name="ended" type="date" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={t('highlights')} htmlFor="highlights">
                <textarea
                  id="highlights"
                  name="highlights"
                  rows={2}
                  maxLength={600}
                  className="w-full rounded-lg border border-input bg-background p-3 text-sm shadow-xs"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? tCommon('loading') : tCommon('save')}
              </Button>
            </div>
          </form>
        ) : null}
      </Section>

      <Section title={t('education')} icon={GraduationCap}>
        {schools.length ? (
          <ul className="mb-4 space-y-2">
            {schools.map((row) => (
              <Row
                key={row.id}
                primary={row.institution}
                secondary={[row.degree, row.field].filter(Boolean).join(' · ') || null}
                meta={row.graduated ? String(row.graduated) : null}
                onDelete={() => remove('education', row.id)}
                pending={pending}
                deleteLabel={tCommon('delete')}
              />
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">{t('educationEmpty')}</p>
        )}

        {addButton('education', t('addEducation'))}

        {open === 'education' ? (
          <form onSubmit={submitEducation} className="mt-4 grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
            <Field label={t('institution')} htmlFor="institution">
              <Input id="institution" name="institution" required maxLength={160} />
            </Field>
            <Field label={t('degree')} htmlFor="degree">
              <Input id="degree" name="degree" maxLength={120} />
            </Field>
            <Field label={t('field')} htmlFor="field">
              <Input id="field" name="field" maxLength={120} />
            </Field>
            <Field label={t('graduated')} htmlFor="graduated">
              <Input id="graduated" name="graduated" type="number" min={1950} max={2100} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? tCommon('loading') : tCommon('save')}
              </Button>
            </div>
          </form>
        ) : null}
      </Section>

      <Section title={t('certifications')} icon={Award}>
        {certs.length ? (
          <ul className="mb-4 space-y-2">
            {certs.map((row) => (
              <Row
                key={row.id}
                primary={row.name}
                secondary={row.issuer}
                meta={row.issued ? row.issued.slice(0, 7) : null}
                onDelete={() => remove('certification', row.id)}
                pending={pending}
                deleteLabel={tCommon('delete')}
              />
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">{t('certificationsEmpty')}</p>
        )}

        {addButton('certification', t('addCertification'))}

        {open === 'certification' ? (
          <form onSubmit={submitCertification} className="mt-4 grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
            <Field label={t('certName')} htmlFor="name">
              <Input id="name" name="name" required maxLength={160} />
            </Field>
            <Field label={t('issuer')} htmlFor="issuer">
              <Input id="issuer" name="issuer" maxLength={160} />
            </Field>
            <Field label={t('issued')} htmlFor="issued">
              <Input id="issued" name="issued" type="date" />
            </Field>
            <Field label={t('expires')} htmlFor="expires">
              <Input id="expires" name="expires" type="date" />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? tCommon('loading') : tCommon('save')}
              </Button>
            </div>
          </form>
        ) : null}
      </Section>
    </div>
  );
}
