'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { saveProfileRecord } from '@/lib/actions/cv';
import type { AgentProfileRow } from '@/lib/supabase/database.types';

/**
 * The objective and the sales record — the two things at the top of a real
 * estate CV, and the two an employer reads first.
 *
 * The completeness meter names the next most valuable thing to add rather than
 * only showing a percentage. A bar at 60% tells somebody they are incomplete;
 * it does not tell them what to do about it.
 */
export function ProfileRecordForm({
  agent,
  completeness,
}: {
  agent: AgentProfileRow;
  completeness: number;
}) {
  const t = useTranslations('cv');
  const tCommon = useTranslations('common');

  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const units = String(form.get('unitsClosed') ?? '');
    const volume = String(form.get('volumeEgp') ?? '');

    startTransition(async () => {
      const result = await saveProfileRecord({
        summaryAr: String(form.get('summaryAr') ?? ''),
        unitsClosed: units ? Number(units) : null,
        volumeEgp: volume ? Number(volume) : null,
      });
      if (result.ok) setSaved(true);
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <TrendingUp className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">{t('record')}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('recordHint')}</p>
          </div>
        </div>

        <div className="min-w-40">
          <p className="numeral text-sm font-medium">
            {t('completeness')} · {completeness}%
          </p>
          <div
            role="progressbar"
            aria-valuenow={completeness}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('completeness')}
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="bg-brand-gradient h-full rounded-full transition-[width] duration-500"
              style={{ width: `${completeness}%` }}
            />
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <Field label={t('objective')} htmlFor="summaryAr" hint={t('objectiveHint')}>
          <textarea
            id="summaryAr"
            name="summaryAr"
            rows={4}
            maxLength={1200}
            defaultValue={agent.summary_ar ?? ''}
            className="w-full rounded-lg border border-input bg-background p-3 text-sm leading-relaxed shadow-xs"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('unitsClosed')} htmlFor="unitsClosed">
            <Input
              id="unitsClosed"
              name="unitsClosed"
              type="number"
              min={0}
              max={100000}
              defaultValue={agent.units_closed ?? ''}
            />
          </Field>
          <Field label={t('volumeEgp')} htmlFor="volumeEgp">
            <Input
              id="volumeEgp"
              name="volumeEgp"
              type="number"
              min={0}
              step={1000}
              defaultValue={agent.volume_egp ?? ''}
            />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? tCommon('loading') : tCommon('save')}
          </Button>
          {saved ? <span className="text-sm text-success">{tCommon('saveSuccess')}</span> : null}
        </div>
      </form>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Building2 className="size-3.5" aria-hidden />
        {t('recordHint')}
      </p>
    </section>
  );
}
