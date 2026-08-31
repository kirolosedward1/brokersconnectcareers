/**
 * WhatsApp numbers are stored in E.164. People type them every other way, so
 * normalise the common Egyptian forms before validating rather than rejecting
 * a number that is perfectly correct but locally formatted.
 *
 *   01001234567    -> +201001234567
 *   00201001234567 -> +201001234567
 *   201001234567   -> +201001234567
 *   +20 100 123 4567 -> +201001234567
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
    else if (digits.startsWith('20')) digits = `+${digits}`;
    else digits = `+${digits}`;
  }

  return digits;
}

const E164 = /^\+[1-9]\d{7,14}$/;

export function isValidPhone(input: string): boolean {
  return E164.test(normalisePhone(input));
}
