'use client';

import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import { APP_STORE_URL, GOOGLE_PLAY_URL } from '@/lib/app-links';
import { AppleMark, PlayMark } from '@/components/get-app/store-marks';

/**
 * The two store buttons, in the stores' own black-badge style: a black pill
 * with a light edge, the store's mark, a small line and the store's name.
 *
 * Built from markup rather than the stores' SVG files so the small line can
 * come from the catalogue — Apple and Google ship the badge in Arabic too,
 * and theirs reads right to left exactly like this one — while the store's
 * name stays as the store writes it. The marks live in store-marks.tsx,
 * shared with the badges on the results card.
 *
 * Both links come from lib/app-links.ts. The App Store one opens the store
 * in a new tab once its address is set; until then it is `#` and stays on
 * the page. Google Play is muted, `aria-disabled`, out of the tab order and
 * tagged "coming soon" until its address is set — a badge that is simply
 * missing would read as "iPhone only", which is not the plan.
 *
 * `location` names which copy of the buttons earned a click, for analytics.
 */

export type StoreLabels = {
  appStoreTop: string;
  appStoreLabel: string;
  googlePlayTop: string;
  googlePlayLabel: string;
  comingSoon: string;
};

const BADGE =
  'relative inline-flex h-12 items-center gap-2.5 rounded-lg border px-3 text-white [&_svg]:shrink-0';

const LIVE =
  'border-[#a6a6a6] bg-black transition-[transform,filter] duration-150 ease-out hover:scale-[1.03] hover:brightness-125 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:scale-100';

/** The space between the two lines is real text, so the visible words read as the accessible name does. */
function BadgeText({ top, name }: { top: string; name: string }) {
  return (
    <span className="flex flex-col text-start">
      <span className="text-[0.625rem] leading-none">{top}</span>{' '}
      <span className="mt-1 text-lg font-semibold leading-none">{name}</span>
    </span>
  );
}

export function StoreButtons({
  labels,
  location,
  className,
}: {
  labels: StoreLabels;
  /** Which copy of the buttons this is: hero, sticky or final. */
  location: 'hero' | 'sticky' | 'final';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <a
        href={APP_STORE_URL ?? '#'}
        target={APP_STORE_URL ? '_blank' : undefined}
        rel="noopener"
        aria-label={labels.appStoreLabel}
        onClick={() => track('app_store_click', { location })}
        className={cn(BADGE, LIVE)}
      >
        <AppleMark />
        <BadgeText top={labels.appStoreTop} name="App Store" />
      </a>

      {GOOGLE_PLAY_URL ? (
        <a
          href={GOOGLE_PLAY_URL}
          target="_blank"
          rel="noopener"
          aria-label={labels.googlePlayLabel}
          className={cn(BADGE, LIVE)}
        >
          <PlayMark />
          <BadgeText top={labels.googlePlayTop} name="Google Play" />
        </a>
      ) : (
        /* Named by what is on it — the two lines and the tag — so the words
           a reader sees are the words a screen reader says. */
        <a
          href="#"
          aria-disabled="true"
          tabIndex={-1}
          className={cn(BADGE, 'pointer-events-none border-[#6b6b6b] bg-[#2b2b2b] text-white/55')}
        >
          <PlayMark className="opacity-50 grayscale" />
          <BadgeText top={labels.googlePlayTop} name="Google Play" />{' '}
          <span className="absolute -top-2.5 end-2.5 rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-semibold leading-tight text-accent-foreground ring-1 ring-background">
            {labels.comingSoon}
          </span>
        </a>
      )}
    </div>
  );
}
