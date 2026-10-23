import { useRef } from 'react';
import { uuid } from '@/lib/uuid';

/**
 * The idempotency key for a create form (src/lib/actions/idempotency.ts).
 *
 * The same key for as long as the form sends the same thing: a save that
 * timed out after the server wrote it, pressed again, finds that row instead
 * of writing a second. Changed words are a different entry, so they get a new
 * key — kept, they would have been answered with the first attempt's row and
 * the edit silently dropped. `done()` once the server has it, so the next
 * entry in the same form is its own.
 */
export function useRetryKey() {
  const last = useRef<{ content: string; key: string } | null>(null);
  return {
    for(content: unknown): string {
      const serialized = JSON.stringify(content);
      if (last.current?.content !== serialized) last.current = { content: serialized, key: uuid() };
      return last.current.key;
    },
    done() {
      last.current = null;
    },
  };
}
