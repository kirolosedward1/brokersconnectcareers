'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Paperclip } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { createClient } from '@/lib/supabase/client';
import { EXPERIENCE_BANDS } from '@/lib/taxonomy';
import { applyToJob } from '@/lib/actions/applications';
import type { ExperienceBand } from '@/lib/supabase/database.types';

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

  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

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
        const path = `${userId}/${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await createClient()
          .storage.from('cvs')
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

      if (!result.ok) {
        if (result.error === 'already_applied') {
          setErrors({ form: t('alreadyApplied') });
          return;
        }
        setErrors(result.fieldErrors ?? { form: tCommon('errorBody') });
        return;
      }

      setDone(true);
      router.refresh();
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
          className="numeral"
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

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? tCommon('loading') : t('submit')}
      </Button>
    </form>
  );
}
