import { Children } from 'react';
import { cn } from '@/lib/utils';

/**
 * A line of facts with a hairline between them, that wraps cleanly.
 *
 * The obvious way to write this — a `|` between each pair — breaks the moment
 * the line wraps, which on a phone is always: the separator belongs to neither
 * neighbour, so it is left dangling at the end of one line or stranded at the
 * start of the next.
 *
 * Here each fact carries its own rule on its leading edge, and the row is
 * pulled outward by exactly one fact's padding inside a clipping box. Whatever
 * lands first on a line has its rule pushed outside the box, where it is cut
 * off; every other fact keeps its own. No measuring, no JavaScript, and it
 * mirrors itself in RTL because everything is written in logical properties.
 *
 * Falsy children are dropped, so a caller can write `{condition ? … : null}`
 * without leaving an empty cell and a rule beside it.
 */
export function FactLine({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const facts = Children.toArray(children).filter(Boolean);
  if (facts.length === 0) return null;

  return (
    <div className={cn('overflow-hidden', className)}>
      <ul className="-ms-2.5 flex flex-wrap items-center gap-y-0.5">
        {facts.map((fact, index) => (
          <li
            key={index}
            className="relative inline-flex items-center px-2.5 before:absolute before:inset-y-[0.3em] before:start-0 before:w-px before:bg-border"
          >
            {fact}
          </li>
        ))}
      </ul>
    </div>
  );
}
