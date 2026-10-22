'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { PhoneFrame, Screenshot, stackedScreen } from '@/components/get-app/phone-frame';

export type Appearance = { key: string; label: string; src: string; alt: string };

/**
 * One phone and a three-way switch — light, dark, large text — that
 * cross-fades between real captures of the same screen.
 *
 * A group of radio buttons drawn as a segmented control: the arrow keys move
 * between them as they do in any radio group, the chosen one is the one the
 * phone shows, and the ring lands on the label since the input itself is
 * visually hidden.
 */
export function AppearanceSwitch({
  legend,
  options,
  className,
}: {
  legend: string;
  options: Appearance[];
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const name = useId();

  return (
    <div className={className}>
      <fieldset className="mx-auto flex w-fit max-w-full gap-1 rounded-xl border border-border bg-card p-1">
        <legend className="sr-only">{legend}</legend>
        {options.map((option, index) => (
          <label
            key={option.key}
            className={cn(
              'relative inline-flex min-h-11 cursor-pointer items-center rounded-lg px-4 text-sm font-medium transition-colors duration-200 motion-reduce:transition-none',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              index === active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.key}
              checked={index === active}
              onChange={() => setActive(index)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="mx-auto mt-8 w-56 sm:w-64">
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
  );
}
