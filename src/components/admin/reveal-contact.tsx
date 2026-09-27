'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { revealContact } from '@/lib/actions/admin';
import { isAdminErrorCode } from '@/lib/admin/errors';
import { whatsappLink } from '@/lib/utils';

/**
 * One account's email and phone, behind a reason.
 *
 * The details are held in this component's state and nowhere else: they are
 * not in the page's HTML, not in a URL, and gone on the next navigation. The
 * reason is recorded with the request (migration 316), so "who looked this
 * person up, and why" always has an answer.
 */
export function RevealContact({ userId }: { userId: string }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [contact, setContact] = useState<{ email: string | null; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || reason.trim().length < 3) return;
    startTransition(async () => {
      setError(null);
      try {
        const result = await revealContact({ userId, reason: reason.trim() });
        if (!result.ok) {
          setError(isAdminErrorCode(result.error) ? t(`errors.${result.error}`) : t('errors.unknown'));
          return;
        }
        setContact(result.data ?? null);
        setOpen(false);
        setReason('');
      } catch {
        setError(t('errors.network'));
      }
    });
  }

  if (contact) {
    return (
      <dl className="grid gap-1 rounded-lg border border-warning/40 bg-warning-muted/40 p-3 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{t('contactEmail')}</dt>
          <dd dir="ltr" className="break-all">{contact.email ?? '—'}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2">
          <dt className="text-muted-foreground">{t('contactPhone')}</dt>
          <dd dir="ltr" className="numeral">{contact.phone}</dd>
          <a
            href={whatsappLink(contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline"
          >
            <MessageCircle className="size-4" aria-hidden />
            WhatsApp
          </a>
        </div>
        <p className="text-xs text-muted-foreground">{t('contactRecorded')}</p>
      </dl>
    );
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Eye />
        {t('revealContact')}
      </Button>

      <Dialog open={open} onClose={() => !pending && setOpen(false)} label={t('revealContact')} closeLabel={tCommon('close')}>
        <form onSubmit={submit} className="space-y-4">
          <div className="pe-8">
            <h2 className="text-base font-semibold">{t('revealContact')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{t('revealContactBody')}</p>
          </div>
          <Field label={t('reasonLabel')} htmlFor={fieldId}>
            <Input
              id={fieldId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              required
              minLength={3}
            />
          </Field>
          {error ? (
            <p role="alert" className="rounded-lg bg-destructive-muted px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            <SubmitButton disabled={pending || reason.trim().length < 3}>
              {pending ? tCommon('loading') : t('revealContact')}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
