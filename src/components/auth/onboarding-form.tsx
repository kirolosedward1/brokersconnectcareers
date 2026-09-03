'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Search } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { completeOnboarding } from '@/lib/actions/onboarding';

export function OnboardingForm({
  locale,
  defaultName,
  defaultRole,
  next,
}: {
  locale: Locale;
  defaultName: string;
  /** Pre-selects the account type when the sign-up door already implied one. */
  defaultRole?: 'candidate' | 'employer';
  next?: string;
}) {
  const t = useTranslations('onboarding');
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');

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
      });

      if (!result.ok) {
        setErrors(result.fieldErrors ?? { form: result.error });
        return;
      }

      // Employers need a company before they can do anything useful.
      const destination =
        next ?? (result.data!.role === 'employer' ? '/employer/company' : '/dashboard/applications');
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
