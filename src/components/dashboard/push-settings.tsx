'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { updatePushPreferences } from '@/lib/actions/account';
import { reach } from '@/lib/reach';
import { useSessionRecovery } from '@/lib/session-expired';
import type { PushPreferences } from '@/lib/push-preferences';

/**
 * Which pushes reach the person's phones. One switch at a time, the way the
 * app saves them, so an older copy of the others is not written back.
 */
export function PushSettings({ initial, employer }: { initial: PushPreferences; employer: boolean }) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  const rows: { key: keyof PushPreferences; label: string; hint: string }[] = [
    { key: 'push_job_alerts', label: t('pushJobAlerts'), hint: t('pushJobAlertsHint') },
    {
      key: 'push_applications',
      label: employer ? t('pushApplicationsEmployer') : t('pushApplications'),
      hint: employer ? t('pushApplicationsEmployerHint') : t('pushApplicationsHint'),
    },
    {
      key: 'push_account',
      label: employer ? t('pushAccountEmployer') : t('pushAccount'),
      hint: employer ? t('pushAccountEmployerHint') : t('pushAccountHint'),
    },
    { key: 'push_quiet_hours', label: t('pushQuiet'), hint: t('pushQuietHint') },
  ];

  function toggle(key: keyof PushPreferences) {
    const next = !prefs[key];
    setPrefs({ ...prefs, [key]: next });
    setSaved(false);
    setError(false);
    startTransition(async () => {
      const result = await reach(updatePushPreferences({ [key]: next }));
      if (recoverSession(result)) return;
      if (result.ok) setSaved(true);
      else {
        setPrefs(prefs);
        setError(true);
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="font-semibold">{t('pushKindsTitle')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('pushKindsBody')}</p>
      <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
        {rows.map((row) => (
          <li key={row.key}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/50">
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
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {tCommon('errorBody')}
        </p>
      ) : null}
    </section>
  );
}
