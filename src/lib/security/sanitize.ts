/**
 * Text a person typed, made safe to store and to show.
 *
 * Nothing here renders HTML — React escapes every string it prints, and the
 * two places that set innerHTML take markdown from this repository, not from a
 * user. So the risk is not a script tag executing; it is a script tag *being
 * stored*, and then meeting some other renderer one day (an email client, a
 * CSV export, a partner feed, a future rich-text field). Strip it now, at the
 * one door every user string comes through.
 *
 * The other risks are subtler: characters that reverse the reading direction
 * of what follows (a favourite for making one thing read as another), zero
 * width characters that hide text or split a word past a filter, control
 * characters that break a log line, and a description that is forty links.
 */

/** Bidirectional overrides and isolates, zero-width characters, the BOM. */
const INVISIBLE = /[​‎‪-‮⁠-⁤⁦-⁩﻿]/g;

/** C0 and C1 controls, minus tab and newline. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

const TAG = /<\/?[a-z!?][^>]*>/gi;

const URL_LIKE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

export type CleanOptions = {
  /** Lines are kept for multi-line fields; single-line fields collapse them. */
  multiline?: boolean;
  /** How many links the text may carry before it is refused. */
  maxLinks?: number;
};

export type CleanResult = { ok: true; value: string } | { ok: false; reason: 'too_many_links' };

/**
 * Removes markup, invisible and control characters, and excess whitespace.
 * Returns the cleaned text, or a refusal when it carries more links than the
 * field allows.
 */
export function cleanText(input: string | null | undefined, options: CleanOptions = {}): CleanResult {
  if (input == null) return { ok: true, value: '' };

  let text = String(input)
    .replace(TAG, ' ')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    // NFC, so a name spelled with combining marks compares equal to itself.
    .normalize('NFC');

  if (options.multiline) {
    text = text
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      // At most one blank line in a row: a description padded with forty
      // newlines is the hidden-text trick in its plainest form.
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    text = text.replace(/\s+/g, ' ').trim();
  }

  if (options.maxLinks != null) {
    const links = text.match(URL_LIKE)?.length ?? 0;
    if (links > options.maxLinks) return { ok: false, reason: 'too_many_links' };
  }

  return { ok: true, value: text };
}

/** cleanText for callers that only want the string, links unlimited. */
export function clean(input: string | null | undefined, multiline = false): string {
  const result = cleanText(input, { multiline });
  return result.ok ? result.value : '';
}

/**
 * A URL that may be put in an href.
 *
 * `http:` and `https:` only, parsed rather than pattern-matched so a scheme in
 * disguise — `java\tscript:`, ` javascript:`, `JAVASCRIPT:` — is caught by the
 * parser's own normalisation. Anything else is null, and a null is rendered as
 * no link at all.
 */
export function safeHttpUrl(value: string | null | undefined, maxLength = 200): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;

  return url.toString();
}
