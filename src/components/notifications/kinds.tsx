import {
  BadgeCheck,
  BadgeX,
  Ban,
  Bell,
  Briefcase,
  CalendarClock,
  CalendarX2,
  CirclePause,
  CircleSlash,
  Eye,
  EyeOff,
  FileCheck2,
  FileWarning,
  FileX2,
  KeyRound,
  LifeBuoy,
  Scale,
  Send,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserRound,
} from 'lucide-react';
import { isKnownNotificationKind } from '@/lib/notifications/title';
import type { NotificationKind } from '@/lib/supabase/database.types';

/**
 * The mark a kind wears, shared by the feed and the header bell.
 *
 * A kind this build does not know yet is a plain bell, the same fallback the
 * feed uses, so a migration that adds a kind cannot take the header down.
 */
const ICONS: Record<NotificationKind, React.ComponentType<{ className?: string }>> = {
  application_submitted: Send,
  application_received: UserRound,
  application_withdrawn: UserMinus,
  application_moved: Send,
  job_published: FileCheck2,
  job_rejected: FileX2,
  company_verified: BadgeCheck,
  account_approved: UserCheck,
  account_rejected: CircleSlash,
  job_expiring: CalendarClock,
  job_expired: CalendarX2,
  company_verification_needed: FileWarning,
  profile_visibility_changed: Eye,
  password_changed: KeyRound,
  support_replied: LifeBuoy,
  report_reviewed: ShieldCheck,
  company_suspended: Ban,
  company_restored: BadgeCheck,
  profile_restricted: EyeOff,
  profile_restored: Eye,
  account_held: CirclePause,
  appeal_decided: Scale,
  new_jobs: Briefcase,
  company_verification_revoked: BadgeX,
};

const TONES: Record<NotificationKind, string> = {
  application_submitted: 'bg-success-muted text-success',
  application_received: 'bg-primary/10 text-primary',
  application_withdrawn: 'bg-muted text-muted-foreground',
  application_moved: 'bg-primary/10 text-primary',
  job_published: 'bg-success-muted text-success',
  job_rejected: 'bg-destructive-muted text-destructive',
  company_verified: 'bg-success-muted text-success',
  account_approved: 'bg-success-muted text-success',
  account_rejected: 'bg-destructive-muted text-destructive',
  job_expiring: 'bg-warning-muted text-warning',
  job_expired: 'bg-muted text-muted-foreground',
  company_verification_needed: 'bg-destructive-muted text-destructive',
  profile_visibility_changed: 'bg-primary/10 text-primary',
  password_changed: 'bg-warning-muted text-warning',
  support_replied: 'bg-primary/10 text-primary',
  report_reviewed: 'bg-primary/10 text-primary',
  company_suspended: 'bg-destructive-muted text-destructive',
  company_restored: 'bg-success-muted text-success',
  profile_restricted: 'bg-destructive-muted text-destructive',
  profile_restored: 'bg-success-muted text-success',
  account_held: 'bg-warning-muted text-warning',
  appeal_decided: 'bg-primary/10 text-primary',
  new_jobs: 'bg-primary/10 text-primary',
  company_verification_revoked: 'bg-destructive-muted text-destructive',
};

export function notificationIcon(kind: string) {
  return isKnownNotificationKind(kind) ? ICONS[kind] : Bell;
}

export function notificationTone(kind: string) {
  return isKnownNotificationKind(kind) ? TONES[kind] : 'bg-muted text-muted-foreground';
}
