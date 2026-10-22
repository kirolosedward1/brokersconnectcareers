'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { PhoneFrame, Screenshot, stackedScreen } from '@/components/get-app/phone-frame';

export type Screen = { src: string; alt: string };

/**
 * The phone in the hero: held up, drifting a little, turning toward the
 * pointer, and showing the app's first screens one after another.
 *
 * Three kinds of motion, each with its off switch:
 *
 *   - The float is a CSS keyframe on the outer wrapper, 6px over 6s, which
 *     `prefers-reduced-motion` stops with the rest of the site's animation.
 *   - The tilt follows the pointer on devices that have one (`hover: hover`,
 *     `pointer: fine`), a few degrees at most, through two custom properties
 *     set once per frame; a finger does not tilt it, and reduced motion does
 *     not either.
 *   - The screens cross-fade every four seconds, pausing while the pointer is
 *     over the phone, while a dot has focus, while the tab is hidden, and
 *     not at all under reduced motion — a reader who asked for stillness
 *     gets the Home screen and the dots.
 *
 * The dots are buttons (one per screen, 44px tall), shown from `lg`; below
 * that the phone is cropped by the band and the walkthrough under it carries
 * the controls.
 */
export function HeroPhone({
  screens,
  sizes,
  dotLabels,
  className,
}: {
  screens: Screen[];
  sizes: string;
  /** One per screen: "Show screen 2 of 3", in the page's language. */
  dotLabels: string[];
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const paused = useRef(false);
  const tilt = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (screens.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      if (document.hidden || paused.current) return;
      setActive((index) => (index + 1) % screens.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [screens.length]);

  useEffect(() => {
    const element = tilt.current;
    if (!element) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const move = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        element.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
        element.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      element.style.setProperty('--rx', '0deg');
      element.style.setProperty('--ry', '0deg');
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div
      className={className}
      onPointerEnter={() => {
        paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
      }}
      onFocus={() => {
        paused.current = true;
      }}
      onBlur={() => {
        paused.current = false;
      }}
    >
      <div className="motion-safe:animate-float">
        <div
          ref={tilt}
          className="[transform:perspective(1200px)_rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))] transition-transform duration-300 ease-out motion-reduce:transition-none"
        >
          <PhoneFrame>
            {screens.map((screen, index) => (
              <Screenshot
                key={screen.src}
                src={screen.src}
                alt={screen.alt}
                sizes={sizes}
                priority={index === 0}
                hidden={index !== active}
                className={stackedScreen(index === active)}
              />
            ))}
          </PhoneFrame>
        </div>
      </div>

      {screens.length > 1 ? (
        <div className="mt-5 hidden justify-center gap-1 lg:flex">
          {screens.map((screen, index) => (
            <button
              key={screen.src}
              type="button"
              aria-label={dotLabels[index]}
              aria-pressed={index === active}
              onClick={() => setActive(index)}
              className="grid h-11 w-8 place-items-center rounded-lg"
            >
              <span
                aria-hidden
                className={cn(
                  'block h-1.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none',
                  index === active ? 'w-6 bg-white' : 'w-1.5 bg-white/40 group-hover:bg-white/60',
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
