'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import { PhoneFrame, Screenshot, stackedScreen } from '@/components/get-app/phone-frame';

export type Appearance = { key: string; label: string; src: string; alt: string };

/**
 * One phone and a three-way switch — light, dark, large text — that
 * cross-fades between real captures of the same screen. The section's own
 * ground follows: it darkens while "dark" is chosen, which is why this
 * owns the section's inner wrapper and marks it with `data-appearance` for
 * the header inside to read.
 *
 * A group of radio buttons drawn as a segmented control: the arrow keys
 * move between them as in any radio group, and the ring lands on the label
 * since the input itself is visually hidden.
 */
export function AppearanceSwitcher({
  legend,
  options,
  children,
  className,
}: {
  legend: string;
  options: Appearance[];
  /** The section's header, which adapts to the ground (SectionHeader `adaptive`). */
  children: React.ReactNode;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const name = useId();
  const dark = options[active]?.key === 'dark';

  return (
    <div
      data-appearance={dark ? 'dark' : 'light'}
      className={cn(
        'group overflow-hidden transition-colors duration-700 motion-reduce:transition-none',
        dark ? 'bg-[#0d1117]' : 'bg-muted/40',
        className,
      )}
    >
      <div className="shell grid gap-10 py-16 sm:py-24 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-32">
        {children}

        <div>
          <fieldset
            className={cn(
              'mx-auto flex w-fit max-w-full gap-1 rounded-xl border p-1 transition-colors duration-700',
              dark ? 'border-white/15 bg-white/5' : 'border-border bg-card',
            )}
          >
            <legend className="sr-only">{legend}</legend>
            {options.map((option, index) => (
              <label
                key={option.key}
                className={cn(
                  'relative inline-flex min-h-11 cursor-pointer items-center rounded-lg px-4 text-sm font-medium transition-colors duration-200 motion-reduce:transition-none',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                  index === active
                    ? 'bg-primary text-primary-foreground'
                    : dark
                      ? 'text-white/80 hover:bg-white/10'
                      : 'hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.key}
                  checked={index === active}
                  onChange={() => {
                    setActive(index);
                    track('app_appearance_toggle', { appearance: option.key });
                  }}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          <div className="relative mx-auto mt-8 w-56 sm:w-64">
            <div
              aria-hidden
              className="absolute -inset-x-16 -inset-y-8 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-blue)_32%,transparent),transparent)]"
            />
            <PhoneFrame>
              {options.map((option, index) => (
                <Screenshot
                  key={option.key}
                  src={option.src}
                  alt={option.alt}
                  sizes="16rem"
                  hidden={index !== active}
                  className={stackedScreen(index === active)}
                />
              ))}
            </PhoneFrame>
          </div>
        </div>
      </div>
    </div>
  );
}
