'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';

export type FaqItem = { key: string; question: string; answer: React.ReactNode };

/**
 * The questions, one open at a time. Each is a heading holding a button
 * (`aria-expanded`, `aria-controls`) over a region that opens by growing
 * its grid row from nothing — the one way to animate height without
 * measuring it.
 */
export function Faq({ items, className }: { items: FaqItem[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const idBase = useId();

  return (
    <div className={cn('divide-y divide-border rounded-[1.5rem] border border-border bg-card', className)}>
      {items.map((item) => {
        const expanded = open === item.key;
        const buttonId = `${idBase}-${item.key}-q`;
        const panelId = `${idBase}-${item.key}-a`;
        return (
          <div key={item.key}>
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => {
                  const next = expanded ? null : item.key;
                  setOpen(next);
                  if (next) track('app_faq_open', { question: item.key });
                }}
                className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-start text-[1.0625rem] font-semibold transition-colors hover:bg-muted/50 sm:px-6"
              >
                {item.question}
                <ChevronDown
                  className={cn(
                    'size-5 shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none',
                    expanded && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              // Closed, the answer is still in the document (its row is just
              // zero tall), so `inert` keeps the keyboard and screen readers
              // from reaching a link inside it.
              inert={!expanded}
              className={cn(
                'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
                expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className="overflow-hidden">
                <div className="px-5 pb-5 leading-relaxed text-muted-foreground sm:px-6">{item.answer}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
