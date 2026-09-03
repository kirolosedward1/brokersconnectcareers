'use client';

import { useTranslations } from 'next-intl';
import { Briefcase, Building2 } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * The two sides of the marketplace, as two real pages.
 *
 * Links rather than client-side tab state, because these are not two views of
 * one thing — they are two audiences with different questions, and each needs
 * its own URL: indexable on its own terms, linkable from an ad, and shareable
 * without "then click the other tab".
 *
 * `aria-current` rather than a tablist role for the same reason. This looks
 * like tabs, but it navigates, and describing navigation as a tablist tells a
 * screen reader to expect panels that do not exist.
 */
export function HomeTabs() {
  const t = useTranslations('landingPage.tabs');
  const pathname = usePathname();

  const tabs = [
    { href: '/', label: t('candidates'), icon: Briefcase },
    { href: '/employers', label: t('employers'), icon: Building2 },
  ] as const;

  return (
    <nav
      aria-label={t('label')}
      className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 p-1 backdrop-blur-md"
    >
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors sm:px-5',
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-white/75 hover:bg-white/10 hover:text-white',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
