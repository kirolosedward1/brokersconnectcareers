'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Search } from 'lucide-react';

import type { Locale } from '@/i18n/routing';
import { SubmitButton } from '@/components/ui/submit-button';
import { Field, Input, Select } from '@/components/ui/field';
import { localeHref, localized } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { safeNext } from '@/lib/safe-next';
import { cn } from '@/lib/utils';
import { HEADCOUNT_BANDS } from '@/lib/taxonomy';
import { completeOnboarding } from '@/lib/actions/onboarding';
import { reach } from '@/lib/reach';
import type { DistrictRow } from '@/lib/supabase/database.types';
import { useSessionRecovery } from '@/lib/session-expired';

/** Who may see a candidate's directory card, from most open to closed; nothing is chosen in advance. */
const VISIBILITIES = [
  ['public', 'publicHint'],
  ['verified_employers_only', 'verifiedHint'],
  ['hidden', 'hiddenHint'],
] as const;

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
  const tVisibility = useTranslations('visibility');
  const [role, setRole] = useState<'candidate' | 'employer'>(defaultRole ?? 'candidate');
  /*
    Somebody who came through the "شركة عقارات" door has answered this
    already; asking again reads as the site not having listened. So when a
    role arrived, the two cards give way to one line saying which. No control
    to change it: the door is the decision, and the line is a receipt.
  */
  const roleSettled = Boolean(defaultRole);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await reach(completeOnboarding({
        role,
        fullName: String(form.get('fullName') ?? ''),
        whatsapp: String(form.get('whatsapp') ?? ''),
        locale: String(form.get('locale') ?? locale),
        // Checked or not, as it was: the server refuses anything but a yes.
        agreed: form.get('agreed') === 'on',
        visibility: role === 'candidate' ? String(form.get('visibility') ?? '') || undefined : undefined,
        company:
          role === 'employer'
            ? {
                nameAr: String(form.get('companyName') ?? ''),
                website: String(form.get('companyWebsite') ?? '') || null,
                headcountBand: String(form.get('companyHeadcount') ?? '') || null,
                districtId: String(form.get('companyDistrict') ?? '') || null,
              }
            : undefined,
      }));

      if (recoverSession(result)) return;
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { form: result.error });
        return;
      }

      // The company now exists by the time we get here, so an employer lands
      // on their overview — where the "under review" banner is — rather than on
      // a company form asking again for what they just typed.
      /*
        Checked again here, where the navigation actually happens.

        `next` arrives as a prop, and the page that passes it does validate —
        but this line hands a string to the browser, and a component that does
        that should not depend on somebody else having checked it first. The
        earlier version of this guard was `startsWith('/')`, which lets
        `//evil.example` through: a protocol-relative URL, and an open redirect
        the moment the last hop stopped going through next-intl's router.
      */
      // The same answer homeFor gives on the server: the console for the role
      // the database recorded, not the one the form asked for.
      const destination =
        safeNext(next) ?? (result.data!.role === 'employer' ? '/employer' : '/dashboard');
      /*
        The profile did not exist a moment ago and now does, which changes
        what every server component on the other side renders. Fetched
        fresh rather than pushed through a client router that would have to
        be told, separately, that everything it holds is stale.
      */
      window.location.assign(localeHref(locale, destination));
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {roleSettled ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <span className="inline-flex items-center gap-2 font-medium">
            {role === 'employer' ? (
              <Briefcase className="size-4 text-primary" aria-hidden />
            ) : (
              <Search className="size-4 text-primary" aria-hidden />
            )}
            {role === 'employer' ? t('roleKnownEmployer') : t('roleKnownCandidate')}
          </span>
        </div>
      ) : (
      <fieldset>
        <legend className="mb-3 text-sm font-medium">{t('roleQuestion')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <RoleCard
            value="candidate"
            selected={role === 'candidate'}
            onSelect={() => setRole('candidate')}
            icon={<Search className="size-5" aria-hidden />}
            title={t('roleCandidate')}
            hint={t('roleCandidateHint')}
          />
          <RoleCard
            value="employer"
            selected={role === 'employer'}
            onSelect={() => setRole('employer')}
            icon={<Briefcase className="size-5" aria-hidden />}
            title={t('roleEmployer')}
            hint={t('roleEmployerHint')}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('roleLocked')}</p>
      </fieldset>
      )}

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
          placeholder={t('whatsappPlaceholder')}
          className="numeral-field"
        />
      </Field>

      {/* Who sees a consultant's card in the directory: asked here, with no
          answer chosen for them, because listing somebody is not a default
          (migration 336). Changeable any time from their profile. */}
      {role === 'candidate' ? (
        <fieldset className="space-y-2" aria-describedby="visibility-hint">
          <legend className="text-sm font-medium">{t('visibilityQuestion')}</legend>
          <p id="visibility-hint" className="text-xs leading-relaxed text-muted-foreground">
            {t('visibilityHint')}
          </p>
          {VISIBILITIES.map(([value, hint]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-input p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="visibility"
                value={value}
                required
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">{tVisibility(value)}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {tVisibility(hint)}
                </span>
              </span>
            </label>
          ))}
          {errors.visibility ? (
            <p role="alert" className="text-sm text-destructive">
              {t('visibilityRequired')}
            </p>
          ) : null}
        </fieldset>
      ) : null}

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

          <Field
            label={t('companyWebsite')}
            hint={tCommon('optional')}
            htmlFor="companyWebsite"
            error={errors.companyWebsite ? tValidation('invalidUrl') : undefined}
          >
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
        {/*
          Each option in its own language, not translated. This picks the
          language of the site, and somebody who cannot read the current one
          has to be able to find their way out of it — which is why every
          language switcher on the web works this way. The `language`
          namespace is for naming a language *to* a reader, which is a
          different job: it labels the languages a consultant speaks.
        */}
        <Select id="locale" name="locale" defaultValue={locale}>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </Select>
      </Field>

      {/* Agreement, and age, before anything is created — recorded with the
          versions agreed to (policy_acceptances). Unticked until ticked. */}
      <div>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="agreed"
            required
            aria-describedby={errors.agreed ? 'agreed-error' : undefined}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span>
            {t.rich('consent', {
              terms: (chunks) => (
                <Link href="/terms" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link href="/privacy" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {errors.agreed ? (
          <p id="agreed-error" role="alert" className="mt-1 text-sm text-destructive">
            {t('consentRequired')}
          </p>
        ) : null}
      </div>

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {tCommon('errorBody')}
        </p>
      ) : null}

      <SubmitButton size="lg" className="w-full" disabled={pending}>
        {pending ? tCommon('loading') : t('submit')}
      </SubmitButton>
    </form>
  );
}

/**
 * One of two answers to "what brings you here", drawn as a card.
 *
 * A radio, not a toggle button: it is one choice of two, and a screen reader
 * should say "1 of 2, selected" and move between them with the arrow keys,
 * where two pressed-or-not buttons said neither that they belong together nor
 * that choosing one unchooses the other. The input is hidden; the card is its
 * label, and draws the focus the input would — as an outline, which Windows'
 * high-contrast mode keeps, where a ring is a shadow it drops — and, in that
 * mode, the chosen card's border in the system's highlight colour, since the
 * brand's colours are not shown there. Named by its title alone: the hint,
 * inside the label too, is its description, not a second reading of its name.
 */
function RoleCard({
  value,
  selected,
  onSelect,
  icon,
  title,
  hint,
}: {
  value: 'candidate' | 'employer';
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  const titleId = useId();
  const hintId = useId();
  return (
    <label
      className={cn(
        'cursor-pointer rounded-xl border p-4 text-start transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
        selected
          ? 'border-primary bg-primary/5 forced-colors:border-2 forced-colors:border-[Highlight]'
          : 'border-border hover:bg-muted',
      )}
    >
      <input
        type="radio"
        name="role"
        value={value}
        checked={selected}
        onChange={onSelect}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="sr-only"
      />
      <span className={cn('inline-flex', selected ? 'text-primary' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span id={titleId} className="mt-2 block font-medium">
        {title}
      </span>
      <span id={hintId} className="mt-1 block text-xs leading-relaxed text-muted-foreground">
        {hint}
      </span>
    </label>
  );
}
