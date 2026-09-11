'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Paperclip, ShieldCheck } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { createClient } from '@/lib/supabase/client';
import { CV_BUCKET } from '@/lib/buckets';
import { EXPERIENCE_BANDS } from '@/lib/taxonomy';
import { applyToJob } from '@/lib/actions/applications';
import type { ExperienceBand } from '@/lib/supabase/database.types';
import { track } from '@/lib/analytics';
import { shareSource } from '@/lib/share-source';
import { uuid } from '@/lib/utils';
import { useSessionRecovery } from '@/lib/session-expired';

const MAX_CV_BYTES = 10 * 1024 * 1024;
const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export function ApplyForm({
  jobId,
  jobSlug,
  userId,
  defaultName,
  defaultPhone,
}: {
  jobId: string;
  jobSlug: string;
  userId: string;
  defaultName: string;
  defaultPhone: string;
}) {
  const t = useTranslations('apply');
  const tExp = useTranslations('experienceBand');
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');

  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();
  const router = useRouter();

  /*
    On a phone the submit button is a full screen below the phone field, so a
    message under the field is invisible from where the thumb is. Bring the
    first invalid field into view and focus it, which also makes a screen
    reader announce the label and its error together.
  */
  useEffect(() => {
    const first = ['fullName', 'whatsapp', 'experienceBand', 'cv', 'note'].find((key) => errors[key]);
    if (!first) return;
    const element = document.getElementById(first);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.focus({ preventScroll: true });
  }, [errors]);

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setErrors((current) => ({ ...current, cv: '' }));

    if (!file) {
      setFileName(null);
      return;
    }
    if (file.size > MAX_CV_BYTES) {
      setErrors((current) => ({ ...current, cv: tValidation('fileTooLarge') }));
      event.target.value = '';
      setFileName(null);
      return;
    }
    if (!CV_TYPES.includes(file.type)) {
      setErrors((current) => ({ ...current, cv: tValidation('fileType') }));
      event.target.value = '';
      setFileName(null);
      return;
    }
    setFileName(file.name);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      let cvPath: string | null = null;
      const file = fileRef.current?.files?.[0];

      if (file) {
        // The CV goes straight to the private bucket from the browser; storage
        // RLS confines every candidate to their own folder.
        const extension = file.name.split('.').pop()?.toLowerCase() ?? 'pdf';
        const path = `${userId}/${uuid()}.${extension}`;

        const { error: uploadError } = await createClient()
          .storage.from(CV_BUCKET)
          .upload(path, file, { upsert: false, contentType: file.type });

        if (uploadError) {
          setErrors({ cv: tCommon('errorBody') });
          return;
        }
        cvPath = path;
      }

      const result = await applyToJob({
        jobId,
        fullName: String(form.get('fullName') ?? ''),
        whatsapp: String(form.get('whatsapp') ?? ''),
        experienceBand: String(form.get('experienceBand') ?? ''),
        cvPath,
        note: String(form.get('note') ?? ''),
      });

      if (recoverSession(result)) {
        // The file goes with it: nothing will ever point at it now.
        if (cvPath) await createClient().storage.from(CV_BUCKET).remove([cvPath]);
        return;
      }

      if (!result.ok) {
        /*
          Take the file back out.

          The CV is uploaded before the application is written, because the
          action wants a path rather than bytes — so every refusal after this
          point (applied already, rate limited, the listing expired while the
          form was open) left a file in the private bucket with nothing
          pointing at it, and each retry left another. Storage RLS confines
          this account to its own folder, which is the same rule that allowed
          the upload, so removing it needs no privilege the browser did not
          already have. A failure here is not worth reporting: the person is
          already being told the application did not go through.
        */
        if (cvPath) {
          await createClient().storage.from(CV_BUCKET).remove([cvPath]);
        }

        if (result.error === 'already_applied') {
          setErrors({ form: t('alreadyApplied') });
          return;
        }
        if (result.error === 'rate_limit') {
          setErrors({ form: t('rateLimit') });
          return;
        }
        setErrors(result.fieldErrors ?? { form: tCommon('errorBody') });
        return;
      }

      /*
        The half of view -> apply that a page view cannot see.

        Still no job id: a per-job breakdown is high-cardinality noise in an
        analytics dashboard, the ratio is the question, and the listing that
        produced it is a database query. The one property that is not noise is
        where the visit began — `share` on an application that started as a
        forwarded link, absent otherwise — because that turns two separate
        numbers into the ratio that says whether forwarding works.
      */
      const src = shareSource();
      track('apply_completed', src ? { src } : undefined);

      // Deliberately no router.refresh() here.
      //
      // Refreshing re-renders the server page, which now sees the application
      // that was just created and returns its "you already applied" branch —
      // replacing this component, `done` and all. The effect was that the most
      // important moment in the product, the one with the green panel and the
      // check and somewhere to go next, was destroyed by the line after the one
      // that set it, and every applicant was told "you already applied to this
      // job before" instead. It reads as a refusal, at the exact moment
      // somebody has succeeded.
      //
      // Nothing on this page needs the refresh: the panel below links to
      // /dashboard/applications, which fetches on its own, and the server
      // reaches its already-applied branch correctly the next time anybody
      // asks for this URL.
      setDone(true);

      /*
        Then hand the confirmation to the server.

        `done` is client state on a page that the action's own revalidatePath
        re-renders, so on its own it lasts about a second: the server finds the
        application that was just written, takes its "you already applied"
        branch, and replaces this component mid-celebration. Every applicant
        was told they were too late at the exact moment they succeeded.

        replace() rather than history.replaceState: the URL alone changes
        nothing, and what is needed is a re-render against ?applied=1 so the
        server produces the confirmation — with the company and the date, which
        this component does not have. It runs after the revalidation, so it
        wins, and the state now survives a refresh because it is in the URL.
      */
      router.replace(`/jobs/${jobSlug}/apply?applied=1`);
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-success/30 bg-success-muted p-6 text-center">
        <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
        <p className="mt-3 font-semibold">{t('success')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('successBody')}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/dashboard/applications">{t('viewApplications')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${jobSlug}`}>{tCommon('back')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field
        label={t('fullName')}
        htmlFor="fullName"
        error={errors.fullName ? tValidation('required') : undefined}
      >
        <Input
          id="fullName"
          name="fullName"
          required
          defaultValue={defaultName}
          autoComplete="name"
          maxLength={120}
        />
      </Field>

      <Field
        label={t('whatsapp')}
        htmlFor="whatsapp"
        error={errors.whatsapp ? tValidation('invalidPhone') : undefined}
      >
        <Input
          id="whatsapp"
          name="whatsapp"
          type="tel"
          required
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={defaultPhone}
          className="numeral-field"
        />
      </Field>

      <Field label={t('experienceBand')} htmlFor="experienceBand">
        <Select id="experienceBand" name="experienceBand" required defaultValue="junior_1_3">
          {EXPERIENCE_BANDS.map((band: ExperienceBand) => (
            <option key={band} value={band}>
              {tExp(band)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('cv')} hint={t('cvOptional')} htmlFor="cv" error={errors.cv || undefined}>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            id="cv"
            name="cv"
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={onFileChange}
            className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium"
          />
        </div>
        {fileName ? (
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Paperclip className="size-3" aria-hidden />
            {fileName}
          </p>
        ) : null}
      </Field>

      <Field label={t('note')} hint={t('noteOptional')} htmlFor="note">
        <Textarea id="note" name="note" maxLength={500} rows={3} />
      </Field>

      {/*
        What pressing this button gives away, said before it is pressed.

        The form asks for a phone number and a CV and then says "less than a
        minute" — which answers how long it takes and not who ends up holding
        it. Every line here is a fact about this system rather than a
        reassurance: the row is readable by the company that owns the job and
        by nobody else (applications_select_employer in migration 04), the
        action writes the name and phone back to the profile, and the delete
        policy is what makes withdrawing real.
      */}
      <div className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">{t('privacyTitle')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('privacyBody')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('privacyProfile')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('privacyNote')}</p>
        </div>
      </div>

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      ) : null}

      <SubmitButton size="lg" className="w-full" disabled={pending}>
        {pending ? tCommon('loading') : t('submit')}
      </SubmitButton>
    </form>
  );
}
