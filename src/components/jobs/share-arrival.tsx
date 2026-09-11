'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';
import { rememberShareArrival } from '@/lib/share-source';

/**
 * Notices that this visit began with a forwarded link.
 *
 * Renders nothing. It exists because a WhatsApp forward carries no referrer,
 * so every reader a share brings arrives in analytics as direct traffic and
 * the cheapest distribution this board has is the one it cannot see.
 *
 * In an effect rather than during render: it reads the address bar and then
 * rewrites it, and neither belongs in a render pass.
 */
export function ShareArrival() {
  useEffect(() => {
    if (rememberShareArrival()) track('arrived_from_share');
  }, []);

  return null;
}
