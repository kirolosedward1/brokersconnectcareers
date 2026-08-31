'use client';

import { useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
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
  const tExp = useTranslations('experienceBand');

  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function push(next: URLSearchParams) {
    next.delete('page');
    const query = next.toString();
    startTransition(() => router.replace(query ? `/agents?${query}` : '/agents', { scroll: false }));
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
      {activeCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => startTransition(() => router.replace('/agents', { scroll: false }))}
        >
          <X />
          {tJobs('clearFilters')}
        </Button>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{tAgents('availability')}</legend>
        <Select
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
        <Select
          value={searchParams.get('years') ?? ''}
          onChange={(event) => setSingle('years', event.target.value)}
        >
          <option value="">{t('any')}</option>
          <option value="1">{tExp('junior_1_3')}</option>
          <option value="3">{tExp('mid_3_5')}</option>
          <option value="5">{tExp('senior_5_plus')}</option>
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
