import { useRef } from 'react';
import { uuid } from '@/lib/uuid';

/**
 * The same key the website's `src/lib/retry-key.ts` keeps for one create.
 *
 * It lives here, not in that file, because that file imports React. The
 * phone's typecheck, and a builder, install only this project. TypeScript
 * looks for React by walking up from the website file and finds none. Jest
 * and Metro already redirect that import, but a `paths` entry for React is
 * read by both of them and points every React import at the wrong package.
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
