/**
 * A web address as a person types it: the scheme is added when left off, so
 * "nilebrokers.com" is https://nilebrokers.com — as the website's company
 * page takes it. Empty is no address at all.
 */
export function webAddress(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}
