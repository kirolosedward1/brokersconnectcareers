import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Info } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import type { CompanySignal, CompanySignals, ReportSeverity, SafetyFlag } from '@/lib/supabase/database.types';

/**
 * What the console shows a moderator beside a decision (migrations 208–209).
 *
 * Every line here is a fact to weigh, worded as one: "mentions a registration
 * fee", "shares a WhatsApp number with…", never "scammer" or "fraudulent".
 * None of it decides anything and none of it is ever shown outside the
 * console — the patterns behind it are exactly what a scam would like to read.
 */

const SEVERITY_VARIANT: Record<ReportSeverity, 'destructive' | 'warning' | 'outline'> = {
  3: 'destructive',
  2: 'warning',
  1: 'outline',
};

/** What the reporter alleged, ranked. Derived from the reason, not judged. */
export async function SeverityBadge({ severity }: { severity: ReportSeverity }) {
  const t = await getTranslations('admin');
  return (
    <Badge variant={SEVERITY_VARIANT[severity] ?? 'outline'} title={t('severityHint')}>
      {t(`severity.${severity}`)}
    </Badge>
  );
}

/** A listing's or a company's own words, flagged: high weight first, evidence quoted. */
export async function SafetyFlags({ flags, empty }: { flags: SafetyFlag[]; empty?: boolean }) {
  const t = await getTranslations('admin');
  const sorted = [...flags].sort((a, b) => (a.weight === b.weight ? 0 : a.weight === 'high' ? -1 : 1));

  if (sorted.length === 0) {
    return empty ? <p className="text-sm text-muted-foreground">{t('flagsNone')}</p> : null;
  }

  return (
    <ul className="space-y-1.5">
      {sorted.map((flag) => (
        <li
          key={flag.flag}
          className={
            flag.weight === 'high'
              ? 'flex items-start gap-2 text-sm text-warning'
              : 'flex items-start gap-2 text-sm text-muted-foreground'
          }
        >
          {flag.weight === 'high' ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0">
            <span className="font-medium">{t(`flag.${flag.flag}`)}</span>
            {flag.evidence ? (
              <span className="ms-1.5 break-words text-foreground/80" dir="auto">
                «{flag.evidence}»
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The high-weight flags as one short label, for a table cell. */
export async function FlagCount({ flags, locale }: { flags: SafetyFlag[]; locale: Locale }) {
  const t = await getTranslations('admin');
  const high = flags.filter((flag) => flag.weight === 'high');
  if (!high.length) return null;
  return (
    <Badge variant="warning" title={high.map((flag) => t(`flag.${flag.flag}`)).join(' · ')}>
      <AlertTriangle aria-hidden />
      {t('flagsCount', { count: formatNumber(high.length, locale) })}
    </Badge>
  );
}

function companies(
  refs: { id: string; name_ar: string; name_en: string | null; suspended: boolean }[],
  locale: Locale,
  suspendedLabel: string,
  separator: string,
) {
  return (
    <span className="ms-1">
      {refs.slice(0, 5).map((ref, index) => (
        <span key={ref.id}>
          {index ? separator : ''}
          <Link href={`/admin/companies/${ref.id}`} className="underline-offset-2 hover:underline">
            {localized(locale, ref.name_ar, ref.name_en)}
          </Link>
          {ref.suspended ? <span className="ms-1 text-destructive">({suspendedLabel})</span> : null}
        </span>
      ))}
    </span>
  );
}

/**
 * A company's raised signals, one sentence each. Only the raised ones: a list
 * of everything that is fine is a list nobody reads to the end.
 */
export async function CompanySignalList({
  signals,
  locale,
  empty,
}: {
  signals: CompanySignals | null;
  locale: Locale;
  empty?: boolean;
}) {
  const t = await getTranslations('admin');
  const list = signals?.signals ?? [];
  const n = (value: number) => formatNumber(value, locale);

  if (list.length === 0) {
    return empty ? <p className="text-sm text-muted-foreground">{t('signalsNone')}</p> : null;
  }

  const line = (signal: CompanySignal): React.ReactNode => {
    switch (signal.signal) {
      case 'mass_posting':
        return t('signal.mass_posting', { day: n(signal.day), week: n(signal.week) });
      case 'rejections':
        return t('signal.rejections', { count: n(signal.count) });
      case 'duplicate_listings':
        return t('signal.duplicate_listings', { count: n(signal.count) });
      case 'copied_listings':
        return (
          <>
            {t('signal.copied_listings')}
            {companies(signal.companies, locale, t('suspended'), t('listSeparator'))}
          </>
        );
      case 'reported':
        return t('signal.reported', { reporters: n(signal.reporters), reports: n(signal.reports) });
      case 'company_text':
        return t('signal.company_text', {
          flags: signal.flags.map((flag) => t(`flag.${flag.flag}`)).join(t('listSeparator')),
        });
      case 'flagged_listings':
        return t('signal.flagged_listings', { count: n(signal.count) });
      case 'shared_phone':
        return (
          <>
            {t('signal.shared_phone')}
            {companies(signal.companies, locale, t('suspended'), t('listSeparator'))}
          </>
        );
      case 'phone_of_suspended_account':
        return t('signal.phone_of_suspended_account', { count: n(signal.count) });
      case 'shared_website':
        return (
          <>
            {t('signal.shared_website', { site: signal.site })}
            {companies(signal.companies, locale, t('suspended'), t('listSeparator'))}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <ul className="space-y-1.5">
      {list.map((signal) => (
        <li key={signal.signal} className="flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 break-words">{line(signal)}</span>
        </li>
      ))}
    </ul>
  );
}
