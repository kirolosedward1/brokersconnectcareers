import { MailWarning } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { configuredValue } from '@/lib/env';

/**
 * The application cannot send email, said where an admin will see it.
 *
 * deliver() never throws: with no service role it warns and returns
 * "skipped", with no sender it does the same. That is the right behaviour for
 * a request — a missing variable must not turn an application into an error
 * on somebody's screen — and the wrong behaviour for a deployment, because it
 * ran that way on production for days. The email page had a warning; nobody
 * opens the email page when they believe email works.
 *
 * Reads the environment directly rather than the health endpoint: this
 * renders on the server, in the same process, and a fetch to itself would be
 * a round trip to learn what process.env already knows.
 */
export async function MailOffBanner() {
  const missing = [
    ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
    ['RESEND_API_KEY', process.env.RESEND_API_KEY],
    ['RESEND_FROM', process.env.RESEND_FROM],
    ['RESEND_WEBHOOK_SECRET', process.env.RESEND_WEBHOOK_SECRET],
  ]
    .filter(([, value]) => !configuredValue(value))
    .map(([name]) => name);

  if (missing.length === 0) return null;

  const t = await getTranslations('admin');

  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
    >
      <MailWarning className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{t('mailOffTitle')}</p>
        <p className="mt-1 text-muted-foreground">{t('mailOffBody')}</p>
        {/* Variable names only — never values. This page is behind the admin
            gate, but a name is all the fix needs and a value is a leak. */}
        <p className="mt-2 font-mono text-xs" dir="ltr">
          {missing.join(' · ')}
        </p>
      </div>
    </div>
  );
}
