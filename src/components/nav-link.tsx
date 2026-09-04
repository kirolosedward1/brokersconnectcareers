'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * A header link that knows whether you are already there.
 *
 * The header is a server component, and the current path is only knowable in
 * the browser — so this is the one piece of it that runs client-side. It stays
 * a link either way; the active state is styling and an `aria-current`, not a
 * different element.
 *
 * A section matches its children: /jobs is still the active nav item while
 * reading /jobs/some-listing. Exact matching would leave the header looking
 * like you had navigated away from the section you are inside.
 *
 * Active has to be legible in both of the header's skins — dark type on a
 * white bar, white type on the hero film — so it is defined twice rather than
 * relying on one tint to work against both.
 */
export function NavLink({
  href,
  className,
  block = false,
  children,
}: {
  href: string;
  className?: string;
  /** The phone menu stacks its links; the desktop row does not. */
  block?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-lg px-3 py-2 transition-colors',
        block ? 'block text-sm' : '',
        active
          ? 'bg-primary/10 font-medium text-primary group-data-[over-hero]/header:bg-white/20 group-data-[over-hero]/header:text-white'
          : 'hover:bg-muted group-data-[over-hero]/header:hover:bg-white/15',
        className,
      )}
    >
      {children}
    </Link>
  );
}
