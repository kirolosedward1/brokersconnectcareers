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
}: {
  name: string;
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold', className)}>
      <LogoMark className={markClassName} />
      {/* The wordmark stays at every width. It used to drop below sm, which
          left phones — most of this market — looking at two blue squares and
          no name. It fits: at 360px the row is the mark, the wordmark, a
          search icon and the menu button, and nothing else competes for the
          space until sm, where the auth buttons appear. */}
      <span className="text-[0.95rem] sm:text-base">{name}</span>
    </span>
  );
}
