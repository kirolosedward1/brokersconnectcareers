/**
 * Signing out without supabase-js. signOut() first waits for auth-js's lock,
 * and a refresh that holds it (retried for half a minute and more offline, or
 * while the auth service asks to wait) kept the Account button spinning with
 * nobody signed out. When signOutHere gives up waiting, the stored session is
 * already gone; this tells the SessionProvider to draw nobody at once. The
 * signOut left waiting still finishes, and its SIGNED_OUT changes nothing.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onLocalSignOut(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceLocalSignOut(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One listener failing must not keep the others from hearing it.
    }
  }
}
