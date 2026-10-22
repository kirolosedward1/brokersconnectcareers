import { cn } from '@/lib/utils';

/**
 * A section's opening: the eyebrow in the accent colour, the heading, and
 * at most one short paragraph under it.
 *
 * Centred on phones and tablets, where the section is one column and
 * everything under the heading is centred too; from `lg`, where the
 * section is two columns, it sits at the start of its column unless
 * `align` says centre.
 *
 * `tone` is the ground it sits on. On a dark section the eyebrow is the
 * brand cyan (the brand blue is under 3:1 on that ground) and the body is
 * white at three quarters.
 */
export function SectionHeader({
  id,
  eyebrow,
  title,
  body,
  tone = 'light',
  align = 'start',
  className,
}: {
  /** The heading's id, for the section's aria-labelledby. */
  id: string;
  eyebrow?: string;
  title: string;
  body?: string;
  tone?: 'light' | 'dark';
  align?: 'start' | 'center';
  className?: string;
}) {
  const dark = tone === 'dark';

  return (
    <div
      className={cn(
        'mx-auto max-w-2xl text-center',
        align === 'start' && 'lg:mx-0 lg:text-start',
        className,
      )}
    >
      {eyebrow ? (
        <p className={cn('text-sm font-semibold', dark ? 'text-brand-cyan' : 'text-primary')}>{eyebrow}</p>
      ) : null}
      <h2 id={id} className="mt-3 text-[clamp(1.75rem,1.3rem+1.8vw,3rem)] font-bold leading-tight text-balance">
        {title}
      </h2>
      {body ? (
        <p
          className={cn(
            'mt-4 text-[1.0625rem] leading-relaxed sm:text-lg',
            dark ? 'text-white/75' : 'text-muted-foreground',
          )}
        >
          {body}
        </p>
      ) : null}
    </div>
  );
}
