/**
 * WhatsApp numbers are stored in E.164. People type them every other way, so
 * normalise the common Egyptian forms before validating rather than rejecting
 * a number that is perfectly correct but locally formatted.
 *
 *   01001234567      -> +201001234567
 *   1001234567       -> +201001234567   (the leading zero dropped, as a phone shows it)
 *   00201001234567   -> +201001234567
 *   201001234567     -> +201001234567
 *   +20 100 123 4567 -> +201001234567
 *   +20 0100 123 4567-> +201001234567   (the trunk zero kept after the country code)
 *
 * Only the forms above are rewritten. Anything else is handed to the
 * validator as typed, with a `+` in front of it — a foreign number in full
 * international form passes, and a bare string of digits that is not an
 * Egyptian number fails rather than being silently made into a number in a
 * country the person never named.
 */
export function normalisePhone(input: string): string {
  // Arabic-Indic digits paste in from Arabic keyboards constantly.
  const western = input.replace(/[٠-٩]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660),
  );

  let digits = western.replace(/[^\d+]/g, '');

  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;

  if (!digits.startsWith('+')) {
    if (digits.startsWith('0')) digits = `+20${digits.slice(1)}`;
    else if (digits.startsWith('20') && digits.length >= 12) digits = `+${digits}`;
    // An Egyptian mobile with its leading zero dropped: ten digits starting
    // with 1. `1001234567` used to become `+1001234567`, a "valid" number in
    // no country, and it was stored.
    else if (/^1\d{9}$/.test(digits)) digits = `+20${digits}`;
    else digits = `+${digits}`;
  }

  // `+20 0100…`: the trunk zero typed after the country code, which is how
  // a phone's own contact card often shows it. E.164 has no trunk prefix.
  if (/^\+2001\d{9}$/.test(digits)) digits = `+20${digits.slice(4)}`;

  return digits;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * An Egyptian mobile is `+20 1X XXXX XXXX` — twelve digits after the plus,
 * the first of them 1. A number with the country code that does not fit
 * that shape is a typo, and storing it means an employer calling nobody.
 */
const EGYPT_MOBILE = /^\+201\d{9}$/;

export function isValidPhone(input: string): boolean {
  const phone = normalisePhone(input);
  if (!E164.test(phone)) return false;
  if (phone.startsWith('+20')) return EGYPT_MOBILE.test(phone);
  return true;
}
