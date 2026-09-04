'use client';

import { useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { usePathname } from '@/i18n/navigation';

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

  useEffect(() => {
    const el = ref.current;
    if (el) el.open = false;
  }, [pathname]);

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
        className="relative grid size-9 cursor-pointer list-none place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <Bell className="size-[1.15rem]" aria-hidden />

        {/* Capped, because the count is a prompt to look, not a statistic —
            and "99+" fits where "1,204" does not. */}
        {unread > 0 ? (
          <span className="numeral absolute -top-0.5 end-0 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </summary>

      <div className="absolute end-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
        {children}
      </div>
    </details>
  );
}
