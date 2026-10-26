'use client';

/**
 * The copyright year, read when the footer is drawn.
 *
 * A server render freezes the year into the HTML of whatever was built or
 * cached. This reads it in the browser as well, so a page served across the
 * new year still shows the year the reader is in. `suppressHydrationWarning`
 * is the one night those two reads disagree.
 */
export function FooterYear() {
  return (
    <span className="numeral" suppressHydrationWarning>
      {new Date().getFullYear()}
    </span>
  );
}
