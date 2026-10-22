import { cn } from '@/lib/utils';

/**
 * A section's opening: the eyebrow in the accent colour, the heading, and
 * at most one short paragraph under it.
 *
 * `tone` is the ground it sits on. On a dark section the eyebrow is the
 * brand cyan (the brand blue is under 3:1 on that ground) and the body is
 * white at three quarters. `adaptive` is for the one section whose ground
 * changes while you watch — the appearance switch — and reads the wrapper's
 * `data-appearance` instead.
 */
export function SectionHeader({
  id,
  eyebrow,
  title,
  body,
  tone = 'light',
  adaptive = false,
  align = 'start',
  className,
}: {
  /** The heading's id, for the section's aria-labelledby. */
  id: string;
  eyebrow?: string;
  title: string;
  body?: string;
  tone?: 'light' | 'dark';
  adaptive?: boolean;
  align?: 'start' | 'center';
  className?: string;
}) {
  const dark = tone === 'dark';

  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow ? (
        <p
          className={cn(
            'text-sm font-semibold',
            dark ? 'text-brand-cyan' : 'text-primary',
            adaptive && 'group-data-[appearance=dark]:text-brand-cyan',
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        id={id}
        className={cn(
          'mt-3 text-[clamp(1.75rem,1.3rem+1.8vw,3rem)] font-bold leading-tight text-balance',
          adaptive && 'transition-colors duration-700 group-data-[appearance=dark]:text-white',
        )}
      >
        {title}
      </h2>
      {body ? (
        <p
          className={cn(
            'mt-4 text-[1.0625rem] leading-relaxed sm:text-lg',
            dark ? 'text-white/75' : 'text-muted-foreground',
            adaptive && 'transition-colors duration-700 group-data-[appearance=dark]:text-white/75',
          )}
        >
          {body}
        </p>
      ) : null}
    </div>
  );
}
