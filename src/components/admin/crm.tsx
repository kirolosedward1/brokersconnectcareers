import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Facts } from '@/components/admin/kit';
import { whatsappLink } from '@/lib/utils';
import { FIRST_SOURCES, type FirstSource } from '@/lib/attribution';

/** «تجريبي» — a row we planted, not a person or a company out in the market. */
export async function TestBadge() {
  const t = await getTranslations('admin');
  return <Badge variant="warning">{t('testBadge')}</Badge>;
}

export type ShownContact = {
  email: string | null;
  phone: string;
  emailConfirmed: boolean;
};

/**
 * Email, phone, and the place, already on the page.
 *
 * An admin does not press anything to see them. The look itself was recorded
 * when the page asked the database for them.
 */
export async function ContactLines({
  name,
  contact,
  place,
  providers,
}: {
  name: string;
  contact: ShownContact | null;
  place?: string | null;
  providers?: string[];
}) {
  const t = await getTranslations('admin');
  const phone = contact?.phone?.trim() || '';
  const email = contact?.email?.trim() || '';

  return (
    <Facts
      items={[
        { label: t('colName'), value: name },
        {
          label: t('contactEmail'),
          value: email ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <a href={`mailto:${email}`} dir="ltr" className="text-primary hover:underline">
                {email}
              </a>
              <Badge variant={contact?.emailConfirmed ? 'success' : 'outline'}>
                {contact?.emailConfirmed ? t('emailVerified') : t('emailUnverified')}
              </Badge>
            </span>
          ) : (
            '—'
          ),
        },
        {
          label: t('contactPhone'),
          value: phone ? (
            <span className="inline-flex flex-wrap items-center gap-3">
              <a href={`tel:${phone}`} dir="ltr" className="numeral text-primary hover:underline">
                {phone}
              </a>
              <a href={whatsappLink(phone)} className="text-primary hover:underline">
                {t('whatsapp')}
              </a>
            </span>
          ) : (
            '—'
          ),
        },
        { label: t('address'), value: place || '—' },
        {
          label: t('providers'),
          value: providers?.length ? providers.map((provider) => providerLabel(t, provider)).join(' · ') : '—',
        },
      ]}
    />
  );
}

function providerLabel(t: Awaited<ReturnType<typeof getTranslations<'admin'>>>, provider: string): string {
  if (provider === 'google' || provider === 'apple' || provider === 'email') return t(`provider_${provider}`);
  return provider;
}

/** «مصدر الزيارة الأولى», or «غير معروف» when the account predates the record. */
export async function FirstVisit({
  source,
  medium,
  campaign,
  referrer,
  landingPath,
  seenAt,
  locale,
}: {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  seenAt?: string | null;
  locale: string;
}) {
  const t = await getTranslations('admin');
  const known = source && (FIRST_SOURCES as readonly string[]).includes(source);
  const { formatDate } = await import('@/lib/utils');
  return (
    <Facts
      items={[
        {
          label: t('firstVisit'),
          value: known ? t(`source_${source as FirstSource}`) : t('sourceUnknown'),
        },
        ...(medium ? [{ label: t('sourceMedium'), value: medium }] : []),
        ...(campaign ? [{ label: t('sourceCampaign'), value: campaign }] : []),
        ...(referrer ? [{ label: t('sourceReferrer'), value: <span dir="ltr">{referrer}</span> }] : []),
        ...(landingPath ? [{ label: t('sourcePath'), value: <span dir="ltr">{landingPath}</span> }] : []),
        ...(seenAt ? [{ label: t('sourceSeen'), value: formatDate(seenAt, locale) }] : []),
      ]}
    />
  );
}
