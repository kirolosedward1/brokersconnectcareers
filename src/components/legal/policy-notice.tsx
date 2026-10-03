import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getViewer } from '@/lib/auth';
import { asksToAgree } from '@/lib/policies';
import { cn } from '@/lib/utils';
import { AcceptPoliciesButton } from '@/components/legal/accept-policies-button';

/**
 * Asks somebody signed in to agree to the Terms of use and the Privacy policy
 * as they are published now: an account made before agreements were recorded,
 * or a document changed since its owner last agreed (getPolicyStatus).
 *
 * Not a wall. The privacy policy promises notice of material changes before
 * they apply, and this is that notice; the account works either way, and
 * nothing is asked when the record cannot be read, since nothing asked could
 * be kept.
 *
 * `inset` for the console, where it sits in the content column as a card;
 * otherwise a band under the site header.
 */
export async function PolicyNotice({ inset = false }: { inset?: boolean }) {
  if (!(await asksToAgree(await getViewer()))) return null;

  const t = await getTranslations('legal');
  const link = (href: '/terms' | '/privacy') =>
    function PolicyLink(chunks: React.ReactNode) {
      return (
        <Link href={href} target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
          {chunks}
        </Link>
      );
    };

  return (
    <section
      aria-labelledby="policy-notice-title"
      className={cn(
        'border-primary/20 bg-primary/[0.04]',
        inset ? 'mb-6 rounded-xl border p-4' : 'border-b',
      )}
    >
      <div
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
          inset ? null : 'shell py-3',
        )}
      >
        <div className="text-sm">
          <p id="policy-notice-title" className="font-medium">
            {t('updatedTitle')}
          </p>
          <p className="mt-0.5 leading-relaxed text-muted-foreground">
            {t.rich('updatedBody', { terms: link('/terms'), privacy: link('/privacy') })}
          </p>
        </div>
        <AcceptPoliciesButton label={t('agree')} failedLabel={t('agreeFailed')} />
      </div>
    </section>
  );
}
