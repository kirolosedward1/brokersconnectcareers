'use client';

import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import { APP_STORE_URL, GOOGLE_PLAY_URL } from '@/lib/app-links';

/**
 * The two store buttons, in the stores' own black-badge style: a black pill
 * with a light edge, the store's mark, a small line and the store's name.
 *
 * Built from markup rather than the stores' SVG files so the small line can
 * come from the catalogue — Apple and Google ship the badge in Arabic too,
 * and theirs reads right to left exactly like this one — while the store's
 * name stays as the store writes it. The marks are the two logos as the
 * stores draw them, one path each.
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

function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6', className)} fill="currentColor" aria-hidden focusable="false">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function PlayMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6', className)} aria-hidden focusable="false">
      <path fill="#1ba9ff" d="M3.609 1.814 13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92z" />
      <path fill="#f43c4c" d="m14.499 12.707 2.302 2.302-10.937 6.333z" />
      <path fill="#ffce00" d="m17.698 9.509 2.807 1.626a1 1 0 0 1 0 1.73l-2.808 1.626L15.206 12z" />
      <path fill="#32c875" d="M5.864 2.658 16.802 8.99l-2.303 2.303z" />
    </svg>
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
