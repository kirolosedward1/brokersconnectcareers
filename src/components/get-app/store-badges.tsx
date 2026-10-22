import { cn } from '@/lib/utils';

/**
 * The two store badges, in the stores' own black-badge style: a black pill
 * with a light edge, the store's mark, a small line and the store's name.
 *
 * Built from markup rather than the stores' SVG files so the small line can
 * come from the catalogue — Apple and Google ship the badge in Arabic too, and
 * theirs reads right to left exactly like this one — while the store's name
 * stays as the store writes it. The marks are the two logos as the stores
 * draw them, in one path each.
 *
 * Google Play is not there yet. Its badge keeps the same shape, greyed, with
 * a "coming soon" tag and no way to follow it: `aria-disabled`, out of the tab
 * order, and no pointer events. A badge that is simply missing would read as
 * "iPhone only", which is not the plan.
 */

const BADGE =
  'relative inline-flex h-12 items-center gap-2.5 rounded-lg border px-3 text-white [&_svg]:shrink-0';

/** The live badge answers the pointer: a touch larger and brighter under it, a touch smaller as it is pressed. */
const LIVE =
  'border-[#a6a6a6] bg-black transition-[transform,filter] duration-150 ease-out hover:scale-[1.03] hover:brightness-125 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:scale-100';

function BadgeText({ top, name }: { top: string; name: string }) {
  return (
    <span className="flex flex-col text-start">
      <span className="text-[0.625rem] leading-none">{top}</span>
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

export function AppStoreBadge({
  href = '#',
  label,
  top,
  className,
}: {
  href?: string;
  /** The whole badge, read out: "Download on the App Store". */
  label: string;
  /** The small line above the store's name. */
  top: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className={cn(BADGE, LIVE, className)}
    >
      <AppleMark />
      <BadgeText top={top} name="App Store" />
    </a>
  );
}

export function GooglePlayBadge({
  href = '#',
  label,
  top,
  comingSoon,
  className,
}: {
  href?: string;
  /** The whole badge, read out: "Get it on Google Play". */
  label: string;
  /** The small line above the store's name. */
  top: string;
  /** The tag on the corner, and the end of what is read out. */
  comingSoon: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      aria-disabled="true"
      tabIndex={-1}
      aria-label={`${label}. ${comingSoon}`}
      className={cn(BADGE, 'pointer-events-none border-[#6b6b6b] bg-[#2b2b2b] text-white/55', className)}
    >
      <PlayMark className="opacity-50 grayscale" />
      <BadgeText top={top} name="Google Play" />
      <span
        aria-hidden
        className="absolute -top-2.5 end-2.5 rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-semibold leading-tight text-accent-foreground ring-1 ring-background"
      >
        {comingSoon}
      </span>
    </a>
  );
}
