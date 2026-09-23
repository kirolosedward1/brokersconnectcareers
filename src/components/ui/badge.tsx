import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A tag, for state — not a pill, and not for facts.
 *
 * A badge earns its fill by saying something that can change or that the
 * reader must not miss: an application's stage, a listing's moderation status,
 * a verified company. A fact about a thing — its district, its track, how many
 * seats — is text, set in a line with the other facts, because a row of six
 * equally loud lozenges is a row in which nothing is loud.
 *
 * Square-cornered on purpose. Fully rounded, every one of these read as a
 * button, and on a results page there were forty of them that were not.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        primary: 'border-transparent bg-primary/10 text-primary',
        success: 'border-transparent bg-success-muted text-success',
        warning: 'border-transparent bg-warning-muted text-warning',
        destructive: 'border-transparent bg-destructive-muted text-destructive',
        accent: 'border-transparent bg-accent text-accent-foreground',
      },
      size: {
        default: 'text-xs',
        lg: 'px-2 py-0.5 text-[13px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
