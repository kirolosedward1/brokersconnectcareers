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
      <span className="hidden sm:inline">{name}</span>
    </span>
  );
}
