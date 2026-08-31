import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Real <a> links, so pagination works without JavaScript and each page is
 * independently crawlable. Chevrons carry direction, so they flip under RTL.
 */
export function Pagination({
  page,
  pageCount,
  buildHref,
}: {
  page: number;
  pageCount: number;
  buildHref: (page: number) => string;
}) {
  const t = useTranslations('jobs');
  if (pageCount <= 1) return null;

  const windowed = pageNumbers(page, pageCount);

  return (
    <nav aria-label={t('title')} className="mt-8 flex items-center justify-center gap-1">
      <PageLink
        href={buildHref(page - 1)}
        disabled={page <= 1}
        label={t('previous')}
        icon={<ChevronLeft className="rtl-flip size-4" aria-hidden />}
      />

      {windowed.map((entry, index) =>
        entry === null ? (
          <span key={`gap-${index}`} className="px-2 text-muted-foreground">
            …
          </span>
        ) : (
          <Link
            key={entry}
            href={buildHref(entry)}
            aria-current={entry === page ? 'page' : undefined}
            className={cn(
              'numeral grid h-9 min-w-9 place-items-center rounded-md px-2 text-sm',
              entry === page
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted',
            )}
          >
            {entry}
          </Link>
        ),
      )}

      <PageLink
        href={buildHref(page + 1)}
        disabled={page >= pageCount}
        label={t('next')}
        icon={<ChevronRight className="rtl-flip size-4" aria-hidden />}
      />
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled
        className="grid size-9 place-items-center rounded-md text-muted-foreground opacity-40"
      >
        {icon}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className="grid size-9 place-items-center rounded-md hover:bg-muted"
    >
      {icon}
    </Link>
  );
}

/** First, last, and a window around the current page; null marks an ellipsis. */
function pageNumbers(page: number, pageCount: number): (number | null)[] {
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const current of sorted) {
    if (previous && current - previous > 1) out.push(null);
    out.push(current);
    previous = current;
  }
  return out;
}
