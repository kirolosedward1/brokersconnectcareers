'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input, Select } from '@/components/ui/field';
import { saveTaxonomy } from '@/lib/actions/admin';
import { isAdminErrorCode } from '@/lib/admin/errors';
import type { TaxonomyKind } from '@/lib/supabase/database.types';

type Governorate = { id: number; label: string };

function useSave() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(input: Parameters<typeof saveTaxonomy>[0], onDone?: () => void) {
    startTransition(async () => {
      setError(null);
      setSaved(false);
      try {
        const result = await saveTaxonomy(input);
        if (!result.ok) {
          setError(isAdminErrorCode(result.error) ? t(`errors.${result.error}`) : t('errors.unknown'));
          return;
        }
        setSaved(true);
        onDone?.();
        router.refresh();
      } catch {
        setError(t('errors.network'));
      }
    });
  }

  return { run, error, saved, pending };
}

/**
 * Renaming, in place. The slug is shown and not editable: it is part of public
 * URLs (the <track>-<district> landing pages), so a rename changes what people
 * read and never where links point. The database refuses a slug change by any
 * path, this form only declines to offer one.
 */
export function TaxonomyRow({
  kind,
  id,
  nameAr,
  nameEn,
  slug,
  governorateId,
  governorates,
}: {
  kind: TaxonomyKind;
  id: number;
  nameAr: string;
  nameEn: string;
  slug: string;
  governorateId?: number;
  governorates?: Governorate[];
}) {
  const t = useTranslations('admin');
  const { run, error, saved, pending } = useSave();
  const [ar, setAr] = useState(nameAr);
  const [en, setEn] = useState(nameEn);
  const [gov, setGov] = useState(governorateId);
  const dirty = ar !== nameAr || en !== nameEn || gov !== governorateId;

  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || pending) return;
        run({ kind, id, nameAr: ar, nameEn: en, governorateId: gov ?? null });
      }}
    >
      <Input size="sm" value={ar} onChange={(e) => setAr(e.target.value)} maxLength={80} aria-label={t('nameAr')} required />
      <Input size="sm" value={en} onChange={(e) => setEn(e.target.value)} maxLength={80} aria-label={t('nameEn')} dir="ltr" required />
      <div className="flex items-center gap-2">
        {governorates ? (
          <Select size="sm" value={gov} onChange={(e) => setGov(Number(e.target.value))} aria-label={t('governorate')} className="w-36">
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        ) : null}
        <SubmitButton size="sm" variant="outline" disabled={!dirty || pending}>
          {pending ? '…' : t('rename')}
        </SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-3">
        <code dir="ltr">{slug}</code>
        {saved ? <span role="status" className="ms-2 text-success">{t('done')}</span> : null}
        {error ? <span role="alert" className="ms-2 text-destructive">{error}</span> : null}
      </p>
    </form>
  );
}

export function TaxonomyAdd({ kind, governorates }: { kind: TaxonomyKind; governorates?: Governorate[] }) {
  const t = useTranslations('admin');
  const { run, error, saved, pending } = useSave();
  const [ar, setAr] = useState('');
  const [en, setEn] = useState('');
  const [slug, setSlug] = useState('');
  const [gov, setGov] = useState<number | undefined>(governorates?.[0]?.id);

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        run({ kind, id: null, nameAr: ar, nameEn: en, slug, governorateId: gov ?? null }, () => {
          setAr('');
          setEn('');
          setSlug('');
        });
      }}
    >
      {/* Named as the rename row's fields are: a placeholder is not a label,
          and it is gone the moment somebody starts typing. */}
      <div className="grid gap-2 sm:grid-cols-4">
        <Input value={ar} onChange={(e) => setAr(e.target.value)} placeholder={t('nameAr')} aria-label={t('nameAr')} maxLength={80} required />
        <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder={t('nameEn')} aria-label={t('nameEn')} maxLength={80} dir="ltr" required />
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder={t('slugPlaceholder')}
          aria-label={t('colSlug')}
          maxLength={60}
          dir="ltr"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
        />
        {governorates ? (
          <Select value={gov} onChange={(e) => setGov(Number(e.target.value))} aria-label={t('governorate')}>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" disabled={pending}>
          {pending ? '…' : t('addEntry')}
        </SubmitButton>
        <p className="text-xs text-muted-foreground">{t('slugPermanent')}</p>
        {saved ? <span role="status" className="text-xs text-success">{t('done')}</span> : null}
        {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
      </div>
    </form>
  );
}
