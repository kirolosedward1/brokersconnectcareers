import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

/**
 * Deliberately empty. Privacy and terms for a board that stores CVs and phone
 * numbers and handles Egyptian employer data are a lawyer's job, not generated
 * text — the routes exist so the footer links resolve, and nothing more.
 */
export function LegalPlaceholder({ title }: { title: string }) {
  const t = useTranslations('common');

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-4 text-muted-foreground">{t('loading')}</p>
      <Button asChild variant="outline" className="mt-8">
        <Link href="/">{t('goHome')}</Link>
      </Button>
    </div>
  );
}
