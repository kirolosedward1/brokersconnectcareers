'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * The one dialog.
 *
 * This was written inside ReportJobDialog and was the only correct modal in
 * the product; anything else that needed one would have grown a second, worse
 * copy. The keyboard behaviour is the reason it is worth sharing rather than
 * repeating — that component carried `aria-modal="true"`, which tells
 * assistive technology that everything outside is inert, while focus stayed on
 * the button behind the overlay, Escape did nothing, and the role sat on the
 * backdrop rather than on the box. A keyboard user could open it and not get
 * into it, or not get out.
 *
 * So all four promises are kept here, once:
 *
 *   - focus moves into the dialog on open, so the first Tab stays inside
 *   - Tab and Shift+Tab wrap, which is what aria-modal actually claims
 *   - Escape closes
 *   - closing returns focus to whatever opened it, not to <body>
 *
 * The backdrop is a backdrop: the dialog role belongs on the box, and clicking
 * outside closes, because that is the gesture everybody tries first.
 */
export function Dialog({
  open,
  onClose,
  label,
  children,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** Names the dialog for assistive technology. */
  label: string;
  children: React.ReactNode;
  closeLabel: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const openedBy = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    openedBy.current = document.activeElement as HTMLElement | null;

    // Into the dialog, so the first Tab moves within it rather than through
    // the page behind.
    boxRef.current
      ?.querySelector<HTMLElement>('a[href], button:not([disabled]), select, textarea, input')
      ?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = boxRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select, textarea, input:not([type="hidden"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    // The page behind must not scroll under the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Back to what opened it, rather than dropped on <body>.
      openedBy.current?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute end-3 top-3 grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}
