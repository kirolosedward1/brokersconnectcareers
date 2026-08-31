import { BadgeCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
}: {
  status: VerificationStatus;
  label: string;
  className?: string;
}) {
  if (status !== 'verified') return null;

  return (
    <Badge variant="success" className={className}>
      <BadgeCheck aria-hidden />
      {label}
    </Badge>
  );
}
