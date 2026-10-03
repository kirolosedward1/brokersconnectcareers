'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import type { DistrictRow } from '@/lib/supabase/database.types';

export function AgentFilters({
  locale,
  districts,
  activeCount,
}: {
  locale: string;
  districts: DistrictRow[];
  activeCount: number;
}) {
  const t = useTranslations('filters');
  const tJobs = useTranslations('jobs');
  const tTrack = useTranslations('track');
  const tAgents = useTranslations('agents');
  const tAvailability = useTranslations('availability');

  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const urlKeyword = searchParams.get('q') ?? '';
  const [keyword, setKeyword] = useState(urlKeyword);
  // Follows the URL after Back, like the board's search box.
  useEffect(() => setKeyword(urlKeyword), [urlKeyword]);

  // Pushed, so Back undoes one filter rather than leaving the directory.
  function push(next: URLSearchParams) {
    next.delete('page');
    const query = next.toString();
    startTransition(() => router.push(query ? `/agents?${query}` : '/agents', { scroll: false }));
  }

  function toggle(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    const current = next.getAll(key);
    next.delete(key);
    for (const existing of current) if (existing !== value) next.append(key, existing);
    if (!current.includes(value)) next.append(key, value);
    push(next);
  }

  function setSingle(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    push(next);
  }

  const isOn = (key: string, value: string) => searchParams.getAll(key).includes(value);

  return (
    <div className={cn('space-y-6', pending && 'opacity-70')}>
      {/* Searches the headline, and the name only on cards that show one —
          see search_agents() in migration 68. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSingle('q', keyword.trim());
        }}
        className="flex gap-2"
      >
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
            placeholder={tAgents('searchPlaceholder')}
            aria-label={t('search')}
            className="ps-9"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('showResults')}
        </Button>
      </form>

      {activeCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            setKeyword('');
            startTransition(() => router.push('/agents', { scroll: false }));
          }}
        >
          <X aria-hidden />
          {tJobs('clearFilters')}
        </Button>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{tAgents('availability')}</legend>
        {/* The legend names the group, not the control inside it, so a screen
            reader reaches this select and announces "combo box" with nothing
            else. Labelled explicitly with the same words the legend shows. */}
        <Select
          aria-label={tAgents('availability')}
          value={searchParams.get('availability') ?? ''}
          onChange={(event) => setSingle('availability', event.target.value)}
        >
          <option value="">{t('any')}</option>
          {AVAILABILITIES.map((value) => (
            <option key={value} value={value}>
              {tAvailability(value)}
            </option>
          ))}
        </Select>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('experienceBand')}</legend>
        {/* A floor, and labelled as one. The options were the board's bands —
            "1–3 years", "3–5 years" — and search_agents() filters on
            `years_experience >= n`, so "1–3 years" returned a twenty-year
            veteran. The label now says what the filter does. */}
        <Select
          aria-label={t('experienceBand')}
          value={searchParams.get('years') ?? ''}
          onChange={(event) => setSingle('years', event.target.value)}
        >
          <option value="">{t('any')}</option>
          {[1, 3, 5, 10].map((years) => (
            <option key={years} value={String(years)}>
              {t('minYears', { count: years })}
            </option>
          ))}
        </Select>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('track')}</legend>
        <div className="space-y-1">
          {JOB_TRACKS.map((track) => (
            <label
              key={track}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={isOn('track', track)}
                onChange={() => toggle('track', track)}
                className="size-4 accent-[var(--primary)]"
              />
              {tTrack(track)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('district')}</legend>
        <div className="max-h-72 space-y-1 overflow-y-auto pe-1">
          {districts.map((district) => (
            <label
              key={district.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={isOn('district', district.slug)}
                onChange={() => toggle('district', district.slug)}
                className="size-4 accent-[var(--primary)]"
              />
              {localized(locale, district.name_ar, district.name_en)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
