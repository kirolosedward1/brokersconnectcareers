import { BadgeCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { VerificationStatus } from '@/lib/supabase/database.types';

/**
 * Only a `verified` company gets a badge. Unverified companies show nothing at
 * all — an "unverified" chip would read as a scarlet letter on a board that is
 * still filling up, and the cap on active posts is the real control.
 */
export function VerifiedBadge({
  status,
  label,
  className,
  compact = false,
}: {
  status: VerificationStatus;
  label: string;
  className?: string;
  /**
   * The mark without the word, for a line of facts on a results row.
   *
   * On a page of twenty listings the filled tag was twenty green lozenges, and
   * it was the loudest thing on every row whose company had one. Beside the
   * company name the tick alone carries it; the word is still there for a
   * screen reader and on hover, so nothing is said by colour alone.
   */
  compact?: boolean;
}) {
  if (status !== 'verified') return null;

  if (compact) {
    return (
      <span title={label} className={cn('inline-flex shrink-0 text-success', className)}>
        <BadgeCheck className="size-4" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <Badge variant="success" className={className}>
      <BadgeCheck aria-hidden />
      {label}
    </Badge>
  );
}
