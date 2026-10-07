import { useState } from 'react';
import { useIsFocused } from 'expo-router';

/**
 * Whether this screen has been on screen yet.
 *
 * The native tab bar draws the first screen of every tab at launch, out of
 * sight, so a tab's root that reads as it mounts read at every launch for
 * tabs nobody opened: the employer's inbox fetched two hundred applicants and
 * drew their cards behind Home. A tab root waits for this before it reads,
 * and keeps what it read once it has been opened.
 */
export function useVisited(): boolean {
  const focused = useIsFocused();
  const [visited, setVisited] = useState(focused);
  if (focused && !visited) setVisited(true);
  return visited || focused;
}
