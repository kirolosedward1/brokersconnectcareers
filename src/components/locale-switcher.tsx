'use client';

import { useTransition } from 'react';
import { useParams } from 'next/navigation';
import { Languages } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Swaps locale on the current route, preserving the path and its search
 * parameters — a reader who switches language mid-filter keeps their filters.
 */
export function LocaleSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [pending, startTransition] = useTransition();

  const next: Locale = locale === 'ar' ? 'en' : 'ar';

  function switchLocale() {
    startTransition(() => {
      router.replace(
        // @ts-expect-error — pathname is the already-resolved route for these params.
        { pathname, params },
        { locale: next },
      );
    });
  }

  return (
    <button
      type="button"
      onClick={switchLocale}
      disabled={pending}
      lang={next}
      dir={next === 'ar' ? 'rtl' : 'ltr'}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-muted sm:h-8 sm:px-2.5',
        pending && 'opacity-60',
      )}
    >
      <Languages className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
