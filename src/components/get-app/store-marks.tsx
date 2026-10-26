import { cn } from '@/lib/utils';

/**
 * The two store marks, one path each, as the stores draw them.
 *
 * Shared by the buttons on /app and the badges on the results card, so
 * a listing is drawn once.
 */

export function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6', className)} fill="currentColor" aria-hidden focusable="false">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

export function PlayMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6', className)} aria-hidden focusable="false">
      <path fill="#1ba9ff" d="M3.609 1.814 13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92z" />
      <path fill="#f43c4c" d="m14.499 12.707 2.302 2.302-10.937 6.333z" />
      <path fill="#ffce00" d="m17.698 9.509 2.807 1.626a1 1 0 0 1 0 1.73l-2.808 1.626L15.206 12z" />
      <path fill="#32c875" d="M5.864 2.658 16.802 8.99l-2.303 2.303z" />
    </svg>
  );
}

/**
 * One official black badge, 40px tall, for a listing that exists.
 *
 * The results card renders one per store whose address is set, and
 * none for a store that is not listed. No muted stand-in.
 */
const BADGE =
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-[#a6a6a6] bg-black px-2 text-white transition-[filter] duration-150 ease-out hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue-ink)]';

export function StoreBadgeLink({
  store,
  href,
  top,
  name,
  label,
}: {
  store: 'apple' | 'google';
  href: string;
  /** The small line above the store's name. */
  top: string;
  /** The store's own name, as the store writes it. */
  name: string;
  /** The accessible name. It says the same thing as the two visible lines. */
  label: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={BADGE}>
      {store === 'apple' ? <AppleMark className="size-5" /> : <PlayMark className="size-5" />}
      <span className="flex flex-col text-start">
        <span className="text-[8px] leading-none">{top}</span>
        <span className="mt-0.5 text-[13px] font-semibold leading-none">{name}</span>
      </span>
    </a>
  );
}
