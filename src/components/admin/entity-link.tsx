'use client';

import type { ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * A name inside a row that is itself a link.
 *
 * The row's stretched link sits underneath. This one is above it, and the
 * click stops there, so opening the company does not also open the listing.
 */
export function EntityLink({ className, onClick, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={cn('relative z-10 hover:underline underline-offset-4', className)}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    />
  );
}
