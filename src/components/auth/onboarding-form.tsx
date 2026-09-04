'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Search } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { localized } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { HEADCOUNT_BANDS } from '@/lib/taxonomy';
import { completeOnboarding } from '@/lib/actions/onboarding';
import type { DistrictRow } from '@/lib/supabase/database.types';

export function OnboardingForm({
  locale,
  defaultName,
  defaultRole,
  districts,
  next,
}: {
  locale: Locale;
  defaultName: string;
  /** Pre-selects the account type when the sign-up door already implied one. */
  defaultRole?: 'candidate' | 'employer';
  /** For the company block, which only appears for an employer. */
  districts: DistrictRow[];
  next?: string;
}) {
  const t = useTranslations('onboarding');
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');
  const tHeadcount = useTranslations('companies.headcountBand');

  const router = useRouter();
  const [role, setRole] = useState<'candidate' | 'employer'>(defaultRole ?? 'candidate');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await completeOnboarding({
        role,
        fullName: String(form.get('fullName') ?? ''),
        whatsapp: String(form.get('whatsapp') ?? ''),
        locale: String(form.get('locale') ?? locale),
        company:
          role === 'employer'
            ? {
                nameAr: String(form.get('companyName') ?? ''),
                website: String(form.get('companyWebsite') ?? '') || null,
                headcountBand: String(form.get('companyHeadcount') ?? '') || null,
                districtId: String(form.get('companyDistrict') ?? '') || null,
              }
            : undefined,
      });

      if (!result.ok) {
        setErrors(result.fieldErrors ?? { form: result.error });
        return;
      }

      // The company now exists by the time we get here, so an employer lands
      // on their overview — where the "under review" banner is — rather than on
      // a company form asking again for what they just typed.
      const destination =
        next ?? (result.data!.role === 'employer' ? '/employer' : '/dashboard/applications');
      router.replace(destination, { locale });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-sm font-medium">{t('roleQuestion')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <RoleCard
            selected={role === 'candidate'}
            onSelect={() => setRole('candidate')}
            icon={<Search className="size-5" aria-hidden />}
            title={t('roleCandidate')}
            hint={t('roleCandidateHint')}
          />
          <RoleCard
            selected={role === 'employer'}
            onSelect={() => setRole('employer')}
            icon={<Briefcase className="size-5" aria-hidden />}
            title={t('roleEmployer')}
            hint={t('roleEmployerHint')}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('roleLocked')}</p>
      </fieldset>

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
        hint={t('whatsappHint')}
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
          placeholder={t('whatsappPlaceholder')}
          className="numeral"
        />
      </Field>

      {/* Only for a company, and only the fields a reviewer needs. The account
          is held for review, and a row carrying an email and nothing else
          gives whoever opens the queue nothing to decide on. */}
      {role === 'employer' ? (
        <fieldset className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
          <legend className="px-1 text-sm font-medium">{t('companySection')}</legend>

          <Field
            label={t('companyName')}
            htmlFor="companyName"
            error={errors.company ? tValidation('required') : undefined}
          >
            <Input id="companyName" name="companyName" required maxLength={160} />
          </Field>

          <Field label={t('companyWebsite')} hint={tCommon('optional')} htmlFor="companyWebsite">
            <Input
              id="companyWebsite"
              name="companyWebsite"
              type="url"
              dir="ltr"
              inputMode="url"
              placeholder="https://"
              maxLength={200}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('companyDistrict')} htmlFor="companyDistrict">
              <Select id="companyDistrict" name="companyDistrict" defaultValue="">
                <option value="">{tCommon('optional')}</option>
                {districts.map((district) => (
                  <option key={district.id} value={district.id}>
                    {localized(locale, district.name_ar, district.name_en)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('companyHeadcount')} htmlFor="companyHeadcount">
              <Select id="companyHeadcount" name="companyHeadcount" defaultValue="">
                <option value="">{tCommon('optional')}</option>
                {HEADCOUNT_BANDS.map((band) => (
                  <option key={band} value={band}>
                    {tHeadcount(band)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <p className="text-xs text-muted-foreground">{t('companyReviewNote')}</p>
        </fieldset>
      ) : null}

      <Field label={t('locale')} htmlFor="locale">
        <Select id="locale" name="locale" defaultValue={locale}>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </Select>
      </Field>

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {tCommon('errorBody')}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? tCommon('loading') : t('submit')}
      </Button>
    </form>
  );
}

function RoleCard({
  selected,
  onSelect,
  icon,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'rounded-xl border p-4 text-start transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
      )}
    >
      <span className={cn('inline-flex', selected ? 'text-primary' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span className="mt-2 block font-medium">{title}</span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
    </button>
  );
}
