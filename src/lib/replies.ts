/**
 * The words a saved reply may stand in for (Phase B 06): the applicant's
 * name and first name, the listing's title, the company and the stage. A
 * fixed list, so nothing else can be pulled into a message; anything else in
 * braces is refused when the reply is saved. Filled on the phone for
 * WhatsApp, and by the email for a message sent by email. Shared by the
 * website and the app.
 */
export const REPLY_VARIABLES = ['name', 'first_name', 'job', 'company', 'stage'] as const;
export type ReplyVariable = (typeof REPLY_VARIABLES)[number];
export type ReplyValues = Partial<Record<ReplyVariable, string>>;

const BRACED = /\{([a-z_]+)\}/g;

/** The `{…}` words in a reply that are not on the list. */
export function unknownReplyVariables(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(BRACED)) {
    if (!(REPLY_VARIABLES as readonly string[]).includes(match[1] ?? '')) unknown.add(match[0]);
  }
  return [...unknown];
}

/** The reply with its words put in; a word with no value is left as written, so nothing is silently dropped. */
export function fillReply(text: string, values: ReplyValues): string {
  return text.replace(BRACED, (whole, key: string) => {
    const value = values[key as ReplyVariable];
    return value === undefined ? whole : value;
  });
}

/** The first name of a full name, as a reply addresses somebody. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}
