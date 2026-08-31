'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import {
  BENEFITS,
  COMMISSION_TYPES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_BANDS,
  JOB_TRACKS,
  LEADS_SOURCES,
} from '@/lib/taxonomy';
import { saveJob } from '@/lib/actions/employer-jobs';
import type {
  Benefit,
  CommissionType,
  DeveloperRow,
  DistrictRow,
  JobRow,
} from '@/lib/supabase/database.types';

type Values = {
  titleAr: string;
  titleEn: string;
  track: string;
  employmentType: string;
  experienceBand: string;
  seats: string;
  districtId: string;
  basicSalaryMin: string;
  basicSalaryMax: string;
  commissionType: CommissionType;
  commissionValue: string;
  commissionNoteAr: string;
  leadsSource: string;
  descriptionAr: string;
  descriptionEn: string;
  requirementsAr: string;
};

const STEPS = ['basics', 'compensation', 'details', 'review'] as const;

export function JobForm({
  locale,
  job,
  districts,
  developers,
  selectedDeveloperIds,
}: {
  locale: string;
  job: JobRow | null;
  districts: DistrictRow[];
  developers: DeveloperRow[];
  selectedDeveloperIds: number[];
}) {
  const t = useTranslations('jobForm');
  const tTrack = useTranslations('track');
  const tType = useTranslations('employmentType');
  const tExp = useTranslations('experienceBand');
  const tLeads = useTranslations('leadsSource');
  const tCommission = useTranslations('commissionType');
  const tBenefit = useTranslations('benefits');
  const tFilters = useTranslations('filters');
  const tEmployer = useTranslations('employer');
  const tCommon = useTranslations('common');
  const tValidation = useTranslations('validation');

  const router = useRouter();
  const [step, setStep] = useState(0);
  const [benefits, setBenefits] = useState<Benefit[]>((job?.benefits as Benefit[]) ?? []);
  const [developerIds, setDeveloperIds] = useState<number[]>(selectedDeveloperIds);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const [values, setValues] = useState<Values>({
    titleAr: job?.title_ar ?? '',
    titleEn: job?.title_en ?? '',
    track: job?.track ?? 'primary',
    employmentType: job?.employment_type ?? 'full_time',
    experienceBand: job?.experience_band ?? 'junior_1_3',
    seats: String(job?.seats ?? 1),
    districtId: String(job?.district_id ?? districts[0]?.id ?? ''),
    basicSalaryMin: job?.basic_salary_min != null ? String(job.basic_salary_min) : '',
    basicSalaryMax: job?.basic_salary_max != null ? String(job.basic_salary_max) : '',
    commissionType: job?.commission_type ?? 'percentage',
    commissionValue: job?.commission_value != null ? String(job.commission_value) : '',
    commissionNoteAr: job?.commission_note_ar ?? '',
    leadsSource: job?.leads_source ?? 'company_provided',
    descriptionAr: job?.description_ar ?? '',
    descriptionEn: job?.description_en ?? '',
    requirementsAr: job?.requirements_ar ?? '',
  });

  const set = <K extends keyof Values>(key: K) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((current) => ({ ...current, [key]: event.target.value as Values[K] }));

  function submit(publish: boolean) {
    startTransition(async () => {
      const result = await saveJob({
        id: job?.id,
        titleAr: values.titleAr,
        titleEn: values.titleEn,
        track: values.track,
        employmentType: values.employmentType,
        experienceBand: values.experienceBand,
        seats: values.seats,
        districtId: values.districtId,
        basicSalaryMin: values.basicSalaryMin === '' ? null : values.basicSalaryMin,
        basicSalaryMax: values.basicSalaryMax === '' ? null : values.basicSalaryMax,
        commissionType: values.commissionType,
        commissionValue: values.commissionValue === '' ? null : values.commissionValue,
        commissionNoteAr: values.commissionNoteAr,
        leadsSource: values.leadsSource,
        benefits,
        descriptionAr: values.descriptionAr,
        descriptionEn: values.descriptionEn,
        requirementsAr: values.requirementsAr,
        developerIds,
        submit: publish,
      });

      if (!result.ok) {
        if (result.error === 'post_cap') {
          setErrors({ form: tEmployer('postCapBlocked') });
          setStep(3);
          return;
        }
        setErrors(result.fieldErrors ?? { form: tCommon('errorBody') });
        // Send the reader back to the step that actually holds the problem.
        const keys = Object.keys(result.fieldErrors ?? {});
        if (keys.some((k) => ['titleAr', 'seats', 'districtId'].includes(k))) setStep(0);
        else if (keys.some((k) => k.startsWith('basicSalary') || k.startsWith('commission'))) setStep(1);
        else if (keys.includes('descriptionAr')) setStep(2);
        return;
      }

      router.push('/employer/jobs');
      router.refresh();
    });
  }

  const district = districts.find((d) => String(d.id) === values.districtId);

  return (
    <div>
      <ol className="mb-8 flex flex-wrap gap-2">
        {STEPS.map((name, index) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => setStep(index)}
              aria-current={index === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                index === step
                  ? 'bg-primary text-primary-foreground'
                  : index < step
                    ? 'text-primary'
                    : 'text-muted-foreground',
              )}
            >
              <span className="numeral">{index < step ? <Check className="size-3.5" /> : index + 1}</span>
              {t(name)}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="space-y-5">
          <Field
            label={t('titleAr')}
            htmlFor="titleAr"
            error={errors.titleAr ? tValidation('required') : undefined}
          >
            <Input id="titleAr" value={values.titleAr} onChange={set('titleAr')} maxLength={160} required />
          </Field>

          <Field label={t('titleEn')} hint={t('titleEnHint')} htmlFor="titleEn">
            <Input id="titleEn" dir="ltr" value={values.titleEn} onChange={set('titleEn')} maxLength={160} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('track')} htmlFor="track">
              <Select id="track" value={values.track} onChange={set('track')}>
                {JOB_TRACKS.map((track) => (
                  <option key={track} value={track}>
                    {tTrack(track)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('employmentType')} htmlFor="employmentType">
              <Select id="employmentType" value={values.employmentType} onChange={set('employmentType')}>
                {EMPLOYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tType(type)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('experienceBand')} htmlFor="experienceBand">
              <Select id="experienceBand" value={values.experienceBand} onChange={set('experienceBand')}>
                {EXPERIENCE_BANDS.map((band) => (
                  <option key={band} value={band}>
                    {tExp(band)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('district')} htmlFor="districtId">
              <Select id="districtId" value={values.districtId} onChange={set('districtId')}>
                {districts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {localized(locale, item.name_ar, item.name_en)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label={t('seats')}
            hint={t('seatsHint')}
            htmlFor="seats"
            error={errors.seats ? tValidation('required') : undefined}
          >
            <Input
              id="seats"
              type="number"
              min={1}
              max={999}
              className="numeral w-28"
              value={values.seats}
              onChange={set('seats')}
            />
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('basicSalaryMin')} hint={t('salaryHint')} htmlFor="basicSalaryMin">
              <Input
                id="basicSalaryMin"
                type="number"
                min={0}
                className="numeral"
                value={values.basicSalaryMin}
                onChange={set('basicSalaryMin')}
              />
            </Field>

            <Field
              label={t('basicSalaryMax')}
              htmlFor="basicSalaryMax"
              error={errors.basicSalaryMax ? tValidation('salaryOrder') : undefined}
            >
              <Input
                id="basicSalaryMax"
                type="number"
                min={0}
                className="numeral"
                value={values.basicSalaryMax}
                onChange={set('basicSalaryMax')}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('commissionType')} htmlFor="commissionType">
              <Select id="commissionType" value={values.commissionType} onChange={set('commissionType')}>
                {COMMISSION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === 'percentage' ? tCommission('percentage', { value: '%' }) : tCommission(type)}
                  </option>
                ))}
              </Select>
            </Field>

            {values.commissionType === 'percentage' ? (
              <Field
                label={t('commissionValue')}
                htmlFor="commissionValue"
                error={errors.commissionValue ? tValidation('commissionRequired') : undefined}
              >
                <Input
                  id="commissionValue"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  className="numeral"
                  value={values.commissionValue}
                  onChange={set('commissionValue')}
                />
              </Field>
            ) : null}
          </div>

          <Field label={t('commissionNote')} hint={t('commissionNoteHint')} htmlFor="commissionNoteAr">
            <Textarea
              id="commissionNoteAr"
              rows={3}
              maxLength={500}
              value={values.commissionNoteAr}
              onChange={set('commissionNoteAr')}
            />
          </Field>

          <Field label={t('leadsSource')} hint={t('leadsSourceHint')} htmlFor="leadsSource">
            <Select id="leadsSource" value={values.leadsSource} onChange={set('leadsSource')}>
              {LEADS_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {tLeads(source)}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('benefits')}</legend>
            <div className="flex flex-wrap gap-2">
              {BENEFITS.map((benefit) => {
                const active = benefits.includes(benefit);
                return (
                  <button
                    key={benefit}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setBenefits((current) =>
                        current.includes(benefit)
                          ? current.filter((item) => item !== benefit)
                          : [...current, benefit],
                      )
                    }
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm transition-colors',
                      active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted',
                    )}
                  >
                    {tBenefit(benefit)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-5">
          <Field
            label={t('descriptionAr')}
            htmlFor="descriptionAr"
            error={errors.descriptionAr ? tValidation('required') : undefined}
          >
            <Textarea
              id="descriptionAr"
              rows={8}
              maxLength={8000}
              required
              value={values.descriptionAr}
              onChange={set('descriptionAr')}
            />
          </Field>

          <Field label={t('descriptionEn')} htmlFor="descriptionEn">
            <Textarea
              id="descriptionEn"
              rows={6}
              dir="ltr"
              maxLength={8000}
              value={values.descriptionEn}
              onChange={set('descriptionEn')}
            />
          </Field>

          <Field label={t('requirementsAr')} htmlFor="requirementsAr">
            <Textarea
              id="requirementsAr"
              rows={5}
              maxLength={4000}
              value={values.requirementsAr}
              onChange={set('requirementsAr')}
            />
          </Field>

          <fieldset>
            <legend className="text-sm font-medium">{t('developers')}</legend>
            <p className="mb-2 text-xs text-muted-foreground">{t('developersHint')}</p>
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto rounded-lg border border-border p-3">
              {developers.map((developer) => {
                const active = developerIds.includes(developer.id);
                return (
                  <button
                    key={developer.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setDeveloperIds((current) =>
                        current.includes(developer.id)
                          ? current.filter((id) => id !== developer.id)
                          : [...current, developer.id],
                      )
                    }
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm transition-colors',
                      active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted',
                    )}
                  >
                    {localized(locale, developer.name_ar, developer.name_en)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">{values.titleAr || t('titleAr')}</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="primary">{tLeads(values.leadsSource as 'company_provided')}</Badge>
              <Badge variant="outline">{tTrack(values.track as 'primary')}</Badge>
              <Badge variant="outline">{tType(values.employmentType as 'full_time')}</Badge>
              <Badge variant="outline">{tExp(values.experienceBand as 'junior_1_3')}</Badge>
              {district ? (
                <Badge variant="outline">
                  {localized(locale, district.name_ar, district.name_en)}
                </Badge>
              ) : null}
              <Badge variant="accent" className="numeral">
                {values.seats}
              </Badge>
            </div>

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{tFilters('hasBasicSalary')}</dt>
                <dd className="numeral">
                  {values.basicSalaryMin || values.basicSalaryMax
                    ? `${values.basicSalaryMin || '—'} – ${values.basicSalaryMax || '—'}`
                    : tFilters('hasBasicSalaryNo')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('commissionType')}</dt>
                <dd className="numeral">
                  {values.commissionType === 'percentage'
                    ? tCommission('percentage', { value: values.commissionValue || '0' })
                    : tCommission(values.commissionType)}
                </dd>
              </div>
            </dl>

            {benefits.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {benefits.map((benefit) => (
                  <Badge key={benefit} variant="outline">
                    {tBenefit(benefit)}
                  </Badge>
                ))}
              </div>
            ) : null}

            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {values.descriptionAr}
            </p>
          </div>

          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">{t('reviewNote')}</p>

          {errors.form ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={pending} onClick={() => submit(true)}>
              {tEmployer('submitForReview')}
            </Button>
            <Button variant="outline" size="lg" disabled={pending} onClick={() => submit(false)}>
              {tEmployer('saveDraft')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-8 flex justify-between border-t border-border pt-5">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={step === 0}
        >
          <ArrowLeft className="rtl-flip" />
          {t('back')}
        </Button>

        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep((current) => current + 1)}>
            {t('next')}
            <ArrowRight className="rtl-flip" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
