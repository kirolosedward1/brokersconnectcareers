'use client';

import { useEffect, useRef } from 'react';
import { Menu } from 'lucide-react';
import { usePathname } from '@/i18n/navigation';

/**
 * The phone menu, still a <details> underneath.
 *
 * Keeping the disclosure means the menu opens and closes with no JavaScript at
 * all — it is server-rendered markup that works on a bad connection before any
 * bundle arrives. What this adds is the three behaviours a bare <details> does
 * not have, layered on only once the client is running:
 *
 *   - Close on navigation. This was the real bug. The App Router keeps the
 *     header mounted across a client-side route change, so the `open` attribute
 *     survived it and the panel sat there covering whichever page you had just
 *     asked for. A full page load hid the problem, which is why the original
 *     comment claimed it closed on navigation; it did not.
 *   - Close on tapping outside, the gesture everyone tries first.
 *   - Close on Escape, and put focus back on the button that opened it.
 *
 * All three degrade to "the menu still opens and closes from its own button",
 * which is why they live in effects rather than in the markup.
 */
export function MobileNav({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  // Navigating is a decision to leave; the menu has served its purpose.
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
      if (event.key !== 'Escape') return;
      const el = ref.current;
      if (!el?.open) return;
      el.open = false;
      // Escape should leave focus somewhere sensible, not on a hidden link.
      summaryRef.current?.focus();
    }

    // pointerdown rather than click: it fires before the panel can be torn out
    // from under the finger, and it covers touch and mouse in one listener.
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <details ref={ref} className="group relative md:hidden">
      <summary
        ref={summaryRef as React.RefObject<HTMLElement>}
        className="grid size-9 cursor-pointer list-none place-items-center rounded-lg transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden"
        aria-label={label}
      >
        <Menu
          className="size-5 transition-transform duration-200 group-open:rotate-90"
          aria-hidden
        />
      </summary>

      <div className="animate-in fade-in slide-in-from-top-1 absolute end-0 top-full z-50 mt-2 w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-lg duration-150">
        {children}
      </div>
    </details>
  );
}
