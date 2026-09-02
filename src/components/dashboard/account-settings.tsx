'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { deleteMyAccount, updateNotificationPreferences } from '@/lib/actions/account';
import type { ProfileRow } from '@/lib/supabase/database.types';

type Prefs = Pick<ProfileRow, 'notify_applications' | 'notify_status' | 'notify_digest'>;

/**
 * Account settings: the three things the privacy policy promises can be done
 * from here — change what we email you, take a copy of your data, delete the
 * account.
 *
 * Deletion asks for typed confirmation rather than a modal with a red button.
 * It is irreversible and it takes the applications and the consultant profile
 * with it, so it should cost more than a mis-tap.
 */
export function AccountSettings({
  locale,
  isEmployer,
  initial,
}: {
  locale: Locale;
  isEmployer: boolean;
  initial: Prefs;
}) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleting, startDeleting] = useTransition();

  const CONFIRM_WORD = t('deleteConfirmWord');

  function toggle(key: keyof Prefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaved(false);
    startTransition(async () => {
      const result = await updateNotificationPreferences(next);
      if (result.ok) setSaved(true);
      else setPrefs(prefs); // put the switch back rather than lie about it
    });
  }

  function onDelete() {
    setError(null);
    startDeleting(async () => {
      const result = await deleteMyAccount();
      if (result.ok) {
        router.replace('/', { locale });
        router.refresh();
        return;
      }
      setError(
        result.error === 'owns_company'
          ? t('deleteBlockedCompany')
          : result.error === 'unavailable'
            ? t('deleteUnavailable')
            : tCommon('errorBody'),
      );
    });
  }

  const ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
    ...(isEmployer
      ? [
          {
            key: 'notify_applications' as const,
            label: t('notifyApplications'),
            hint: t('notifyApplicationsHint'),
          },
        ]
      : []),
    { key: 'notify_status', label: t('notifyStatus'), hint: t('notifyStatusHint') },
    ...(isEmployer
      ? []
      : [{ key: 'notify_digest' as const, label: t('notifyDigest'), hint: t('notifyDigestHint') }]),
  ];

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-semibold">{t('emailsTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('emailsBody')}</p>

        <ul className="mt-5 space-y-3">
          {ROWS.map((row) => (
            <li key={row.key}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={prefs[row.key]}
                  onChange={() => toggle(row.key)}
                  disabled={pending}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span>
                  <span className="block text-sm font-medium">{row.label}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{row.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {saved ? <p className="mt-3 text-sm text-success">{tCommon('saveSuccess')}</p> : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-semibold">{t('exportTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('exportBody')}</p>
        <Button asChild variant="outline" className="mt-4">
          {/* A plain link, not fetch(): the browser's own download handling is
              better than anything reimplemented here. */}
          <a href="/api/account/export" download>
            <Download aria-hidden />
            {t('exportCta')}
          </a>
        </Button>
      </section>

      <section className="rounded-2xl border border-destructive/30 bg-destructive/[0.03] p-6">
        <h2 className="font-semibold text-destructive">{t('deleteTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isEmployer ? t('deleteBlockedCompany') : t('deleteBody')}
        </p>

        {isEmployer ? null : (
          <>
            <label className="mt-4 block text-sm">
              {t.rich('deleteConfirmLabel', {
                word: () => <span className="font-semibold">{CONFIRM_WORD}</span>,
              })}
              <input
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="mt-2 h-11 w-full max-w-xs rounded-lg border border-input bg-card px-3 shadow-xs"
                autoComplete="off"
              />
            </label>

            <Button
              type="button"
              variant="destructive"
              className="mt-4"
              disabled={confirm.trim() !== CONFIRM_WORD || deleting}
              onClick={onDelete}
            >
              {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              {t('deleteCta')}
            </Button>
          </>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
