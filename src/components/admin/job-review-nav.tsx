'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Previous and next, in the list this listing was opened from.
 *
 * On a wide screen the arrows sit in the gutters, stuck to the vertical
 * middle. On a phone they become a bar along the bottom. In Arabic, next is
 * the left-hand arrow and previous is the right-hand one: that is the
 * direction each one moves.
 */
export function JobReviewNav({
  previousHref,
  nextHref,
  position,
  total,
  approveEvent = 'admin:open-approve',
}: {
  previousHref: string | null;
  nextHref: string | null;
  position: number | null;
  total: number;
  /** Dispatched when A is pressed, so the approve confirmation can open. */
  approveEvent?: string;
}) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const router = useRouter();
  const label =
    position === null ? t('notInList') : t('positionOf', { position: formatNumber(position, locale), total: formatNumber(total, locale) });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      const rtl = document.documentElement.dir === 'rtl';
      const key = event.key;
      const next = key === 'j' || key === 'J' || key === (rtl ? 'ArrowLeft' : 'ArrowRight');
      const previous = key === 'k' || key === 'K' || key === (rtl ? 'ArrowRight' : 'ArrowLeft');
      if ((key === 'a' || key === 'A') && !event.shiftKey) {
        event.preventDefault();
        window.dispatchEvent(new Event(approveEvent));
        return;
      }
      const href = next ? nextHref : previous ? previousHref : null;
      if (!href) return;
      event.preventDefault();
      router.push(href);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [approveEvent, nextHref, previousHref, router]);

  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 -start-16 hidden w-14 lg:block">
        <div className="sticky top-[calc(50vh-1.75rem)]">
          <Arrow href={previousHref} label={t('previousJob')} side="previous" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 -end-16 hidden w-14 lg:block">
        <div className="sticky top-[calc(50vh-1.75rem)]">
          <Arrow href={nextHref} label={t('nextJob')} side="next" />
        </div>
      </div>

      <p className="hidden text-center text-sm text-muted-foreground lg:block">{label}</p>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-card px-3 py-2 lg:hidden">
        <BarLink href={previousHref} label={t('previousJob')} />
        <p className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">{label}</p>
        <BarLink href={nextHref} label={t('nextJob')} />
      </div>
    </>
  );
}

function Arrow({ href, label, side }: { href: string | null; label: string; side: 'previous' | 'next' }) {
  const Icon = side === 'previous' ? ChevronLeft : ChevronRight;
  const className = cn(
    'pointer-events-auto grid size-14 place-items-center rounded-full border border-border bg-card text-foreground shadow-md transition-colors',
    href ? 'hover:bg-muted' : 'cursor-not-allowed opacity-40',
  );
  const icon = <Icon className="size-6 rtl:-scale-x-100" aria-hidden />;
  if (!href) {
    return (
      <span className={className} aria-disabled="true">
        <span className="sr-only">{label}</span>
        {icon}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} prefetch className={className}>
      {icon}
    </Link>
  );
}

function BarLink({ href, label }: { href: string | null; label: string }) {
  const className = cn(
    'inline-flex h-11 min-w-24 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium',
    href ? 'bg-card hover:bg-muted' : 'cursor-not-allowed opacity-40',
  );
  if (!href) {
    return (
      <span className={className} aria-disabled="true">
        {label}
      </span>
    );
  }
  return (
    <Link href={href} prefetch className={className}>
      {label}
    </Link>
  );
}
