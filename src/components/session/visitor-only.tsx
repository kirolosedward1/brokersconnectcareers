'use client';

import { useSession } from '@/components/session/session-provider';

/** The two doors at the top of the footer. A signed-in reader has already chosen. */
export function VisitorOnly({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (session.kind !== 'anon') return null;
  return children;
}
