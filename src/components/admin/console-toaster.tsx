'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

/** The event a lever raises once the database has said yes. */
export const ADMIN_DONE_EVENT = 'admin:done';

export function announceDone(message: string) {
  window.dispatchEvent(new CustomEvent(ADMIN_DONE_EVENT, { detail: message }));
}

/**
 * The confirmation that outlives the button.
 *
 * A lever that worked usually disappears: approve a listing and the page
 * re-reads to show a live listing, which offers take-down instead of approve.
 * A success line beside the button went with it, so the one moment an admin
 * needs to hear "that happened" was the moment it vanished. This sits in the
 * console layout, above every page, and holds the message for a few seconds
 * across the refresh. It only ever speaks after an action returned ok — which
 * is only after the change and its audit record committed.
 */
export function ConsoleToaster() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onDone = (event: Event) => {
      setMessage((event as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 6000);
    };
    window.addEventListener(ADMIN_DONE_EVENT, onDone);
    return () => {
      window.removeEventListener(ADMIN_DONE_EVENT, onDone);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {message ? (
        <p
          role="status"
          className="pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border border-success/30 bg-card px-4 py-3 text-sm shadow-lg"
        >
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          {message}
        </p>
      ) : null}
    </div>
  );
}
