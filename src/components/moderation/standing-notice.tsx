import { getTranslations } from 'next-intl/server';
import { Ban, CirclePause, CircleSlash, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { AppealPanel } from '@/components/moderation/appeal-panel';
import { createClient } from '@/lib/supabase/server';
import { getAppealState } from '@/lib/moderation/appeal-state';
import { cn } from '@/lib/utils';
import type { AppealState, CompanyRow, ProfileRow } from '@/lib/supabase/database.types';

type Tone = 'warning' | 'destructive';

function Panel({
  tone,
  icon,
  title,
  children,
}: {
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border px-4 py-3.5',
        tone === 'destructive'
          ? 'border-destructive/30 bg-destructive-muted'
          : 'border-warning/40 bg-warning-muted',
      )}
    >
      <h2 className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/**
 * Where an account stands, said to its holder, at the top of their console.
 *
 * A suspended employer used to be told "your account is under review" — the
 * copy for a new employer's first review — and a suspended company was not
 * mentioned at all: the listing form simply refused. Somebody on the wrong end
 * of a decision needs three things, in this order: what happened, the reason
 * a moderator gave, and what they can do about it. The last is the appeal
 * panel, which appears only where the database says an appeal is possible.
 *
 * What is never said here is how the decision was reached: no report counts,
 * no reporter, no signal. The reason is the one written for this person.
 */
export async function StandingNotice({
  profile,
  company,
}: {
  profile: ProfileRow;
  company: CompanyRow | null;
}) {
  const t = await getTranslations('standing');
  const tEmployer = await getTranslations('employer');
  const supabase = await createClient();

  const employer = profile.role === 'employer';
  const status = profile.approval_status;
  const panels: React.ReactNode[] = [];

  let account: AppealState | null = null;
  if (status !== 'approved') {
    account = await getAppealState(supabase, 'account', profile.id);
  }

  // A hold is a moderator's decision; a new employer's first review is not.
  // The appeal state tells them apart: only a hold can be (or has been) appealed.
  const held =
    status === 'pending' && (!employer || Boolean(account?.appealable || account?.open || account?.last));

  if (status === 'rejected') {
    panels.push(
      <Panel key="account" tone="destructive" icon={<CircleSlash className="size-4" aria-hidden />} title={t('suspendedTitle')}>
        <p>{employer ? t('suspendedBodyEmployer') : t('suspendedBodyCandidate')}</p>
        {profile.approval_note ? <p className="mt-1">{t('reason', { reason: profile.approval_note })}</p> : null}
        <AppealPanel subjectType="account" subjectId={profile.id} state={account} />
      </Panel>,
    );
  } else if (held) {
    panels.push(
      <Panel key="account" tone="warning" icon={<CirclePause className="size-4" aria-hidden />} title={t('heldTitle')}>
        <p>{employer ? t('heldBodyEmployer') : t('heldBodyCandidate')}</p>
        {profile.approval_note ? <p className="mt-1">{t('reason', { reason: profile.approval_note })}</p> : null}
        <AppealPanel subjectType="account" subjectId={profile.id} state={account} />
      </Panel>,
    );
  } else if (status === 'pending' && employer) {
    // Said once, at the top, in the place the work is. A company whose account
    // is still being reviewed would otherwise discover it by having the listing
    // form refuse them, with no explanation of what to do about it.
    panels.push(
      <Panel key="account" tone="warning" icon={<Clock className="size-4" aria-hidden />} title={tEmployer('pendingTitle')}>
        <p>{tEmployer('pendingBody')}</p>
        <Button asChild size="sm" variant="outline" className="mt-3">
          <Link href="/employer/company">{tEmployer('company')}</Link>
        </Button>
      </Panel>,
    );
  }

  if (employer && company?.suspended_at) {
    const [{ data: moderation }, companyAppeal] = await Promise.all([
      supabase.from('company_moderation').select('suspension_reason').eq('company_id', company.id).maybeSingle(),
      getAppealState(supabase, 'company', company.id),
    ]);
    const reason = moderation?.suspension_reason ?? null;
    panels.push(
      <Panel key="company" tone="destructive" icon={<Ban className="size-4" aria-hidden />} title={t('companySuspendedTitle')}>
        <p>{t('companySuspendedBody')}</p>
        {reason ? <p className="mt-1">{t('reason', { reason })}</p> : null}
        <AppealPanel subjectType="company" subjectId={company.id} state={companyAppeal} />
      </Panel>,
    );
  }

  if (!panels.length) return null;
  return <div className="space-y-3">{panels}</div>;
}
