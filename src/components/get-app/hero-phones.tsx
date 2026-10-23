import { PhoneFrame } from '@/components/get-app/phone-frame';

/**
 * The hero's three phones, fanned: Home in front and centred, floating; the
 * board and a listing behind it, each turned a few degrees, a little smaller
 * and a little dimmer, with the brand's glow behind all three.
 *
 * The box is sized by its width (an aspect ratio), so the composition scales
 * as one thing. It is narrower on a phone than the column it sits in, and
 * the two behind are tucked in from its edges, so their turned corners stay
 * inside the screen rather than being cut off by it.
 *
 * The two behind are decoration — the tour below shows the same screens
 * with their names — so only the front one is described.
 */
export function HeroPhones({
  front,
  left,
  right,
  alt,
  className,
}: {
  front: string;
  left: string;
  right: string;
  /** What the front phone shows. */
  alt: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="relative mx-auto aspect-[17/20] w-full max-w-[19rem] sm:max-w-[26rem] lg:max-w-[34rem]">
        <div
          aria-hidden
          className="absolute inset-x-[5%] top-[12%] bottom-[8%] -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-blue)_38%,transparent),transparent)]"
        />
        <PhoneFrame
          src={left}
          decorative
          sizes="(min-width: 1024px) 15rem, 34vw"
          className="absolute left-[4%] top-[10%] w-[40%] -rotate-[8deg] opacity-80"
        />
        <PhoneFrame
          src={right}
          decorative
          sizes="(min-width: 1024px) 15rem, 34vw"
          className="absolute right-[4%] top-[10%] w-[40%] rotate-[8deg] opacity-80"
        />
        <div className="absolute left-1/2 top-0 z-10 w-[52%] -translate-x-1/2 motion-safe:animate-float">
          <PhoneFrame src={front} alt={alt} priority sizes="(min-width: 1024px) 18rem, 46vw" />
        </div>
      </div>
    </div>
  );
}
