import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * A company's mark, wherever its name appears.
 *
 * Most companies here have not uploaded one, and a generic building icon
 * repeated down a list is worse than no image at all — every row looks the
 * same, so the eye has nothing to catch. The fallback is a monogram on a
 * tinted ground instead, tinted deterministically from the slug, so a
 * directory of logo-less companies is still scannable and a company keeps the
 * same colour on every page it appears on.
 *
 * The four tints are theme tokens rather than generated hues: a hash-to-hue
 * function eventually lands on something that clashes with the brand or fails
 * contrast, and four colours are enough to break up a list.
 */
const TINTS = [
  'bg-primary/10 text-primary',
  'bg-accent text-accent-foreground',
  'bg-success-muted text-success',
  'bg-warning-muted text-warning',
] as const;

const SIZES = {
  sm: { box: 'size-10 rounded-lg', text: 'text-sm', px: 40 },
  md: { box: 'size-12 rounded-xl', text: 'text-base', px: 48 },
  lg: { box: 'size-16 rounded-xl', text: 'text-xl', px: 64 },
} as const;

/** Stable across renders and servers — no Math.random, no Date. */
function tintFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export function CompanyLogo({
  name,
  logoUrl,
  /** Whatever is stable per company — the slug. Decides the fallback tint. */
  seed,
  size = 'md',
  className,
}: {
  name: string;
  logoUrl?: string | null;
  seed?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];

  if (logoUrl) {
    return (
      <span
        className={cn(
          'relative grid shrink-0 place-items-center overflow-hidden border border-border bg-white',
          s.box,
          className,
        )}
      >
        {/* contain, not cover: a logo cropped to fill a square is a logo with
            its name cut off. The white ground is deliberate — most supplied
            marks are drawn for one, and they disappear on a dark card. */}
        <Image
          src={logoUrl}
          alt=""
          width={s.px}
          height={s.px}
          className="size-full object-contain p-1"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center font-bold',
        s.box,
        s.text,
        tintFor(seed || name),
        className,
      )}
    >
      {name.trim().charAt(0)}
    </span>
  );
}
