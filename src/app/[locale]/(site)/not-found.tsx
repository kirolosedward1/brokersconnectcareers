import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('common');

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="numeral text-5xl font-bold text-muted-foreground">404</p>
      <h1 className="mt-4 text-xl font-semibold">{t('notFound')}</h1>
      <p className="mt-2 text-muted-foreground">{t('notFoundBody')}</p>
      <Button asChild className="mt-6">
        <Link href="/">{t('goHome')}</Link>
      </Button>
    </div>
  );
}
