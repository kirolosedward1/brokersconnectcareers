'use client';

import { useEffect, useState } from 'react';

/**
 * The hero's background film — loaded only when it is not a tax on the reader.
 *
 * The file is 13 MB. On a Cairo 4G connection that is several seconds of the
 * visitor's data allowance spent on decoration, before they have seen a single
 * job. So it is not in the markup at all until the client has said it can
 * afford it, and the gradient underneath is the real design rather than a
 * placeholder: on a phone, on a metered connection, or for anyone who has
 * asked their system for less motion, the gradient is simply what the hero
 * looks like, and nothing is missing.
 *
 * Everything here fails toward not downloading. An unknown connection is
 * treated as an expensive one.
 */
export function HeroVideo({ src }: { src: string }) {
  const [play, setPlay] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // A phone is both the likeliest metered connection and the screen where a
    // wide landscape shot is mostly cropped away.
    if (window.matchMedia('(max-width: 1023px)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;

    if (connection?.saveData) return;
    if (connection?.effectiveType && !/4g/.test(connection.effectiveType)) return;

    setPlay(true);
  }, []);

  if (!play) return null;

  return (
    <video
      src={src}
      autoPlay
      muted
      loop
      playsInline
      // The gradient is already painted; this only has to arrive eventually.
      preload="none"
      aria-hidden
      tabIndex={-1}
      onCanPlay={() => setReady(true)}
      className={`absolute inset-0 size-full object-cover transition-opacity duration-1000 ${
        ready ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}
