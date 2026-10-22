import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * An iPhone, drawn in CSS, with whatever is handed to it on the screen.
 *
 * Drawn rather than photographed so it scales to whatever box it is given
 * and holds any capture: every dimension inside is a container-query unit
 * (`cqw`, a hundredth of the frame's own width), so the rim, the bezel, the
 * corners and the Dynamic Island keep their proportions from a 13rem tile to
 * the hero. Three layers, as the phone has: a titanium rim lit from one
 * corner, the black bezel inside it, and the screen, with a faint glass
 * reflection across its top. The shape is the current one — flat sides, the
 * pill at the top of the screen, four side buttons — which is the phone the
 * captures were taken on (an iPhone 17 Pro Max simulator).
 *
 * The buttons sit on physical sides on purpose: a device does not mirror
 * when the page is right to left, and `left`/`right` here is the drawing,
 * not the layout.
 *
 * What goes on the screen is the children — one `Screenshot`, or several
 * stacked for a cross-fade — so the frame knows nothing about which capture
 * is showing.
 */

/** The captures: 1320×2868 from the simulator, kept at 1179 wide (scripts in docs/app-page.md). */
export const SCREENSHOT = { width: 1179, height: 2562 } as const;

export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  const button = 'absolute w-[0.9cqw] bg-[linear-gradient(90deg,#55555c,#2a2a2e)]';

  return (
    <div className={cn('@container', className)}>
      <div className="relative aspect-[1179/2562] rounded-[13.5cqw] bg-[linear-gradient(160deg,#5a5a62_0%,#232327_22%,#1a1a1e_70%,#46464d_100%)] p-[1.1cqw] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6),0_0_0_0.5px_rgba(255,255,255,0.28)]">
        {/* Action, volume up, volume down; then the side button. */}
        <span aria-hidden className={cn(button, '-left-[0.9cqw] top-[16cqw] h-[4.2cqw] rounded-l-[0.45cqw]')} />
        <span aria-hidden className={cn(button, '-left-[0.9cqw] top-[24cqw] h-[8.4cqw] rounded-l-[0.45cqw]')} />
        <span aria-hidden className={cn(button, '-left-[0.9cqw] top-[35cqw] h-[8.4cqw] rounded-l-[0.45cqw]')} />
        <span aria-hidden className={cn(button, '-right-[0.9cqw] top-[28cqw] h-[13cqw] rounded-r-[0.45cqw]')} />

        <div className="h-full w-full rounded-[12.4cqw] bg-[#0a0a0c] p-[1.5cqw]">
          <div className="relative h-full w-full overflow-hidden rounded-[10.9cqw] bg-black">
            {children}

            {/* The Dynamic Island, over the capture's status bar. */}
            <span
              aria-hidden
              className="absolute left-1/2 top-[2.4cqw] z-10 h-[7.2cqw] w-[29cqw] -translate-x-1/2 rounded-full bg-black"
            />
            {/* Glass: a soft light across the top corner, as a screen catches the room. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(118deg,rgba(255,255,255,0.11)_0%,rgba(255,255,255,0.035)_28%,transparent_52%)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One capture on the screen. Fills the screen box; several stacked, with
 * only one at full opacity, make a cross-fade. `hidden` takes the ones not
 * showing out of what a screen reader meets.
 */
export function Screenshot({
  src,
  alt,
  sizes,
  priority = false,
  hidden = false,
  className,
}: {
  src: string;
  alt: string;
  /** What the layout gives the frame, so a 15rem tile is not a 1179px download. */
  sizes: string;
  /** Only for the one above the fold. */
  priority?: boolean;
  hidden?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      aria-hidden={hidden || undefined}
      className={cn('object-cover', className)}
    />
  );
}

/** The classes a stacked capture takes as it shows or hides: a 500ms cross-fade with a touch of zoom. */
export function stackedScreen(showing: boolean): string {
  return cn(
    'transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none',
    showing ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.03]',
  );
}
