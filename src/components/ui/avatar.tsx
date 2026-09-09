'use client';

import { useState } from 'react';

/**
 * A person, as a circle.
 *
 * Three call sites were each drawing their own monogram — the same nine
 * classes and the same `name.trim().charAt(0)` — and none of them rendered the
 * photo the profile already holds. This does both, from one place.
 *
 * The photo is a plain <img> rather than next/image on purpose. `avatar_url`
 * is only ever populated from an OAuth provider's user_metadata, so its host
 * is Google's, and next.config only allowlists Supabase storage: next/image
 * would answer 400 for every avatar the platform actually has. It also 403s
 * from time to time on its own, hence the fallback to the monogram rather than
 * a broken-image glyph inside the circle.
 *
 * Colour identifies the person, not their state. A column of identical brand
 * circles tells the eye nothing, so the hue is derived from a stable seed and
 * stays put across sessions and pages. The palette deliberately spans only the
 * cyan→magenta arc: green, amber and red are what the status badge beside it
 * uses to mean hired, expiring and rejected, and an avatar that happens to be
 * green must not read as a decision.
 */

const HUES = [266, 300, 330, 215, 240, 190];

function hueFor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return HUES[Math.abs(hash) % HUES.length];
}

/**
 * Array.from, not charAt: an Arabic name is fine either way, but charAt splits
 * a surrogate pair down the middle and renders half a character.
 */
function initialOf(name: string) {
  return Array.from(name.trim())[0] ?? '؟';
}

const SIZES = {
  sm: 'size-9 text-sm',
  md: 'size-11 text-base',
  lg: 'size-16 text-2xl',
} as const;

export function Avatar({
  name,
  src,
  seed,
  size = 'sm',
  className,
}: {
  name: string;
  /** The profile photo, when there is one. */
  src?: string | null;
  /** What the colour is derived from. Defaults to the name. */
  seed?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const shape = `grid shrink-0 place-items-center overflow-hidden rounded-full font-bold ${SIZES[size]}`;

  if (src && !failed) {
    return (
      <span aria-hidden className={`${shape} bg-muted ${className ?? ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      </span>
    );
  }

  // One lightness for both themes: the chip paints its own ground, so it does
  // not borrow the page's and does not need a dark variant.
  const hue = hueFor(seed || name);

  return (
    <span
      aria-hidden
      className={`${shape} text-white ${className ?? ''}`}
      style={{ backgroundColor: `oklch(0.55 0.12 ${hue})` }}
    >
      {initialOf(name)}
    </span>
  );
}
