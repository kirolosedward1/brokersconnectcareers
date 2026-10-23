'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { localeHref, type Locale } from '@/i18n/routing';
import { COMPARE_MAX, COMPARE_MIN, togglePick } from '@/lib/saved/compare';
import { Button } from '@/components/ui/button';

function numeral(chunks: ReactNode) {
  return <span className="numeral">{chunks}</span>;
}

/**
 * Choosing two or three open saved listings to compare, the same rule the
 * app uses. Closed listings stay on the page and stop taking taps while a
 * choice is in progress. The form is a GET, so the compare page is a URL.
 */
export function CompareChooser({
  locale,
  openHeading,
  open,
  closed,
}: {
  locale: Locale;
  openHeading: ReactNode;
  open: { id: string; title: string; card: ReactNode }[];
  closed: ReactNode;
}) {
  const t = useTranslations('compare');
  const tCommon = useTranslations('common');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [refused, setRefused] = useState(false);

  function toggle(id: string) {
    const next = togglePick(picked, id);
    setPicked(next.picked);
    setRefused(next.refused);
  }

  const list = (
    <div className="space-y-6">
      {open.length > 0 ? (
        <div>
          {openHeading}
          <ul className="space-y-3">
            {open.map((item) => {
              const order = picked.indexOf(item.id) + 1;
              return (
                <li key={item.id} className="flex items-start gap-3">
                  {picking ? (
                    <span className="mt-4 flex shrink-0 items-center gap-2">
                      {order > 0 ? (
                        <span className="numeral grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {order}
                        </span>
                      ) : null}
                      <input
                        type="checkbox"
                        checked={order > 0}
                        onChange={() => toggle(item.id)}
                        aria-label={t('pick', { title: item.title })}
                        title={t('pickHint')}
                        className="size-5 accent-primary"
                      />
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">{item.card}</div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className={picking ? 'pointer-events-none opacity-40' : undefined}>{closed}</div>
    </div>
  );

  if (open.length < COMPARE_MIN) return list;

  /*
    The list stays outside the form. Each card carries the reader's note, and
    that editor is a form of its own. A form inside this one would send the
    compare navigation when they press Save. The chosen ids travel as hidden
    fields; the cards themselves are not submitted.
  */
  return (
    <div className="space-y-4">
      <form action={localeHref(locale, '/dashboard/saved/compare')} method="get">
        {picking ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t.rich('choose', { max: COMPARE_MAX, v: numeral })}</p>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t.rich('picked', { count: picked.length, v: numeral })}
            </p>
            {refused ? <p className="text-sm text-destructive">{t.rich('limit', { max: COMPARE_MAX, v: numeral })}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {picked.map((id) => (
                <input key={id} type="hidden" name="ids" value={id} />
              ))}
              <Button type="submit" disabled={picked.length < COMPARE_MIN}>
                {t.rich('go', { count: picked.length, v: numeral })}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPicking(false);
                  setPicked([]);
                  setRefused(false);
                }}
              >
                {tCommon('cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => setPicking(true)}>
              {t('start')}
            </Button>
            <p className="text-sm text-muted-foreground">{t.rich('startHint', { max: COMPARE_MAX, v: numeral })}</p>
          </div>
        )}
      </form>
      {list}
    </div>
  );
}
