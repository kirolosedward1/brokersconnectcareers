'use client';

import { Link } from '@/i18n/navigation';
import { track, type AnalyticsEvent } from '@/lib/analytics';

/**
 * One way into the board from the home page, and the record that it was used.
 *
 * A client component for the click alone. Everything around it — the counts,
 * the order, which rows exist — is decided on the server, and this renders as
 * an ordinary anchor, so the module works before hydration and a crawler or a
 * middle-click sees a link like any other.
 *
 * What is sent is the dimension and the taxonomy value: `primary`,
 * `new-cairo`, `developer`. Never anything about the reader.
 */
export function BrowseLink({
  href,
  event,
  value,
  className,
  children,
}: {
  href: { pathname: '/jobs'; query: Record<string, string> };
  event: Extract<
    AnalyticsEvent,
    | 'homepage_job_browse_location'
    | 'homepage_job_browse_category'
    | 'homepage_job_browse_company_type'
  >;
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => track(event, { value })}>
      {children}
    </Link>
  );
}
