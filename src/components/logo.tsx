import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The mark is the two interlocking squares from the Brokers Connect logo,
 * cropped out of the supplied lockup so it can sit at any size next to a
 * wordmark rendered in the site font — the supplied lockup bakes in an Arabic
 * wordmark, which would be wrong on the English side of the site.
 */
/** `onDark` is the same mark with its colour knocked out to white. */
const MARK_SRC = {
  default: '/brand/logo-mark.png',
  onDark: '/brand/logo-mark-white.png',
} as const;

export function LogoMark({
  className,
  alt = '',
  tone = 'default',
}: {
  className?: string;
  alt?: string;
  tone?: keyof typeof MARK_SRC;
}) {
  return (
    <Image
      src={MARK_SRC[tone]}
      alt={alt}
      width={450}
      height={450}
      priority
      className={cn('size-8 shrink-0', className)}
    />
  );
}

export function Logo({
  name,
  className,
  markClassName,
  nameClassName,
  tone = 'default',
}: {
  name: string;
  className?: string;
  markClassName?: string;
  nameClassName?: string;
  /** White mark and wordmark, for a surface that stays dark in both themes. */
  tone?: 'default' | 'onDark';
}) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold', tone === 'onDark' && 'text-white', className)}>
      <LogoMark alt={name} className={markClassName} tone={tone} />
      {/* The wordmark stays at every width. It used to drop below sm, which
          left phones — most of this market — looking at two blue squares and
          no name. It fits: at 360px a visitor's row is the mark, the
          wordmark, a search icon and the menu button. The one exception is
          the site header for somebody signed in, below 360px, where the bell
          and the account take the room — see nameClassName there.
          Hidden from assistive tech: the mark's alt is the same name. */}
      <span aria-hidden className={cn('text-[0.95rem] sm:text-base', nameClassName)}>{name}</span>
    </span>
  );
}
