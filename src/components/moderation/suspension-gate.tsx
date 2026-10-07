'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/i18n/navigation';

/**
 * The pages a suspended account still reaches: its own settings — the copy of
 * its data, its sign-in details, and the deletion the suspension holds back
 * with its reason — and its notifications, where the decision was announced.
 * Their own data is still theirs while a decision about them stands.
 */
const STILL_OPEN = ['/dashboard/account', '/notifications'];

/**
 * A suspended account's console: where it stands on every page — what
 * happened, the moderator's reason and the appeal (StandingNotice) — and the
 * page itself only where it is still theirs to use.
 */
export function SuspensionGate({ notice, children }: { notice: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const open = STILL_OPEN.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return (
    <div className="space-y-6">
      {notice}
      {open ? children : null}
    </div>
  );
}
