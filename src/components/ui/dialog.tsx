'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Everything inside a layer that can take focus, in document order.
 *
 * Disabled controls, hidden inputs, `tabindex="-1"` and anything not rendered
 * are left out: the trap below wraps from the last of these to the first, and
 * a last element that cannot actually take focus is a trap that does not
 * close — Tab walks out of the dialog into the page behind it.
 */
function focusableIn(box: HTMLElement | null): HTMLElement[] {
  if (!box) return [];
  return [
    ...box.querySelectorAll<HTMLElement>(
      'a[href], button, select, textarea, input, summary, [tabindex]',
    ),
  ].filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('tabindex') !== '-1' &&
      !(element instanceof HTMLInputElement && element.type === 'hidden') &&
      element.getClientRects().length > 0,
  );
}

/**
 * What makes a layer modal, shared by the dialog, the phone's filter sheet and
 * the console's phone menu.
 *
 * Focus moves into the layer when it opens, Tab cycles inside it, Escape
 * closes it, the page behind stops scrolling, and focus goes back to whatever
 * opened it when it closes. Written once: a second copy of a focus trap is the
 * copy that forgets to return focus.
 *
 * `onClose` is read through a ref. Callers pass an inline arrow — the report
 * dialog does — and with it in the effect's dependencies every re-render of
 * the caller tore the layer down and put it back: focus was handed to the
 * button behind the overlay and then pulled back to the first control inside,
 * so pressing Submit bounced focus to the close button, and an error that
 * arrived with the response was read out from the wrong place.
 */
export function useModalLayer(
  open: boolean,
  onClose: () => void,
  boxRef: React.RefObject<HTMLElement | null>,
) {
  const openedBy = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;

    openedBy.current = document.activeElement as HTMLElement | null;

    // Into the layer, so the first Tab moves within it rather than through the
    // page behind. A control that asks for it wins; otherwise the first thing
    // that is not the close button — a form's first field is where somebody
    // who opened a form wants to be — and the close button only when there is
    // nothing else.
    const box = boxRef.current;
    const candidates = focusableIn(box);
    const initial =
      box?.querySelector<HTMLElement>('[data-autofocus]') ??
      candidates.find((element) => !element.hasAttribute('data-layer-close')) ??
      candidates[0] ??
      box;
    initial?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableIn(boxRef.current);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Focus that has somehow left the layer is brought back in rather than
      // allowed to wander the page the overlay is covering.
      if (!boxRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
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
      // Back to what opened it, rather than dropped on <body> — if it is still
      // on the page. A control that unmounted while the layer was open (a
      // dialog whose success replaces its own trigger) is somebody else's to
      // place, and focusing a detached node would silently do nothing.
      const opener = openedBy.current;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, boxRef]);
}

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
  useModalLayer(open, onClose, boxRef);

  if (!open) return null;

  /*
    The overlay scrolls, and the box is centred inside a wrapper at least as
    tall as the overlay rather than by the overlay itself. Centred directly, a
    box taller than the screen — any of these at 200% zoom, or on a landscape
    phone — overflowed above the top edge by as much as below, and the part
    above could not be scrolled to: the report form's heading and first field
    were simply gone.
  */
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50"
      onMouseDown={(event) => {
        if (!boxRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div className="grid min-h-full place-items-center p-4">
        <div
          ref={boxRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            data-layer-close
            className="absolute end-3 top-3 grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}
