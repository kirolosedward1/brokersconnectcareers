'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheck, UserPlus, UserRound, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/field';
import { addCompanyMember, removeCompanyMember } from '@/lib/actions/company';
import type { CompanyMemberRole } from '@/lib/supabase/database.types';
import { Avatar } from '@/components/ui/avatar';
import { useSessionRecovery } from '@/lib/session-expired';

export type TeamMember = {
  userId: string;
  name: string;
  role: CompanyMemberRole;
  isOwner: boolean;
};

/**
 * Who else is in this company.
 *
 * A company used to be one person's login: whoever signed up held the account
 * and everybody else watched over their shoulder, and when that person left
 * the company was stranded. The roster is the fix, and this is the only place
 * it is visible.
 *
 * The form adds an account that already exists. Inviting somebody who has
 * never signed up needs an email to leave the platform, and none does yet — so
 * an invite button today would be a button that silently does nothing. When
 * the address is unknown, the answer says so and says what to do instead.
 *
 * Recruiters see the roster and cannot change it, which is the database's
 * rule, not this component's: company_members_manage refuses them. The form is
 * hidden from them because offering a control that will be refused is worse
 * than not offering it.
 */
export function TeamSettings({
  members,
  canManage,
}: {
  members: TeamMember[];
  canManage: boolean;
}) {
  const t = useTranslations('employer');
  const tCommon = useTranslations('common');

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<CompanyMemberRole>('recruiter');
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);

    startTransition(async () => {
      const result = await addCompanyMember({
        email: String(data.get('email') ?? ''),
        role,
      });

      if (recoverSession(result)) return;
      if (!result.ok) {
        setError(
          result.error === 'no_account'
            ? t('teamNoAccount')
            : result.error === 'already_member'
              ? t('teamAlreadyMember')
              : result.error === 'not_employer'
                ? t('teamNotEmployer')
                : tCommon('errorBody'),
        );
        return;
      }

      form.reset();
      setRole('recruiter');
      router.refresh();
    });
  }

  function onRemove(userId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeCompanyMember(userId);
      if (recoverSession(result)) return;
      if (!result.ok) {
        setError(result.error === 'owner' ? t('teamCannotRemoveOwner') : tCommon('errorBody'));
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="font-semibold">{t('teamTitle')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('teamBody')}</p>

      <ul className="mt-5 space-y-2">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"
          >
            <Avatar name={member.name} seed={member.userId} />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{member.name}</span>
              <span className="text-xs text-muted-foreground">
                {member.role === 'admin' ? t('teamRoleAdmin') : t('teamRoleRecruiter')}
              </span>
            </span>

            {member.isOwner ? (
              <Badge variant="primary">
                <ShieldCheck aria-hidden />
                {t('teamOwner')}
              </Badge>
            ) : canManage ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => onRemove(member.userId)}
                aria-label={t('teamRemove')}
                title={t('teamRemove')}
              >
                <X aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form onSubmit={onAdd} className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
          <Field label={t('teamEmail')} htmlFor="memberEmail">
            <Input
              id="memberEmail"
              name="email"
              type="email"
              required
              autoComplete="off"
              dir="ltr"
            />
          </Field>

          {/* The hint follows the choice. Naming what "admin" grants matters
              most at the moment somebody is deciding whether to grant it. */}
          <Field
            label={t('teamRole')}
            htmlFor="memberRole"
            hint={role === 'admin' ? t('teamRoleAdminHint') : t('teamRoleRecruiterHint')}
          >
            <Select
              id="memberRole"
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value as CompanyMemberRole)}
            >
              <option value="recruiter">{t('teamRoleRecruiter')}</option>
              <option value="admin">{t('teamRoleAdmin')}</option>
            </Select>
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <SubmitButton disabled={pending}>
              <UserPlus aria-hidden />
              {pending ? tCommon('loading') : t('teamAdd')}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <p className="mt-5 flex items-center gap-2 border-t border-border pt-5 text-sm text-muted-foreground">
          <UserRound className="size-4 shrink-0" aria-hidden />
          {t('teamOnlyAdmins')}
        </p>
      )}
    </section>
  );
}
