'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { PhoneFrame, Screenshot } from '@/components/get-app/phone-frame';

/**
 * Four notifications, as a phone shows them, sliding in one after another
 * over a blurred Home screen once the section is in view. Under reduced
 * motion they are simply there.
 *
 * The words are the app's own: each card is built from the same catalogue
 * keys the bell, the feed and the push use (lib/notifications/title.ts),
 * with a sample job title and saved search in them — never a company's
 * name. Drawn, not captured, because the capture run is signed out and
 * sees none.
 *
 * The screen behind is blurred as well as dimmed, so no half-legible line
 * of it shows between two cards.
 */
export function NotificationStack({
  screen,
  appName,
  now,
  items,
  label,
  className,
}: {
  screen: string;
  appName: string;
  /** The timestamp every card carries. */
  now: string;
  items: readonly string[];
  /** What the list is, for a screen reader. */
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn('relative mx-auto w-[17rem] sm:w-[18rem]', className)}>
      <div
        aria-hidden
        className="absolute -inset-x-16 -inset-y-10 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-blue)_45%,transparent),transparent)]"
      />
      <PhoneFrame>
        <Screenshot src={screen} alt="" hidden sizes="18rem" />
        <div aria-hidden className="absolute inset-0 bg-black/50 backdrop-blur-[6px]" />

        <ol className="absolute inset-x-[4%] top-[15%] space-y-1.5" aria-label={label}>
          {items.map((text, index) => (
            <li
              key={text}
              style={{ transitionDelay: shown ? `${index * 450}ms` : undefined }}
              className={cn(
                'flex items-start gap-2.5 rounded-[1.1rem] bg-white/90 px-3 py-2.5 text-slate-900 shadow-md transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none',
                shown ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0',
              )}
            >
              <Image
                src="/brand/logo-mark.png"
                alt=""
                width={450}
                height={450}
                sizes="1.75rem"
                className="mt-0.5 size-7 shrink-0 rounded-md"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold">{appName}</span>
                  <span className="text-[0.6875rem] text-slate-500">{now}</span>
                </span>
                <span className="mt-0.5 block text-[0.8125rem] leading-snug">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </PhoneFrame>
    </div>
  );
}
