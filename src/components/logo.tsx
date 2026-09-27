import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The mark is the two interlocking squares from the Brokers Connect logo,
 * cropped out of the supplied lockup so it can sit at any size next to a
 * wordmark rendered in the site font — the supplied lockup bakes in an Arabic
 * wordmark, which would be wrong on the English side of the site.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/logo-mark.png"
      alt=""
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
}: {
  name: string;
  className?: string;
  markClassName?: string;
  nameClassName?: string;
}) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold', className)}>
      <LogoMark className={markClassName} />
      {/* The wordmark stays at every width. It used to drop below sm, which
          left phones — most of this market — looking at two blue squares and
          no name. It fits: at 360px a visitor's row is the mark, the
          wordmark, a search icon and the menu button. The one exception is
          the site header for somebody signed in, below 360px, where the bell
          and the account take the room — see nameClassName there. */}
      <span className={cn('text-[0.95rem] sm:text-base', nameClassName)}>{name}</span>
    </span>
  );
}
