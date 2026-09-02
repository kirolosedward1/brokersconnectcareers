import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckCircle2, MailX, TriangleAlert } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const t = await getTranslations({ locale: asLocale(rawLocale), namespace: 'unsubscribe' });
  return {
    title: t('title'),
    // Nothing here should ever be indexed: the URLs carry a credential.
    robots: { index: false, follow: false },
  };
}

const KINDS = ['notify_applications', 'notify_status', 'notify_digest'] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string | undefined): value is Kind {
  return !!value && (KINDS as readonly string[]).includes(value);
}

/**
 * The page an unsubscribe link opens.
 *
 * It asks before it acts. The link in an email cannot do the unsubscribing
 * itself, because mail clients and security scanners follow links in messages
 * without anyone clicking them — so the actual change is a POST from the form
 * below. Gmail's own unsubscribe button skips this page entirely and posts
 * straight to the API, which is what RFC 8058 asks for.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; kind?: string; state?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const { token, kind, state } = await searchParams;
  const t = await getTranslations('unsubscribe');
  const tCommon = await getTranslations('common');

  const outcome =
    state === 'done' || state === 'failed' || state === 'invalid'
      ? state
      : !token || !isKind(kind)
        ? 'invalid'
        : 'confirm';

  const icon = {
    done: <CheckCircle2 className="size-7 text-success" aria-hidden />,
    confirm: <MailX className="size-7 text-primary" aria-hidden />,
    failed: <TriangleAlert className="size-7 text-destructive" aria-hidden />,
    invalid: <TriangleAlert className="size-7 text-destructive" aria-hidden />,
  }[outcome];

  const heading = { done: t('done'), confirm: t('confirm'), failed: t('failed'), invalid: t('invalid') }[
    outcome
  ];
  const body = {
    done: t('doneBody'),
    confirm: t('confirmBody'),
    failed: t('failedBody'),
    invalid: t('invalidBody'),
  }[outcome];

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-muted">{icon}</span>

      <h1 className="text-xl font-semibold">{heading}</h1>
      <p className="mt-2 text-muted-foreground">{body}</p>

      {outcome === 'confirm' && isKind(kind) ? (
        <>
          <p className="mt-5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium">
            {t(`kinds.${kind}`)}
          </p>

          <form action="/api/unsubscribe" method="post" className="mt-6">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="kind" value={kind} />
            <Button type="submit" size="lg">
              {t('button')}
            </Button>
          </form>
        </>
      ) : null}

      <Button asChild variant="ghost" className="mt-6">
        <Link href="/">{tCommon('goHome')}</Link>
      </Button>
    </div>
  );
}
