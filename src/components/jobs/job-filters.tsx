'use client';

import { useMemo, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_BANDS,
  JOB_TRACKS,
  LEADS_SOURCES,
} from '@/lib/taxonomy';
import type { DistrictRow, GovernorateRow } from '@/lib/supabase/database.types';

type Props = {
  locale: string;
  districts: DistrictRow[];
  governorates: GovernorateRow[];
  activeCount: number;
};

/**
 * Filters are the product, so they are the URL. Every toggle rewrites the query
 * string and lets the server re-render the list — no client-side result cache
 * to drift out of sync, and every filtered view is a shareable link.
 */
export function JobFilters({ locale, districts, governorates, activeCount }: Props) {
  const t = useTranslations('filters');
  const tJobs = useTranslations('jobs');
  const tTrack = useTranslations('track');
  const tLeads = useTranslations('leadsSource');
  const tExp = useTranslations('experienceBand');
  const tType = useTranslations('employmentType');

  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [keyword, setKeyword] = useState(searchParams.get('q') ?? '');

  const districtsByGovernorate = useMemo(() => {
    const groups = new Map<number, DistrictRow[]>();
    for (const district of districts) {
      const list = groups.get(district.governorate_id) ?? [];
      list.push(district);
      groups.set(district.governorate_id, list);
    }
    return groups;
  }, [districts]);

  function push(next: URLSearchParams) {
    // Any filter change resets to page 1 — page 4 of the old result set is
    // meaningless against a new one.
    next.delete('page');
    startTransition(() => {
      router.replace(`/jobs?${next.toString()}`, { scroll: false });
    });
  }

  function toggle(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    const current = next.getAll(key);
    next.delete(key);
    for (const existing of current) {
      if (existing !== value) next.append(key, existing);
    }
    if (!current.includes(value)) next.append(key, value);
    push(next);
  }

  function setSingle(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    push(next);
  }

  function submitKeyword(event: React.FormEvent) {
    event.preventDefault();
    setSingle('q', keyword.trim() || null);
  }

  function clearAll() {
    setKeyword('');
    startTransition(() => router.replace('/jobs', { scroll: false }));
  }

  const isOn = (key: string, value: string) => searchParams.getAll(key).includes(value);
  const salary = searchParams.get('salary');

  return (
    <div className={cn('space-y-6', pending && 'opacity-70')}>
      <form onSubmit={submitKeyword} className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className="ps-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          {t('showResults')}
        </Button>
      </form>

      {activeCount > 0 ? (
        <Button variant="ghost" size="sm" onClick={clearAll} className="w-full justify-start">
          <X />
          {tJobs('clearFilters')}
          <span className="numeral ms-auto rounded bg-muted px-1.5">{activeCount}</span>
        </Button>
      ) : null}

      <FilterGroup title={t('leadsSource')} hint={t('leadsSource')}>
        {LEADS_SOURCES.map((value) => (
          <Choice
            key={value}
            type="checkbox"
            checked={isOn('leads', value)}
            onChange={() => toggle('leads', value)}
            label={tLeads(value)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('hasBasicSalary')}>
        <Choice
          type="radio"
          name="salary"
          checked={salary === null}
          onChange={() => setSingle('salary', null)}
          label={t('any')}
        />
        <Choice
          type="radio"
          name="salary"
          checked={salary === 'yes'}
          onChange={() => setSingle('salary', 'yes')}
          label={t('hasBasicSalaryYes')}
        />
        <Choice
          type="radio"
          name="salary"
          checked={salary === 'no'}
          onChange={() => setSingle('salary', 'no')}
          label={t('hasBasicSalaryNo')}
        />
      </FilterGroup>

      <FilterGroup title={t('track')}>
        {JOB_TRACKS.map((value) => (
          <Choice
            key={value}
            type="checkbox"
            checked={isOn('track', value)}
            onChange={() => toggle('track', value)}
            label={tTrack(value)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('experienceBand')}>
        {EXPERIENCE_BANDS.map((value) => (
          <Choice
            key={value}
            type="checkbox"
            checked={isOn('exp', value)}
            onChange={() => toggle('exp', value)}
            label={tExp(value)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('employmentType')}>
        {EMPLOYMENT_TYPES.map((value) => (
          <Choice
            key={value}
            type="checkbox"
            checked={isOn('type', value)}
            onChange={() => toggle('type', value)}
            label={tType(value)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('district')} scroll>
        {governorates.map((governorate) => {
          const group = districtsByGovernorate.get(governorate.id) ?? [];
          if (!group.length) return null;
          return (
            <div key={governorate.id} className="mb-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {localized(locale, governorate.name_ar, governorate.name_en)}
              </p>
              {group.map((district) => (
                <Choice
                  key={district.id}
                  type="checkbox"
                  checked={isOn('district', district.slug)}
                  onChange={() => toggle('district', district.slug)}
                  label={localized(locale, district.name_ar, district.name_en)}
                />
              ))}
            </div>
          );
        })}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  title,
  children,
  scroll,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      <div className={cn('space-y-1', scroll && 'max-h-72 overflow-y-auto pe-1')}>{children}</div>
    </fieldset>
  );
}

function Choice({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
      <input
        {...props}
        className="size-4 shrink-0 accent-[var(--primary)]"
      />
      <span>{label}</span>
    </label>
  );
}

/** Mobile disclosure wrapper — the same filters, behind a button. */
export function MobileFilters({ children, count }: { children: React.ReactNode; count: number }) {
  const t = useTranslations('jobs');

  return (
    <details className="group rounded-xl border border-border bg-card lg:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium">
        <SlidersHorizontal className="size-4" aria-hidden />
        {t('filters')}
        {count > 0 ? (
          <span className="numeral rounded bg-primary px-1.5 text-xs text-primary-foreground">
            {count}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
