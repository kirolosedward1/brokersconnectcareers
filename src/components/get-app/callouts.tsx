import { cn } from '@/lib/utils';
import { PhoneFrame } from '@/components/get-app/phone-frame';
import { Reveal } from '@/components/get-app/reveal';

/**
 * The listing's capture with three chips pointing at the three facts on it:
 * the basic salary, the commission, the lead source.
 *
 * From `sm` the chips float beside the phone, each with a thin line to the
 * row it names, arriving one after another; the positions are a share of
 * the phone's height, measured off the capture. Below `sm` there is no room
 * beside a phone, so the same three sit in a row under it. One set is laid
 * out at a time, so a screen reader meets the three once.
 */
export function Callouts({
  src,
  alt,
  chips,
  className,
}: {
  src: string;
  alt: string;
  /** The three, in order: salary, commission, leads. */
  chips: readonly [string, string, string];
  className?: string;
}) {
  const [salary, commission, leads] = chips;

  const chip =
    'inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur';
  const dot = 'size-1.5 shrink-0 rounded-full bg-brand-cyan';
  /** A chip beside the phone: absolute, with its line toward the screen (physical sides: the capture's own). */
  const floating = 'absolute hidden whitespace-nowrap sm:block';
  const lineRight = 'before:absolute before:top-1/2 before:right-full before:h-px before:w-6 before:bg-white/40';
  const lineLeft = 'before:absolute before:top-1/2 before:left-full before:h-px before:w-6 before:bg-white/40';

  return (
    <div className={cn('mx-auto w-fit', className)}>
      <div className="relative">
        <div
          aria-hidden
          className="absolute -inset-x-16 -inset-y-8 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-blue)_45%,transparent),transparent)]"
        />
        <PhoneFrame src={src} alt={alt} sizes="(min-width: 640px) 17rem, 15rem" className="w-60 sm:w-[17rem]" />

        {/* The salary is the first row of the pay card; the commission sits
            on the right half of the second row and the lead source on its
            left half, which is why those two share a height. */}
        <Reveal className={cn(floating, 'left-full top-[44%] ml-6', lineRight)}>
          <span className={chip}>
            <span className={dot} aria-hidden />
            {salary}
          </span>
        </Reveal>
        <Reveal delay={160} className={cn(floating, 'left-full top-[57%] ml-6', lineRight)}>
          <span className={chip}>
            <span className={dot} aria-hidden />
            {commission}
          </span>
        </Reveal>
        <Reveal delay={320} className={cn(floating, 'right-full top-[57%] mr-6', lineLeft)}>
          <span className={chip}>
            <span className={dot} aria-hidden />
            {leads}
          </span>
        </Reveal>
      </div>

      <ul className="mt-6 flex flex-wrap justify-center gap-2 sm:hidden">
        {chips.map((label) => (
          <li key={label} className={chip}>
            <span className={dot} aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
