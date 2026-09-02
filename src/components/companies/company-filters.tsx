'use client';

import { useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DistrictRow } from '@/lib/supabase/database.types';

/**
 * Company directory filters.
 *
 * Three controls, in one row, because there are only three things worth
 * narrowing an employer list by: the name, where they are, and whether anyone
 * has checked they exist. The jobs page needs a whole sidebar; this does not,
 * and giving it one would imply the directory is deeper than it is.
 *
 * The search half is a real GET form, so it works before any JavaScript loads
 * and a submitted search is a shareable URL. The district and verified
 * controls navigate on change, which needs the client.
 */
export function CompanyFilters({
  locale,
  districts,
  action,
}: {
  locale: string;
  districts: DistrictRow[];
  /** Locale-correct form target, so the no-JS path posts to the right URL. */
  action: string;
}) {
  const t = useTranslations('filters');
  const tCommon = useTranslations('common');

  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const q = searchParams.get('q') ?? '';
  const district = searchParams.get('district') ?? '';
  const verified = searchParams.get('verified') === '1';
  const activeCount = (q ? 1 : 0) + (district ? 1 : 0) + (verified ? 1 : 0);

  function push(next: URLSearchParams) {
    // Any change to the filters invalidates the page number.
    next.delete('page');
    const query = next.toString();
    startTransition(() =>
      router.replace(query ? `/companies?${query}` : '/companies', { scroll: false }),
    );
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  }

  return (
    <div className={cn('mt-6 flex flex-col gap-2 sm:flex-row sm:items-center', pending && 'opacity-70')}>
      <form action={action} method="get" className="relative flex-1">
        {/* Carried through so submitting the search does not silently drop the
            other two filters. */}
        {district ? <input type="hidden" name="district" value={district} /> : null}
        {verified ? <input type="hidden" name="verified" value="1" /> : null}

        <Search
          className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          className="h-11 w-full rounded-lg border border-input bg-card ps-10 pe-4 text-base shadow-xs placeholder:text-muted-foreground"
        />
      </form>

      <select
        value={district}
        onChange={(event) => setParam('district', event.target.value)}
        aria-label={t('district')}
        className="h-11 rounded-lg border border-input bg-card px-3 text-sm shadow-xs sm:w-48"
      >
        <option value="">{t('district')}</option>
        {districts.map((item) => (
          <option key={item.id} value={item.slug}>
            {localized(locale, item.name_ar, item.name_en)}
          </option>
        ))}
      </select>

      <label
        className={cn(
          'flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3.5 text-sm shadow-xs transition-colors',
          verified
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-input bg-card hover:bg-muted',
        )}
      >
        <input
          type="checkbox"
          checked={verified}
          onChange={(event) => setParam('verified', event.target.checked ? '1' : '')}
          className="size-4 accent-primary"
        />
        {t('verifiedOnly')}
      </label>

      {activeCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => push(new URLSearchParams())}
        >
          <X aria-hidden />
          {tCommon('all')}
        </Button>
      ) : null}
    </div>
  );
}
