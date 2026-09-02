'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, BellOff, Search, Trash2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { deleteSavedSearch, setSearchAlerts } from '@/lib/actions/saved-searches';
import type { SavedSearchRow } from '@/lib/supabase/database.types';

/**
 * The saved searches, with their alert switch.
 *
 * Deleting removes the row from the list optimistically. A saved search is
 * cheap to recreate — it is one click on the jobs page — so the cost of being
 * wrong here is far lower than the cost of a list that feels unresponsive.
 */
export function SavedSearchList({ searches }: { searches: SavedSearchRow[] }) {
  const t = useTranslations('savedSearch');
  const [rows, setRows] = useState(searches);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </p>
    );
  }

  function toggle(row: SavedSearchRow) {
    const next = !row.alerts;
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, alerts: next } : r)));
    startTransition(async () => {
      const result = await setSearchAlerts({ id: row.id, alerts: next });
      if (!result.ok) {
        setRows((current) => current.map((r) => (r.id === row.id ? { ...r, alerts: !next } : r)));
      }
    });
  }

  function remove(id: string) {
    const before = rows;
    setRows((current) => current.filter((r) => r.id !== id));
    startTransition(async () => {
      const result = await deleteSavedSearch(id);
      if (!result.ok) setRows(before);
    });
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />

          <Link
            href={`/jobs?${row.query}`}
            className="min-w-0 flex-1 truncate font-medium transition-colors hover:text-primary"
          >
            {row.label}
          </Link>

          <button
            type="button"
            onClick={() => toggle(row)}
            disabled={pending}
            aria-pressed={row.alerts}
            className={
              row.alerts
                ? 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors'
                : 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors'
            }
          >
            {row.alerts ? (
              <Bell className="size-3.5" aria-hidden />
            ) : (
              <BellOff className="size-3.5" aria-hidden />
            )}
            {row.alerts ? t('alertsOn') : t('alertsOff')}
          </button>

          <button
            type="button"
            onClick={() => remove(row.id)}
            disabled={pending}
            aria-label={t('remove')}
            className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
