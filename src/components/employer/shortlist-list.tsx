'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, CircleDot, Lock, MapPin, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Avatar } from '@/components/ui/avatar';
import { ShortlistToggle } from '@/components/agents/shortlist-toggle';

/**
 * The shortlist, owned by the browser so that removing somebody removes them.
 *
 * This was a server-rendered list with a toggle on each row, and pressing the
 * toggle left the row exactly where it was: the action succeeded, the database
 * row was gone, `revalidatePath` had been called, and the card stayed on
 * screen with its icon flipped to "add" — a consultant simultaneously on and
 * off the list. The count above it went on saying one.
 *
 * So the list holds its own rows, the same shape SavedSearchList does and for
 * the same reason. A shortlist entry is one click to recreate from the
 * directory, which makes an optimistic removal far cheaper than a list that
 * feels unresponsive — and this one has to be optimistic, because the row is
 * the only thing that can remove itself.
 *
 * Everything localized is resolved by the page and handed over as strings:
 * this side needs no taxonomy, no locale arithmetic and no date formatting,
 * and the district map never crosses the boundary.
 */
export type ShortlistRow = {
  id: string;
  /** Null once the consultant has left the directory: there is no page to link to. */
  slug: string | null;
  isListed: boolean;
  isUnlocked: boolean;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  tracks: string[];
  years: string | null;
  areas: string | null;
  moreAreas: string | null;
  availability: string | null;
  looking: boolean;
  savedNote: string;
};

export function ShortlistList({ rows: fromServer }: { rows: ShortlistRow[] }) {
  const t = useTranslations('employer');
  const tAgents = useTranslations('agents');
  const tJobs = useTranslations('jobs');

  const [removed, setRemoved] = useState<string[]>([]);
  const rows = fromServer.filter((row) => !removed.includes(row.id));

  if (rows.length === 0) {
    // Not the page's empty state, which offers the directory: this is the one
    // somebody reaches by emptying the list themselves, and they know where
    // the directory is.
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {t('shortlistEmpty')}
      </p>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">{tJobs('resultsCount', { count: rows.length })}</p>

      <ul className="mt-3 space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="relative rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex gap-4">
              {row.isUnlocked && row.name ? (
                <Avatar name={row.name} src={row.avatarUrl} seed={row.slug ?? row.id} size="lg" />
              ) : (
                <span
                  aria-hidden
                  className="grid size-16 shrink-0 place-items-center rounded-full bg-muted"
                >
                  <UserRound className="size-7 text-muted-foreground" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-1.5 text-lg font-semibold leading-tight">
                  {/* A consultant who has left the directory has no page to
                      link to, and their slug is their name transliterated — so
                      there is no link and no name, only the fact of the row. */}
                  {row.isListed && row.slug ? (
                    <Link
                      href={`/agents/${row.slug}`}
                      className="after:absolute after:inset-0 hover:text-primary"
                    >
                      {row.isUnlocked && row.name ? row.name : tAgents('anonymous')}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t('shortlistGone')}</span>
                  )}

                  {row.isListed && !row.isUnlocked ? (
                    <Lock
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label={tAgents('locked')}
                    />
                  ) : null}
                </h2>

                {row.isListed ? (
                  row.headline ? (
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {row.headline}
                    </p>
                  ) : null
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">{t('shortlistGoneHint')}</p>
                )}

                {row.tracks.length ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {row.tracks.map((track) => (
                      <li
                        key={track}
                        className="rounded-full bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary"
                      >
                        {track}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <ShortlistToggle
                agentId={row.id}
                initialSaved
                onRemoved={() => setRemoved((current) => [...current, row.id])}
                labels={{ add: tAgents('shortlistAdd'), remove: tAgents('shortlistRemove') }}
                className="-mt-1 -me-1"
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
              {row.years ? (
                <span className="inline-flex items-center gap-1.5">
                  <Briefcase className="size-4" aria-hidden />
                  {row.years}
                </span>
              ) : null}

              {row.areas ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden />
                  {row.areas}
                  {row.moreAreas ? <span className="numeral">{row.moreAreas}</span> : null}
                </span>
              ) : null}

              {row.availability ? (
                <span
                  className={`inline-flex items-center gap-1.5 ${
                    row.looking ? 'font-medium text-success' : ''
                  }`}
                >
                  <CircleDot className="size-4" aria-hidden />
                  {row.availability}
                </span>
              ) : null}

              {/* Who kept them, and when. A company is a team, so the colleague
                  who has been meaning to call this person is a fact the rest of
                  the team needs. */}
              <span className="ms-auto">{row.savedNote}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
