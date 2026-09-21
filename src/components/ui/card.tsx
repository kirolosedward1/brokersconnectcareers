import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A card is not the default container.
 *
 * It is justified by one of three things: the block is an object somebody can
 * act on as a whole (a listing, an applicant), it groups fields that are saved
 * together, or it lifts an action out of the flow of the page. Anything else —
 * a heading and the paragraphs under it, a list of rows, a page's sections —
 * is a plain `<section>` separated by space or a rule, because a page where
 * everything is boxed has no way left to say that one thing is different.
 *
 * Drawn with a border and no shadow: a card sits on the page, it does not
 * float over it. Never put one inside another.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold leading-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 p-5 pt-0', className)} {...props} />;
}
