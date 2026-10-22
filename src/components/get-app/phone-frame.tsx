import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * An iPhone, drawn in CSS, with a screenshot on its screen.
 *
 * Drawn rather than photographed so it scales to whatever box it is given
 * and takes any screenshot: every dimension inside is a container-query unit
 * (`cqw`, a hundredth of the frame's own width), so the bezel, the corners
 * and the Dynamic Island keep their proportions from a 13rem gallery tile to
 * the hero. The frame is the current shape — flat sides, a pill at the top of
 * the screen, four side buttons — which is the phone the App Store screenshots
 * are taken on.
 *
 * The buttons sit on physical sides on purpose: a device does not mirror when
 * the page is right to left, and `left`/`right` here is the drawing, not the
 * layout.
 */

/** The screenshots are iPhone 6.9-inch captures, the size App Store Connect asks for. */
export const SCREENSHOT = { width: 1179, height: 2556 } as const;

export function PhoneFrame({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  src: string;
  /** What the screen shows, for somebody who cannot see it. */
  alt: string;
  /** What the layout gives the frame, so a 15rem tile is not a 1179px download. */
  sizes: string;
  /** Only for the one above the fold. */
  priority?: boolean;
  className?: string;
}) {
  const button = 'absolute w-[0.8cqw] bg-[#2c2c31]';

  return (
    <div className={cn('@container', className)}>
      <div className="relative aspect-[1179/2556] rounded-[13.5cqw] bg-[#1b1b1f] p-[2.6cqw] shadow-lg ring-1 ring-white/15">
        {/* Action, volume up, volume down; then the side button. */}
        <span aria-hidden className={cn(button, '-left-[0.8cqw] top-[16cqw] h-[4.2cqw] rounded-l-[0.4cqw]')} />
        <span aria-hidden className={cn(button, '-left-[0.8cqw] top-[24cqw] h-[8.4cqw] rounded-l-[0.4cqw]')} />
        <span aria-hidden className={cn(button, '-left-[0.8cqw] top-[35cqw] h-[8.4cqw] rounded-l-[0.4cqw]')} />
        <span aria-hidden className={cn(button, '-right-[0.8cqw] top-[28cqw] h-[13cqw] rounded-r-[0.4cqw]')} />

        <div className="relative h-full w-full overflow-hidden rounded-[10.9cqw] bg-black">
          <Image
            src={src}
            alt={alt}
            width={SCREENSHOT.width}
            height={SCREENSHOT.height}
            sizes={sizes}
            priority={priority}
            className="h-full w-full object-cover"
          />
          {/* The Dynamic Island, over the screenshot's status bar. */}
          <span
            aria-hidden
            className="absolute left-1/2 top-[2.4cqw] h-[7.2cqw] w-[29cqw] -translate-x-1/2 rounded-full bg-black"
          />
        </div>
      </div>
    </div>
  );
}
