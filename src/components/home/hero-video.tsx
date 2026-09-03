'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The hero's background film. Always present, always looping.
 *
 * It used to load only on a fast desktop connection, because the file is 13 MB
 * and that is a real cost on a Cairo mobile plan. That gating is gone by
 * request: the film is now part of the design everywhere, so the fix for the
 * weight is to compress the file, not to hide it.
 *
 * The one thing still honoured is prefers-reduced-motion, and even that does
 * not remove the video — it holds it on its first frame. Somebody who has
 * asked their system for less motion gets the image without the movement,
 * which is the accessible reading of "always there" rather than an exception
 * to it.
 */
export function HeroVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const apply = () => {
      if (reduced.matches) {
        video.pause();
        return;
      }
      // Autoplay can be refused — a fresh tab in the background, iOS in low
      // power mode — and the promise rejects rather than throwing. Asking
      // again on the next interaction is the whole recovery.
      void video.play().catch(() => {});
    };

    apply();
    reduced.addEventListener('change', apply);

    // A tab restored from the background often comes back paused.
    const onVisible = () => {
      if (document.visibilityState === 'visible') apply();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      reduced.removeEventListener('change', apply);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      // Muted autoplay needs the data before it can start; `metadata` would
      // leave the first frame stalled on a slow connection.
      preload="auto"
      aria-hidden
      tabIndex={-1}
      onCanPlay={() => setReady(true)}
      onLoadedData={() => setReady(true)}
      className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ${
        ready ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}
