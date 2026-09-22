'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One column of the footer's index.
 *
 * On a phone it is closed until tapped. Four groups of five links, two to a
 * row, was a wall of thirty small targets under every page — taller than the
 * page's own content on a short one — and almost nobody on a phone is looking
 * for the terms of use from the bottom of a job listing. Closed, the footer is
 * four headings; open, one group at a time.
 *
 * From `lg` the same markup is a plain heading over a plain list, always open,
 * and the button is not rendered — a pointer does not need an accordion and a
 * screen reader should not be offered a control that does nothing.
 */
export function FooterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <nav aria-label={title} className="border-b border-border lg:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-12 w-full items-center justify-between gap-3 text-start text-sm font-semibold lg:hidden"
      >
        {title}
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      <p className="hidden text-sm font-semibold lg:block">{title}</p>

      <div id={panelId} className={cn('pb-3 lg:block lg:pb-0', open ? 'block' : 'hidden')}>
        {children}
      </div>
    </nav>
  );
}
