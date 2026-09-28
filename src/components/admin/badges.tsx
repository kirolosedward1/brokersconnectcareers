import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { displayJobStatus } from '@/lib/job-state';
import type {
  AgentVisibility,
  ApprovalStatus,
  JobStatus,
  ReportStatus,
  VerificationStatus,
} from '@/lib/supabase/database.types';

type Variant = 'default' | 'outline' | 'primary' | 'success' | 'warning' | 'destructive' | 'accent';

const JOB: Record<JobStatus, Variant> = {
  draft: 'outline',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

/** Classified by the date, as the board does: `active` past its window reads expired. */
export async function JobStatusBadge({ status, expiresAt }: { status: JobStatus; expiresAt: string | null }) {
  const tJob = await getTranslations('jobStatus');
  const shown = displayJobStatus({ status, expires_at: expiresAt });
  return <Badge variant={JOB[shown]}>{tJob(shown)}</Badge>;
}

const APPROVAL: Record<ApprovalStatus, Variant> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'destructive',
};

export async function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const t = await getTranslations('admin');
  return <Badge variant={APPROVAL[status]}>{t(`approval.${status}`)}</Badge>;
}

const VERIFICATION: Record<VerificationStatus, Variant> = {
  unverified: 'outline',
  pending: 'warning',
  verified: 'success',
  rejected: 'destructive',
};

export async function VerificationBadge({
  status,
  suspended,
}: {
  status: VerificationStatus;
  suspended?: boolean;
}) {
  const t = await getTranslations('admin');
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant={VERIFICATION[status]}>{t(`verification.${status}`)}</Badge>
      {suspended ? <Badge variant="destructive">{t('suspended')}</Badge> : null}
    </span>
  );
}

const REPORT: Record<ReportStatus, Variant> = {
  open: 'destructive',
  investigating: 'warning',
  resolved: 'success',
  dismissed: 'default',
};

export async function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const t = await getTranslations('admin');
  return <Badge variant={REPORT[status]}>{t(`reportStatus.${status}`)}</Badge>;
}

export async function VisibilityBadge({
  visibility,
  restricted,
}: {
  visibility: AgentVisibility;
  restricted?: boolean;
}) {
  const tVisibility = await getTranslations('visibility');
  const tAdmin = await getTranslations('admin');
  if (restricted) return <Badge variant="destructive">{tAdmin('restricted')}</Badge>;
  return (
    <Badge variant={visibility === 'public' ? 'success' : visibility === 'hidden' ? 'outline' : 'primary'}>
      {tVisibility(visibility)}
    </Badge>
  );
}
