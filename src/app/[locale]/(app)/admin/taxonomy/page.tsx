import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Trash2 } from 'lucide-react';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { TaxonomyAdd, TaxonomyRow } from '@/components/admin/taxonomy-forms';
import { FilterTabs, PageHeader, Section } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { hrefWith, oneOf, param, type SearchParams } from '@/lib/admin/params';
import { COMPANY_TYPES, EMPLOYMENT_TYPES, EXPERIENCE_BANDS, JOB_TRACKS } from '@/lib/taxonomy';
import { formatNumber } from '@/lib/utils';
import type { DeveloperRow, DistrictRow, GovernorateRow, TaxonomyKind } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('taxonomy'), robots: { index: false, follow: false } };
}

const TABS = ['district', 'governorate', 'developer', 'fixed'] as const;

/**
 * The lists the product is built from.
 *
 * Locations and developers are rows: they can be added and renamed here, and
 * deleted only when nothing uses them — the database refuses the delete
 * otherwise (migration 69), including a district that only a consultant's
 * profile names, which no foreign key would have noticed. A slug is permanent
 * because it is part of public URLs.
 *
 * Tracks, experience bands, employment types and company types are fixed
 * lists that the posting form, the filters, the landing pages and search all
 * switch on. Changing one is a migration and a code change together, so this
 * page shows them and says so rather than offering a button that would
 * orphan every listing filed under the old value.
 */
export default async function AdminTaxonomyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const tab = oneOf(param(await searchParams, 'kind'), TABS, 'district');
  const supabase = await createClient();
  const t = await getTranslations('admin');

  const tabs = (
    <FilterTabs
      label={t('taxonomy')}
      items={TABS.map((value) => ({
        key: value,
        label: t(`taxonomyTab.${value}`),
        href: hrefWith('/admin/taxonomy', {}, { kind: value === 'district' ? undefined : value }),
        active: tab === value,
      }))}
    />
  );

  if (tab === 'fixed') {
    const tTrack = await getTranslations('track');
    const tBand = await getTranslations('experienceBand');
    const tEmployment = await getTranslations('employmentType');
    const tCompanyType = await getTranslations('companyType');
    const lists = [
      { title: t('track'), items: JOB_TRACKS.map((v) => [v, tTrack(v)]) },
      { title: t('experience'), items: EXPERIENCE_BANDS.map((v) => [v, tBand(v)]) },
      { title: t('employmentType'), items: EMPLOYMENT_TYPES.map((v) => [v, tEmployment(v)]) },
      { title: t('companyType'), items: COMPANY_TYPES.map((v) => [v, tCompanyType(v)]) },
    ];
    return (
      <div className="space-y-5">
        <PageHeader title={t('taxonomy')} lede={t('taxonomyLede')} />
        {tabs}
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t('fixedListsHint')}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {lists.map((list) => (
            <Section key={list.title} title={list.title}>
              <ul className="divide-y divide-border text-sm">
                {list.items.map(([value, label]) => (
                  <li key={value} className="flex items-center justify-between gap-2 py-1.5">
                    <span>{label}</span>
                    <code dir="ltr" className="text-xs text-muted-foreground">{value}</code>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      </div>
    );
  }

  const kind = tab as TaxonomyKind;
  const table = kind === 'district' ? 'districts' : kind === 'governorate' ? 'governorates' : 'developers';

  const [rowsRead, usageRead, governoratesRead] = await Promise.all([
    supabase.from(table).select('*').order(kind === 'developer' ? 'name_en' : 'id'),
    supabase.rpc('admin_taxonomy_usage', { p_kind: kind }),
    supabase.from('governorates').select('*').order('id'),
  ]);
  const rows = must(rowsRead, `loading ${table}`).data as (DistrictRow | GovernorateRow | DeveloperRow)[];
  const usage = new Map(must(usageRead, 'counting taxonomy use').data.map((u) => [u.id, Number(u.uses)]));
  const governorates = (must(governoratesRead, 'loading governorates').data as GovernorateRow[]).map((g) => ({
    id: g.id,
    label: localized(locale, g.name_ar, g.name_en),
  }));

  return (
    <div className="space-y-5">
      <PageHeader title={t('taxonomy')} lede={t('taxonomyLede')} />
      {tabs}

      <Section title={t('addEntry')}>
        <TaxonomyAdd kind={kind} governorates={kind === 'district' ? governorates : undefined} />
      </Section>

      <Section title={t('entriesCount', { count: formatNumber(rows.length, locale) })}>
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const uses = usage.get(row.id) ?? 0;
            return (
              <li key={row.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <TaxonomyRow
                    kind={kind}
                    id={row.id}
                    nameAr={row.name_ar}
                    nameEn={row.name_en}
                    slug={row.slug}
                    governorateId={'governorate_id' in row ? row.governorate_id : undefined}
                    governorates={kind === 'district' ? governorates : undefined}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {uses > 0 ? (
                    <Badge variant="outline">{t('inUse', { count: formatNumber(uses, locale) })}</Badge>
                  ) : (
                    <ConfirmAction
                      lever={{ do: 'deleteTaxonomy', kind, id: row.id }}
                      label={t('deleteEntry')}
                      title={t('deleteEntryTitle', { name: row.name_ar })}
                      body={t('deleteEntryBody')}
                      variant="ghost"
                      icon={<Trash2 />}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
