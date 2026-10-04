import { useState } from 'react';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A form's fields, filled from what is stored and kept up with it.
 *
 * A screen stays mounted under its tab, and what it was filled from can
 * change while it is open: applying writes the name and number typed there
 * onto the account, an email's unsubscribe link turns a digest off, another
 * phone saves. Filled once and never again, the next save sent the old values
 * back over the new ones. Here a field nobody has touched since it was filled
 * or last saved takes the new value; one being edited keeps what was typed.
 *
 * "Since it was filled or last saved", not "since it last matched what is
 * stored": the website stores some fields as it writes them (a number in
 * international form, a name trimmed), so a field saved as typed matched
 * neither the old stored value nor the new one, and followed nothing again.
 * And a choice put back while the save's answer was being read again is a
 * change of its own, kept rather than overwritten.
 *
 * `dirty` compares the fields with what they held when filled or last saved
 * (`saved(values)` after each save), which follows along with them.
 */
export function useStoredFields<T extends Record<string, unknown>>(stored: T) {
  const [fields, setFields] = useState(stored);
  const [savedAs, setSavedAs] = useState(stored);
  // What was stored when last looked at, to tell when it changes.
  const [seen, setSeen] = useState(stored);

  if (!same(seen, stored)) {
    const keys = Object.keys(stored) as (keyof T)[];
    // Untouched: still what it held when filled or last saved.
    const followed = Object.fromEntries(
      keys.filter((key) => same(fields[key], savedAs[key])).map((key) => [key, stored[key]]),
    ) as Partial<T>;
    setSeen(stored);
    setFields((current) => ({ ...current, ...followed }));
    setSavedAs((current) => ({ ...current, ...followed }));
  }

  return {
    fields,
    /** Some fields changed — by value, or from the fields as they are, for a change made twice before a render. */
    set: (patch: Partial<T> | ((current: T) => Partial<T>)) =>
      setFields((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) })),
    dirty: !same(fields, savedAs),
    /** The values just saved: the form is no longer holding changes, as far as they go. */
    saved: (values: T) => setSavedAs(values),
  };
}
