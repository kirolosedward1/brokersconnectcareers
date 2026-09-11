import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The hit area for an icon-only control that cannot be a `<Button>`.
 *
 * `size` below settles this for buttons: 44px, because that is the touch
 * target this market's overwhelmingly mobile traffic needs. Several controls
 * cannot use it — a bookmark toggle that has to sit above a card's stretched
 * link, a pagination arrow that is a `<Link>`, the magnifier on an applicant
 * card — and every one of them had been written as `size-9`, which is 36px, on
 * the surfaces a thumb aims at most.
 *
 * A string rather than a number, so the rule travels with the class list
 * instead of being remembered. Tailwind scans this file like any other, so the
 * classes are generated.
 */
export const ICON_HIT_AREA = 'grid size-11 place-items-center';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium ' +
    'transition-[background-color,box-shadow,transform,border-color] duration-150 ' +
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ' +
    'motion-reduce:transition-none motion-reduce:active:translate-y-0 ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[var(--shadow-primary)] hover:bg-primary-hover',
        outline:
          'border border-border bg-card shadow-xs hover:border-primary/40 hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/70',
        ghost: 'hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:opacity-90',
        success: 'bg-success text-success-foreground shadow-sm hover:opacity-90',
      },
      // 44px, not 40. Two reasons that point the same way: it is the touch
      // target this market's overwhelmingly mobile traffic needs, and it is
      // the height of Input and Select, so a button beside a field now lines
      // up with it instead of sitting 4px short. `sm` stays small on purpose —
      // it is the size for table rows and secondary chrome, where a full-height
      // button would shout.
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-12 rounded-xl px-6 text-base',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
