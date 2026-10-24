'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { hasAuthCookie } from '@/components/session/session-provider';

type Marks = { applied: Set<string>; saved: Set<string>; savable: boolean };

const EMPTY: Marks = { applied: new Set(), saved: new Set(), savable: false };
const MarksContext = createContext<Marks>(EMPTY);

export function useJobMarks(): Marks {
  return useContext(MarksContext);
}

/**
 * Applied and saved ticks for a cached board.
 *
 * The ids are the page's own listings. Nothing is fetched unless a session
 * cookie is already in the browser, so a signed-out reader and a crawler
 * never ask, and the HTML does not wait on the answer.
 */
export function JobMarks({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const [marks, setMarks] = useState<Marks>(EMPTY);
  const key = ids.join(',');

  useEffect(() => {
    if (!key || !hasAuthCookie()) return;
    const controller = new AbortController();
    fetch(`/api/job-marks?ids=${encodeURIComponent(key)}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { applied?: string[]; saved?: string[]; savable?: boolean } | null) => {
        if (!data) return;
        setMarks({
          applied: new Set(data.applied ?? []),
          saved: new Set(data.saved ?? []),
          savable: Boolean(data.savable),
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [key]);

  return <MarksContext.Provider value={marks}>{children}</MarksContext.Provider>;
}
