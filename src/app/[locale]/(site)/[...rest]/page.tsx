import { notFound } from 'next/navigation';

/**
 * Catch-all so an unknown path still renders inside the locale layout, in the
 * right language and direction, rather than falling through to Next's bare
 * global 404.
 */
export default function CatchAllPage() {
  notFound();
}
