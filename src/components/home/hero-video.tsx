'use client';

import { useEffect, useRef } from 'react';

/**
 * The hero's background film. Always present, always looping.
 *
 * It used to load only on a fast desktop connection, because the file was
 * 12 MB and that is a real cost on a Cairo mobile plan. The gating went by
 * request — the film is part of the design everywhere — with the note that the
 * fix for the weight was to compress the file rather than hide it. That is now
 * done: 1.8 MB at the same 1280x720, and no audio track, since a muted
 * background video's audio is bytes nobody ever hears.
 *
 * The poster is what makes the compression safe to lean on. It paints
 * immediately, so the hero is never a bare gradient waiting on a download, and
 * it is the frame the video itself starts on — the handover is invisible.
 *
 * The one thing still honoured is prefers-reduced-motion, and even that does
 * not remove the video — it holds it on its first frame. Somebody who has
 * asked their system for less motion gets the image without the movement,
 * which is the accessible reading of "always there" rather than an exception
 * to it.
 */
export function HeroVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);

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
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      // Muted autoplay needs the data before it can start; `metadata` would
      // leave the first frame stalled on a slow connection. Affordable now
      // that the file is 1.8 MB rather than 12.
      preload="auto"
      aria-hidden
      tabIndex={-1}
      // No load-state tracking and no fade. The element carries the poster, so
      // it is painted from the first frame and there is nothing to fade in
      // from — the video simply starts moving when it arrives. What used to be
      // here was a `ready` flag driving an opacity transition, which existed
      // only because the element began transparent.
      className="absolute inset-0 size-full object-cover"
    />
  );
}
