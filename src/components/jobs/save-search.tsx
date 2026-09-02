'use client';

import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BellPlus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { saveSearch } from '@/lib/actions/saved-searches';

/**
 * "Tell me when there's a new one of these."
 *
 * Only rendered when filters are actually active — offering to save an unfiltered
 * list would be offering to email somebody the whole job board every week.
 *
 * Signed-out readers get the control too, pointing at sign-in with a `next`
 * back to the search they built. Hiding it would mean the feature is only
 * discovered by people who already have an account, which is exactly backwards
 * for something whose job is to bring people back.
 */
export function SaveSearch({ signedIn, defaultLabel }: { signedIn: boolean; defaultLabel: string }) {
  const t = useTranslations('savedSearch');
  const tCommon = useTranslations('common');

  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(defaultLabel);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const query = searchParams.toString();

  if (!signedIn) {
    const next = `/jobs${query ? `?${query}` : ''}`;
    return (
      <Button asChild variant="outline" size="sm">
        <a href={`/sign-in?next=${encodeURIComponent(next)}`}>
          <BellPlus aria-hidden />
          {t('cta')}
        </a>
      </Button>
    );
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
        <Check className="size-4" aria-hidden />
        {t('saved')}
      </span>
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveSearch({ label, query });
      if (result.ok) {
        setDone(true);
        return;
      }
      setError(
        result.error === 'already_saved'
          ? t('alreadySaved')
          : result.error === 'cap'
            ? t('cap')
            : result.error === 'no_filters'
              ? t('noFilters')
              : tCommon('errorBody'),
      );
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BellPlus aria-hidden />
        {t('cta')}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        maxLength={80}
        aria-label={t('labelField')}
        className="h-9 w-48 rounded-lg border border-input bg-card px-3 text-sm shadow-xs"
        autoFocus
      />
      <Button type="submit" size="sm" disabled={pending || !label.trim()}>
        {pending ? tCommon('loading') : tCommon('save')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {tCommon('cancel')}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </form>
  );
}
