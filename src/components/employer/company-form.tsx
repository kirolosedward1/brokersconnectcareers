'use client';

import { useCallback, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { localized } from '@/i18n/routing';
import { SubmitButton } from '@/components/ui/submit-button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { COMPANY_TYPES, HEADCOUNT_BANDS } from '@/lib/taxonomy';
import { saveCompany } from '@/lib/actions/company';
import { reach } from '@/lib/reach';
import { webAddress } from '@/lib/web-address';
import type { CompanyRow, DistrictRow } from '@/lib/supabase/database.types';
import { useSessionRecovery } from '@/lib/session-expired';
import { draftKey } from '@/lib/form-draft';
import { useFormDraft } from '@/lib/use-form-draft';
import { DraftNotice } from '@/components/ui/draft-notice';

type Values = {
  nameAr: string;
  nameEn: string;
  aboutAr: string;
  aboutEn: string;
  website: string;
  companyType: string;
  headcountBand: string;
  districtId: string;
};

const valuesOf = (company: CompanyRow | null): Values => ({
  nameAr: company?.name_ar ?? '',
  nameEn: company?.name_en ?? '',
  aboutAr: company?.about_ar ?? '',
  aboutEn: company?.about_en ?? '',
  website: company?.website ?? '',
  companyType: company?.company_type ?? '',
  headcountBand: company?.headcount_band ?? '',
  districtId: company?.district_id == null ? '' : String(company.district_id),
});

export function CompanyForm({
  locale,
  ownerId,
  company,
  districts,
}: {
  locale: string;
  /** Whose draft this is (lib/form-draft.ts). */
  ownerId: string;
  company: CompanyRow | null;
  districts: DistrictRow[];
}) {
  const t = useTranslations('employer');
  const tCompanies = useTranslations('companies');
  const tCompanyType = useTranslations('companyType');
  const tFilters = useTranslations('filters');
  const tCommon = useTranslations('common');

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  // Controlled, so what is typed can be kept as a draft (lib/use-form-draft.ts):
  // a profile written in two languages is a long form to lose to a closed tab
  // or a session that ran out.
  const [values, setValues] = useState<Values>(() => valuesOf(company));

  // The version these fields were filled from. A refresh brings the newest
  // row (a logo uploaded, a paper sent, a colleague's save) but leaves the
  // fields as they are, so the newest version is not what is on screen: it is
  // taken over after this form's own save, or when it changed none of the
  // profile's own columns. A colleague's change to them leaves the form on
  // the older one, and saving is refused rather than written over theirs.
  const [opened, setOpened] = useState(() => ({ version: company?.version ?? null, values: valuesOf(company) }));
  const [ownSave, setOwnSave] = useState(false);
  if (company && company.version !== opened.version) {
    const next = valuesOf(company);
    if (ownSave || JSON.stringify(next) === JSON.stringify(opened.values)) {
      setOpened({ version: company.version, values: next });
      setOwnSave(false);
    }
  }

  const restoreDraft = useCallback((kept: Values) => setValues({ ...valuesOf(null), ...kept }), []);
  const draft = useFormDraft({
    key: draftKey('company', ownerId, company?.id ?? null),
    values,
    restore: restoreDraft,
    base: opened.version,
  });
  const set = (key: keyof Values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setSaved(false);
      setValues((current) => ({ ...current, [key]: event.target.value }));
    };

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    // Written now, not after the pause: the answer may be a sign-in page.
    draft.flush();

    startTransition(async () => {
      const result = await reach(saveCompany({
        nameAr: values.nameAr,
        nameEn: values.nameEn,
        aboutAr: values.aboutAr,
        aboutEn: values.aboutEn,
        // A bare domain is given its scheme, as the app gives it (lib/web-address.ts).
        website: webAddress(values.website) ?? '',
        headcountBand: values.headcountBand || null,
        companyType: values.companyType || null,
        districtId: values.districtId || null,
        // What this form was built from. A second admin saving in between is
        // refused rather than overwritten.
        version: company ? (opened.version ?? undefined) : undefined,
      }));

      if (recoverSession(result)) return;
      if (!result.ok) {
        // Somebody else saved the company profile while this form was open.
        // Their work is on the server and this form's is on the screen;
        // everything typed here stays put, and is kept as a draft that the
        // reloaded form offers over their version (use-form-draft.ts).
        setError(result.error === 'stale' ? t('companyMovedKept') : tCommon('errorBody'));
        return;
      }

      // Saved: the server holds it now, so this browser need not; and the
      // version the refresh brings is this save's.
      draft.clear();
      setOwnSave(true);
      setError(null);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <DraftNotice draft={draft} />
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
      <Field label={tCompanies('nameAr')} htmlFor="nameAr">
        <Input id="nameAr" name="nameAr" required maxLength={160} value={values.nameAr} onChange={set('nameAr')} />
      </Field>

      <Field label={tCompanies('nameEn')} htmlFor="nameEn">
        <Input
          id="nameEn"
          name="nameEn"
          dir="ltr"
          maxLength={160}
          value={values.nameEn}
          onChange={set('nameEn')}
        />
      </Field>
      </div>

      {/* The two languages of the same paragraph, beside each other from `lg`
          so one can be written against the other. */}
      <div className="grid gap-x-5 gap-y-4 lg:grid-cols-2">
      <Field label={tCompanies('aboutAr')} htmlFor="aboutAr">
        <Textarea id="aboutAr" name="aboutAr" rows={4} maxLength={2000} value={values.aboutAr} onChange={set('aboutAr')} />
      </Field>

      <Field label={tCompanies('aboutEn')} htmlFor="aboutEn">
        <Textarea
          id="aboutEn"
          name="aboutEn"
          rows={4}
          dir="ltr"
          maxLength={2000}
          value={values.aboutEn}
          onChange={set('aboutEn')}
        />
      </Field>
      </div>

      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field label={tCompanies('website')} htmlFor="website">
          <Input
            id="website"
            name="website"
            type="url"
            dir="ltr"
            placeholder="https://"
            value={values.website}
            onChange={set('website')}
          />
        </Field>

        <Field
          label={tCompanies('companyType')}
          hint={tCompanies('companyTypeHint')}
          htmlFor="companyType"
        >
          <Select id="companyType" name="companyType" value={values.companyType} onChange={set('companyType')}>
            <option value="">{tCompanies('companyTypeUnset')}</option>
            {COMPANY_TYPES.map((type) => (
              <option key={type} value={type}>
                {tCompanyType(type)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={tCompanies('headcount')} htmlFor="headcountBand">
          <Select id="headcountBand" name="headcountBand" value={values.headcountBand} onChange={set('headcountBand')}>
            <option value="">{tFilters('any')}</option>
            {HEADCOUNT_BANDS.map((band) => (
              <option key={band} value={band}>
                {tCompanies(`headcountBand.${band}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tFilters('district')} htmlFor="districtId">
          <Select id="districtId" name="districtId" value={values.districtId} onChange={set('districtId')}>
            <option value="">{tFilters('any')}</option>
            {districts.map((district) => (
              <option key={district.id} value={district.id}>
                {localized(locale, district.name_ar, district.name_en)}
              </option>
            ))}
          </Select>
        </Field>
      </div>


      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton size="lg" disabled={pending}>
          {pending ? tCommon('loading') : company ? tCommon('save') : t('createCompanyFirst')}
        </SubmitButton>
        {saved ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            {tCommon('saveSuccess')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
