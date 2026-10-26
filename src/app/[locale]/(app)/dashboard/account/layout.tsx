import type { ReactNode } from 'react';

/**
 * The account screens share one column. The console around them is already
 * the app shell; this only keeps the settings at a reading width.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-8">{children}</div>;
}
