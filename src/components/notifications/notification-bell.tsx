'use client';

import { useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';

/** Tabs of one browser tell each other when the unread count moved. */
const CHANNEL = 'bc-notifications';
/** Coming back to a tab re-reads the bell at most this often. */
const STALE_AFTER_MS = 60_000;

/**
 * The bell's disclosure behaviour.
 *
 * Same shape as the phone menu, and for the same reason: a <details> opens and
 * closes with no JavaScript, so the feed is reachable on a bad connection
 * before any bundle arrives. What the client adds is the three things a bare
 * disclosure cannot do — close when you navigate somewhere (the App Router
 * keeps this layout mounted, so nothing else would), close when you tap
 * outside, and close on Escape with focus handed back to the button.
 *
 * The panel's contents are server-rendered and passed in, so the unread count
 * and the list are never a second source of truth living in client state.
 */
export function NotificationBell({
  label,
  unread,
  children,
}: {
  label: string;
  unread: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const renderedAt = useRef(Date.now());

  useEffect(() => {
    const el = ref.current;
    if (el) el.open = false;
  }, [pathname]);

  /*
    Two tabs.

    The count is server-rendered, so a tab only learns it changed when it next
    renders. Reading a notification in one tab left the other showing the old
    badge indefinitely — and showing rows as unread that were not. Two cheap
    signals close that without polling:

      a BroadcastChannel, on which every tab announces the count it just
      rendered; a tab holding a different count refreshes. The tab that did
      the reading re-renders from its own action, announces, and the others
      follow. A tab that already agrees does nothing, so it settles in one
      round rather than bouncing.

      returning to a tab that has sat in the background for a minute, which
      also catches notifications that arrived from somewhere else entirely.

    router.refresh() re-renders the server components in place and keeps
    client state — a half-typed form in the page below is not lost.
  */
  useEffect(() => {
    renderedAt.current = Date.now();
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ unread });
    channel.onmessage = (event: MessageEvent<{ unread?: number }>) => {
      if (typeof event.data?.unread === 'number' && event.data.unread !== unread) {
        router.refresh();
      }
    };
    return () => channel.close();
  }, [unread, router]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - renderedAt.current < STALE_AFTER_MS) return;
      renderedAt.current = Date.now();
      router.refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const el = ref.current;
      if (el?.open && event.target instanceof Node && !el.contains(event.target)) {
        el.open = false;
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      const el = ref.current;
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

  return (
    <details ref={ref} className="relative">
      <summary
        ref={summaryRef}
        aria-label={label}
        className="relative grid size-11 cursor-pointer list-none place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        {/* The badge hangs off the icon, not off the 44px hit area, or it
            would sit adrift in the corner of an empty box. */}
        <span className="relative grid place-items-center">
          <Bell className="size-[1.15rem]" aria-hidden />

          {/* Capped, because the count is a prompt to look, not a statistic —
              and "99+" fits where "1,204" does not. */}
          {unread > 0 ? (
            <span className="numeral absolute -top-1.5 -end-1.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </span>
      </summary>

      {/*
        Hung from the bell on a wide screen, pinned to the viewport on a phone.

        `end-0` aligns the panel's end edge with the trigger's, which is the
        right behaviour when there is room beside it and the wrong one when
        there is not: the bell sits in the middle of a 375px header, so a
        352px panel anchored to it started 119px in and ran 87px off the far
        edge. The width was already clamped — it was the position that was
        not, and no width can fix an anchor that leaves too little room.

        The header is `sticky top-0 h-14`, so `top-14` puts the panel directly
        under it whatever the page has scrolled to, and `inset-x-4` gives it
        the same gutter as everything else on the screen.

        Its own text colour and focus ring, as the phone menu has: over a
        landing page's film the header carries white type and a white ring,
        and this light panel inherited both — white on white.
      */}
      <div
        className={[
          'z-50 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg [--ring:var(--brand-blue)]',
          'fixed inset-x-4 top-14',
          'sm:absolute sm:inset-x-auto sm:end-0 sm:top-auto sm:mt-2 sm:w-[22rem]',
        ].join(' ')}
      >
        {children}
      </div>
    </details>
  );
}
