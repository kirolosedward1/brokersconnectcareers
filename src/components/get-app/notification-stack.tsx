'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { PhoneFrame, Screenshot } from '@/components/get-app/phone-frame';

/**
 * The four notifications the app sends, as the cards a phone shows them in,
 * sliding in one after another over a dimmed Home screen once the section
 * is in view. Under reduced motion they are simply there.
 *
 * Drawn, not captured: the simulator run is signed out and sees none. No
 * company is named in them.
 */
export function NotificationStack({
  screen,
  screenAlt,
  appName,
  now,
  items,
  className,
}: {
  screen: string;
  screenAlt: string;
  appName: string;
  /** The timestamp every card carries. */
  now: string;
  items: readonly string[];
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
    <div ref={ref} className={cn('relative mx-auto w-64 sm:w-[18rem]', className)}>
      <div
        aria-hidden
        className="absolute -inset-x-20 -inset-y-10 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-blue)_45%,transparent),transparent)]"
      />
      <PhoneFrame>
        <Screenshot src={screen} alt={screenAlt} sizes="18rem" />
        <div aria-hidden className="absolute inset-0 bg-black/45" />

        <ol className="absolute inset-x-[5%] top-[14%] space-y-2" aria-label={appName}>
          {items.map((text, index) => (
            <li
              key={text}
              style={{ transitionDelay: shown ? `${index * 450}ms` : undefined }}
              className={cn(
                'flex items-start gap-2.5 rounded-2xl bg-white/92 p-3 text-slate-900 shadow-md backdrop-blur transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none',
                shown ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0',
              )}
            >
              <Image
                src="/brand/logo-mark.png"
                alt=""
                width={450}
                height={450}
                sizes="2rem"
                className="size-8 shrink-0 rounded-lg"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.8rem] font-semibold">{appName}</span>
                  <span className="text-[0.7rem] text-slate-500">{now}</span>
                </span>
                <span className="mt-0.5 block text-[0.85rem] leading-snug">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </PhoneFrame>
    </div>
  );
}
