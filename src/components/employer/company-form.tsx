'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { localized } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { HEADCOUNT_BANDS } from '@/lib/taxonomy';
import { saveCompany } from '@/lib/actions/company';
import type { CompanyRow, DistrictRow } from '@/lib/supabase/database.types';

export function CompanyForm({
  locale,
  company,
  districts,
}: {
  locale: string;
  company: CompanyRow | null;
  districts: DistrictRow[];
}) {
  const t = useTranslations('employer');
  const tCompanies = useTranslations('companies');
  const tFilters = useTranslations('filters');
  const tCommon = useTranslations('common');

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);

    startTransition(async () => {
      const result = await saveCompany({
        nameAr: String(form.get('nameAr') ?? ''),
        nameEn: String(form.get('nameEn') ?? ''),
        aboutAr: String(form.get('aboutAr') ?? ''),
        aboutEn: String(form.get('aboutEn') ?? ''),
        website: String(form.get('website') ?? ''),
        headcountBand: String(form.get('headcountBand') ?? '') || null,
        districtId: String(form.get('districtId') ?? '') || null,
      });

      if (!result.ok) {
        setError(tCommon('errorBody'));
        return;
      }

      setError(null);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="اسم الشركة (عربي)" htmlFor="nameAr">
        <Input id="nameAr" name="nameAr" required maxLength={160} defaultValue={company?.name_ar ?? ''} />
      </Field>

      <Field label="Company name (English)" htmlFor="nameEn">
        <Input
          id="nameEn"
          name="nameEn"
          dir="ltr"
          maxLength={160}
          defaultValue={company?.name_en ?? ''}
        />
      </Field>

      <Field label="نبذة عن الشركة" htmlFor="aboutAr">
        <Textarea id="aboutAr" name="aboutAr" rows={4} maxLength={2000} defaultValue={company?.about_ar ?? ''} />
      </Field>

      <Field label="About (English)" htmlFor="aboutEn">
        <Textarea
          id="aboutEn"
          name="aboutEn"
          rows={4}
          dir="ltr"
          maxLength={2000}
          defaultValue={company?.about_en ?? ''}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tCompanies('website')} htmlFor="website">
          <Input
            id="website"
            name="website"
            type="url"
            dir="ltr"
            placeholder="https://"
            defaultValue={company?.website ?? ''}
          />
        </Field>

        <Field label={tCompanies('headcount')} htmlFor="headcountBand">
          <Select id="headcountBand" name="headcountBand" defaultValue={company?.headcount_band ?? ''}>
            <option value="">{tFilters('any')}</option>
            {HEADCOUNT_BANDS.map((band) => (
              <option key={band} value={band}>
                {tCompanies(`headcountBand.${band}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={tFilters('district')} htmlFor="districtId">
        <Select id="districtId" name="districtId" defaultValue={company?.district_id ?? ''}>
          <option value="">{tFilters('any')}</option>
          {districts.map((district) => (
            <option key={district.id} value={district.id}>
              {localized(locale, district.name_ar, district.name_en)}
            </option>
          ))}
        </Select>
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? tCommon('loading') : company ? tCommon('save') : t('createCompanyFirst')}
        </Button>
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
