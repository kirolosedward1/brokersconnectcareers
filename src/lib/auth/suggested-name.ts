/**
 * The name onboarding may pre-fill, and when it must stay blank.
 *
 * Apple sends the person's name once, on the first authorization, and never
 * again — and only if they chose to share it. Supabase keeps that on
 * `user_metadata` when it arrived (`full_name`, sometimes `name`, sometimes
 * the given and family names). A later sign-in has no name to offer.
 *
 * Hide My Email is a real, deliverable address at `privaterelay.appleid.com`.
 * Its local part is a random token. Using that token as a name would let
 * someone finish onboarding without ever being asked who they are.
 */

const RELAY_HOST = 'privaterelay.appleid.com';

export function isApplePrivateRelay(email: string | null | undefined): boolean {
  const host = email?.split('@')[1]?.trim().toLowerCase() ?? '';
  return host === RELAY_HOST;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function joinedName(record: Record<string, unknown>, firstKeys: string[], lastKeys: string[]): string {
  const first = firstKeys.map((key) => text(record[key])).find(Boolean) ?? '';
  const last = lastKeys.map((key) => text(record[key])).find(Boolean) ?? '';
  return [first, last].filter(Boolean).join(' ');
}

function nameCandidates(metadata: Record<string, unknown>): string[] {
  const candidates = [text(metadata.full_name)];
  if (typeof metadata.name === 'string') candidates.push(text(metadata.name));
  if (metadata.name && typeof metadata.name === 'object') {
    candidates.push(
      joinedName(metadata.name as Record<string, unknown>, ['firstName', 'givenName', 'given_name'], ['lastName', 'familyName', 'family_name']),
    );
  }
  candidates.push(joinedName(metadata, ['given_name', 'givenName', 'first_name'], ['family_name', 'familyName', 'last_name']));
  return candidates;
}

/**
 * A string worth putting in the name field. Empty means onboarding asks.
 * The local part of a private-relay address is never a name, even when a
 * provider stored it as one.
 */
function usableName(value: string, email: string | null | undefined): string {
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length < 2) return '';
  if (email && name.toLowerCase() === email.trim().toLowerCase()) return '';
  if (isApplePrivateRelay(email)) {
    const local = email?.split('@')[0]?.trim().toLowerCase() ?? '';
    if (local && name.toLowerCase() === local) return '';
  }
  return name;
}

export function suggestedDisplayName(input: {
  metadata: Record<string, unknown> | null | undefined;
  email: string | null | undefined;
  providers?: readonly string[] | null;
}): string {
  const metadata = input.metadata ?? {};
  for (const candidate of nameCandidates(metadata)) {
    const usable = usableName(candidate, input.email);
    if (usable) return usable;
  }

  // Apple with no name: the profile step asks. A normal address can still
  // offer its local part, which is what email sign-up has always done.
  const apple = (input.providers ?? []).includes('apple');
  if (apple || isApplePrivateRelay(input.email)) return '';

  return input.email?.split('@')[0]?.trim() ?? '';
}
