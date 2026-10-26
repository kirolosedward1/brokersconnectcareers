'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { markNotificationsRead, openNotification } from '@/lib/actions/notifications';
import { bellBadge } from '@/lib/notifications/feed';
import { formatBellTime } from '@/lib/notifications/relative';
import { reach } from '@/lib/reach';
import { cn } from '@/lib/utils';
import { notificationIcon, notificationTone } from '@/components/notifications/kinds';
import { Skeleton } from '@/components/ui/skeleton';

/** How often a signed-in header asks whether anything new arrived. */
const POLL_MS = 30_000;

type Item = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
  unread: boolean;
};

const triggerClass =
  'relative grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground group-data-[over-hero]/header:text-white group-data-[over-hero]/header:hover:bg-white/15 group-data-[over-hero]/header:hover:text-white';

/**
 * The bell in the website header, beside the avatar.
 *
 * On a phone it is a link to the feed: a dropdown there covers the page.
 * From the `md` breakpoint up, the same control opens a 360px panel aligned
 * to the bell's end edge. The list is fetched when that panel opens, not
 * rendered into the cached page. While the tab is visible the badge asks
 * only for the unread count, and that question stops while the tab is hidden.
 */
export function SiteBell({ locale, initialUnread = 0 }: { locale: string; initialUnread?: number }) {
  const t = useTranslations('notifications');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [unreadCount, setUnreadCount] = useState(initialUnread);
  const [items, setItems] = useState<Item[] | null>(null);
  const [listError, setListError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const itemsRef = useRef<Item[] | null>(null);
  const listRequest = useRef(0);

  const unread = unreadCount;
  const badge = bellBadge(unread);
  const label = unread > 0 ? t('bellUnread', { count: unread }) : t('bellTitle');

  const loadCount = useCallback(async () => {
    if (document.hidden) return;
    try {
      const response = await fetch('/api/notifications?count=1', { cache: 'no-store' });
      if (!response.ok || document.hidden) return;
      const data = (await response.json()) as { signedIn?: boolean; unread?: number };
      const next = data.unread;
      if (!data.signedIn || typeof next !== 'number') return;
      setUnreadCount((current) => (current === next ? current : next));
    } catch {
      // The badge stays. A dropped poll is not an empty inbox.
    }
  }, []);

  const loadList = useCallback(async () => {
    const request = ++listRequest.current;
    setListError(false);
    try {
      const response = await fetch(`/api/notifications?locale=${encodeURIComponent(locale)}`, {
        cache: 'no-store',
      });
      if (request !== listRequest.current) return;
      if (!response.ok) {
        if (!itemsRef.current) setListError(true);
        return;
      }
      const data = (await response.json()) as { signedIn?: boolean; unread?: number; items?: Item[] };
      if (request !== listRequest.current) return;
      if (!data.signedIn || !Array.isArray(data.items)) {
        if (!itemsRef.current) setListError(true);
        return;
      }
      const next = data.items.filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string');
      if (typeof data.unread === 'number') setUnreadCount(data.unread);
      setItems((current) => {
        const kept = current && JSON.stringify(current) === JSON.stringify(next) ? current : next;
        itemsRef.current = kept;
        return kept;
      });
    } catch {
      // A list already on screen stays. The first read, with nothing to keep, asks to retry.
      if (request !== listRequest.current) return;
      if (!itemsRef.current) setListError(true);
    }
  }, [locale]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const clear = () => {
      window.clearTimeout(timer);
      timer = 0;
    };
    const arm = () => {
      clear();
      if (stopped || document.hidden) return;
      timer = window.setTimeout(() => {
        void loadCount().finally(arm);
      }, POLL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clear();
        return;
      }
      void loadCount().finally(arm);
    };
    if (!document.hidden) void loadCount().finally(arm);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadCount]);

  useEffect(() => {
    const el = detailsRef.current;
    if (el) el.open = false;
  }, [pathname]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const el = detailsRef.current;
      if (el?.open && event.target instanceof Node && !el.contains(event.target)) el.open = false;
    }
    function onKeyDown(event: KeyboardEvent) {
      const el = detailsRef.current;
      if (event.key === 'Escape' && el?.open) {
        el.open = false;
        summaryRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function onToggle() {
    const el = detailsRef.current;
    if (!el?.open) return;
    void loadList();
    queueMicrotask(() => focusList());
  }

  function focusList() {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector('button');
    (row ?? list).focus();
  }

  useEffect(() => {
    const el = detailsRef.current;
    const list = listRef.current;
    if (!el?.open || !list || document.activeElement !== list) return;
    const row = list.querySelector('button');
    row?.focus();
  }, [items]);

  const newest = items?.[0]?.createdAt ?? null;

  async function markAll() {
    if (unread <= 0 || pending) return;
    setPending(true);
    setFailed(false);
    const result = await reach(markNotificationsRead(newest));
    setPending(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setUnreadCount(0);
    setItems((current) => {
      const next = current ? current.map((item) => ({ ...item, unread: false })) : current;
      itemsRef.current = next;
      return next;
    });
    void loadList();
  }

  return (
    <>
      <Link href="/dashboard/notifications" aria-label={label} className={cn(triggerClass, 'shrink-0 md:hidden')}>
        <BellIcon badge={badge} />
      </Link>

      {/*
        The summary stays `display: block`. Grid or flex on it makes Chrome
        abandon the disclosure: the panel is painted while closed, and the
        control drops out of the accessibility tree. The hit target is the
        span inside.
      */}
      <details
        ref={detailsRef}
        className="relative shrink-0 max-md:hidden [&:not([open])>:not(summary)]:hidden"
        onToggle={onToggle}
      >
        <summary
          ref={summaryRef}
          role="button"
          aria-label={label}
          aria-controls={listId}
          className="cursor-pointer list-none [&::-webkit-details-marker]:hidden"
        >
          <span className={triggerClass}>
            <BellIcon badge={badge} />
          </span>
        </summary>

        <div className="absolute end-0 z-50 mt-2 w-[360px] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg [--ring:var(--brand-blue)]">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
            <p className="text-sm font-semibold">{t('bellTitle')}</p>
            <button
              type="button"
              disabled={unread <= 0 || pending}
              onClick={() => void markAll()}
              className="text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-40"
            >
              {t('bellMarkAll')}
            </button>
          </div>

          {failed ? (
            <p role="alert" className="px-3 pt-2 text-xs text-destructive">
              {tCommon('errorBody')}
            </p>
          ) : null}

          <div
            id={listId}
            ref={listRef}
            tabIndex={-1}
            aria-busy={items === null && !listError}
            className="max-h-[min(28rem,calc(100vh-8rem))] overflow-y-auto outline-none"
          >
            {listError && items === null ? (
              <div className="px-6 py-10 text-center">
                <p role="alert" className="text-sm text-muted-foreground">
                  {t('bellLoadError')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    listRef.current?.focus();
                    void loadList();
                  }}
                  className="mt-1 text-sm font-medium text-primary underline underline-offset-4"
                >
                  {t('bellRetry')}
                </button>
              </div>
            ) : items && items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <Bell className="size-8 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                <p className="text-sm text-muted-foreground">{t('bellEmpty')}</p>
              </div>
            ) : items ? (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <Row item={item} locale={locale} unreadLabel={t('unread')} />
                  </li>
                ))}
              </ul>
            ) : (
              <SkeletonRows />
            )}
          </div>

          <Link
            href="/dashboard/notifications"
            className="flex min-h-11 items-center justify-center border-t border-border text-sm font-medium text-primary hover:underline"
          >
            {t('seeAll')}
          </Link>
        </div>
      </details>
    </>
  );
}

function BellIcon({ badge }: { badge: string | null }) {
  return (
    <span className="relative grid place-items-center">
      <Bell className="size-[1.15rem]" aria-hidden />
      {badge ? (
        <span
          aria-hidden
          className="numeral absolute -top-1.5 -end-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground"
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Three stand-ins while the first list is still on the way.
 *
 * Each one is the row itself: the same padding, the icon's box, and the
 * title and time line boxes a row always has. The grey marks sit inside
 * those lines, so the panel keeps its height when the feed arrives.
 * Nothing here spins.
 */
function SkeletonRows() {
  const titleWidths = ['w-3/5', 'w-2/3', 'w-1/2'];
  return (
    <ul aria-hidden>
      {titleWidths.map((width, index) => (
        <li key={index} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <span className="min-w-0 flex-1">
            <span className="flex h-5 items-center">
              <Skeleton className={cn('h-3.5', width)} />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-3 w-16" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Row({ item, locale, unreadLabel }: { item: Item; locale: string; unreadLabel: string }) {
  const Icon = notificationIcon(item.kind);
  return (
    <form action={openNotification}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        className={cn(
          'flex w-full items-start gap-3 px-3 py-2.5 text-start transition-colors hover:bg-muted',
          item.unread && 'bg-primary/5',
        )}
      >
        <span
          aria-hidden
          className={cn('grid size-9 shrink-0 place-items-center rounded-lg', notificationTone(item.kind))}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', item.unread && 'font-medium')}>{item.title}</span>
          {item.detail ? (
            <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
          ) : null}
          <span className="block text-xs text-muted-foreground">{formatBellTime(item.createdAt, locale)}</span>
        </span>
        {item.unread ? (
          <>
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
            <span className="sr-only">{unreadLabel}</span>
          </>
        ) : null}
      </button>
    </form>
  );
}
