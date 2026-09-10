'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/field';
import { formatNumber } from '@/lib/utils';

/**
 * A figure with its thousands separators, grouped as it is typed.
 *
 * `5000000` in a salary box is a number nobody can read at a glance — the
 * whole point of the field is that somebody checks it, and checking it means
 * counting zeroes. It is worse here than on most products: this is the field
 * where a consultant states what they have sold and an employer states what
 * they will pay, and both are the numbers those two people will argue about.
 *
 * It cannot be `type="number"`. A number input rejects "5,000,000" outright —
 * the browser treats a grouped value as invalid and hands back an empty string
 * — so this is a text input with `inputMode="numeric"`, which still brings up
 * the digit keypad on a phone.
 *
 * Two values, therefore: what is shown and what is submitted. The visible
 * input carries no `name` and holds the grouped text; a hidden input carries
 * the `name` and the bare digits, so nothing downstream — FormData, zod, the
 * database — ever meets a comma. A controlled parent gets the same bare digits
 * through `onValueChange` instead.
 *
 * Not for every number. A year formats as "2,021" and a percentage has a
 * decimal point, so `graduated`, `commissionValue`, `seats` and
 * `yearsExperience` are deliberately left as plain number inputs.
 */
export function NumberInput({
  name,
  value,
  defaultValue,
  onValueChange,
  locale,
  className,
  ...rest
}: {
  /** Given, a hidden input carries the bare digits under this name. */
  name?: string;
  /** Controlled: bare digits, no separators. */
  value?: string;
  defaultValue?: string | number | null;
  onValueChange?: (raw: string) => void;
  locale: string;
  className?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'name'
>) {
  const controlled = value !== undefined;
  const [own, setOwn] = useState(() =>
    defaultValue == null ? '' : String(defaultValue).replace(/\D/g, ''),
  );
  const raw = controlled ? value.replace(/\D/g, '') : own;

  const ref = useRef<HTMLInputElement>(null);
  /**
   * How many digits sat to the left of the caret before reformatting.
   *
   * The caret cannot be restored by index, because inserting a separator moves
   * every character after it: type "5000" then "0" and the string grows by two,
   * not one, so the caret would drift left of where the eye expects it. Digits
   * are the stable coordinate — the caret belongs after the same digit it was
   * after, wherever the commas end up.
   */
  const caretDigits = useRef<number | null>(null);
  /** Which key produced this change, so a deletion can be told from an edit. */
  const lastKey = useRef<string | null>(null);

  const shown = raw === '' ? '' : formatNumber(Number(raw), locale);

  useLayoutEffect(() => {
    const input = ref.current;
    const target = caretDigits.current;
    if (!input || target === null) return;
    caretDigits.current = null;

    let seen = 0;
    let position = input.value.length;
    for (let index = 0; index < input.value.length; index += 1) {
      if (/\d/.test(input.value[index])) {
        seen += 1;
        if (seen === target) {
          position = index + 1;
          break;
        }
      }
    }
    if (target === 0) position = 0;
    input.setSelectionRange(position, position);
  }, [shown]);

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const typed = event.target.value;
    const caret = event.target.selectionStart ?? typed.length;

    // Digits only, and capped: past 15 digits Number loses precision, and a
    // salary that long is a typo rather than a figure.
    let digits = typed.replace(/\D/g, '').slice(0, 15);
    let before = typed.slice(0, caret).replace(/\D/g, '').length;

    /*
      Deleting a separator deletes the digit it belongs to.

      Backspace on the comma in "5,000,000" removes a character this field does
      not store, so the digits come back identical, the value reformats to what
      it already was, and the key appears to have done nothing. Pressing it
      harder does not help. Every money input that feels right treats the
      separator as part of the digit beside it, so that is what happens here:
      when a deletion leaves the digits untouched, the neighbouring digit goes
      instead — the one before for Backspace, the one after for Delete.
    */
    const deleting = lastKey.current === 'Backspace' || lastKey.current === 'Delete';
    if (deleting && digits === raw && typed.length < shown.length) {
      if (lastKey.current === 'Backspace' && before > 0) {
        digits = digits.slice(0, before - 1) + digits.slice(before);
        before -= 1;
      } else if (lastKey.current === 'Delete' && before < digits.length) {
        digits = digits.slice(0, before) + digits.slice(before + 1);
      }
    }

    /*
      One canonical form, so what is shown and what is submitted agree.

      Deleting the 5 out of "5,000,000" leaves "000000", which displays as "0"
      — Number drops the padding — while the hidden input still carried all six
      zeroes. Harmless to Number() downstream and wrong everywhere a human or a
      schema looks at it. Stripped here instead, with the caret pulled back by
      however many digits went with them.
    */
    const trimmed = digits.replace(/^0+(?=\d)/, '');
    before = Math.max(0, before - (digits.length - trimmed.length));
    digits = trimmed;

    caretDigits.current = before;
    lastKey.current = null;

    if (!controlled) setOwn(digits);
    onValueChange?.(digits);
  }

  return (
    <>
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        // `numeral` isolates the digits left-to-right. Without it a grouped
        // figure in an Arabic form is reordered around the commas.
        className={['numeral', className].filter(Boolean).join(' ')}
        value={shown}
        onKeyDown={(event) => {
          lastKey.current = event.key;
          rest.onKeyDown?.(event);
        }}
        onChange={onChange}
      />
      {name ? <input type="hidden" name={name} value={raw} /> : null}
    </>
  );
}
