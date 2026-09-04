import { getTranslations } from 'next-intl/server';
import { Building2, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { Audience } from '@/app/[locale]/auth-shell';

/**
 * Which side of the marketplace this form is for.
 *
 * The two doors already existed; nothing on either one said the other was
 * there. Somebody who lands on the consultant sign-up because that is the
 * link they were sent had to go back to the marketing site to find the
 * employer one.
 *
 * Links, not tabs. Each option is a real page with its own URL, title and
 * panel copy — a tablist would claim these are panels of one widget, and
 * every one of them is shareable on its own.
 *
 * The labels are the onboarding ones on purpose. This asks the same question
 * onboarding asks, and two sets of words for one choice drift apart.
 */
export async function AudienceSwitch({
  mode,
  active,
}: {
  mode: 'sign-in' | 'sign-up';
  /** Absent on the neutral routes, where neither side is chosen yet. */
  active?: Audience;
}) {
  const t = await getTranslations('onboarding');

  const options = [
    { key: 'candidate' as const, label: t('roleCandidate'), icon: UserRound },
    { key: 'employer' as const, label: t('roleEmployer'), icon: Building2 },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/60 p-1"
      role="group"
      aria-label={t('roleQuestion')}
    >
      {options.map(({ key, label, icon: Icon }) => {
        const current = active === key;
        return (
          <Link
            key={key}
            href={`/${mode}/${key}`}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              current
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
