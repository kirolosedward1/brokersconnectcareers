import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { Banknote, HandCoins, Scale, Sparkles, Target } from '~/components/ui/lucide';
import type { JobRow, SalaryReferenceRow } from '@/lib/supabase/database.types';
import { formatEgp } from '@/lib/format';
import { Num, TABULAR } from '~/components/ui/num';
import { Text } from '~/components/ui/text';
import { useCompensationText } from '~/features/jobs/compensation';
import { markupTags } from '~/i18n/rich';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

type Comp = Pick<
  JobRow,
  | 'basic_salary_min'
  | 'basic_salary_max'
  | 'commission_type'
  | 'commission_value'
  | 'commission_note_ar'
  | 'leads_source'
  | 'benefits'
>;

/**
 * What the role pays, above any prose — the website's CompensationCard, set
 * as the design's three tiles (JobDetail): the basic salary, the commission
 * and who brings the clients, side by side (stacked at the accessibility
 * sizes); then what listings like it pay, when the board has five of them to
 * say so, the commission's note, and the benefits.
 *
 * The listing is the one place a commission is shown (v1.1), with its terms.
 */
export function CompensationCard({ job, reference }: { job: Comp; reference: SalaryReferenceRow | null }) {
  const locale = useLocale();
  const t = useTranslations('compensation');
  const tLeads = useTranslations('leadsSource');
  const tBenefit = useTranslations('benefits');
  const tMoney = useTranslations('app.money');
  const { colors, shadow } = useTheme();
  const large = useLargeText();
  const pay = useCompensationText();
  const salary = pay.salary(job);
  const percent = job.commission_type === 'percentage' && job.commission_value != null ? job.commission_value : null;
  const hairline = { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border };
  // The board's tiles: a label, one figure, one line under it, centred in a third of the card.
  const tile = {
    flexGrow: 1,
    flexBasis: large ? '100%' : 0,
    minWidth: 0,
    gap: space[1],
    paddingVertical: space[4],
    paddingHorizontal: space[2],
    alignItems: large ? 'flex-start' : 'center',
  } as const;
  const centred = large ? null : ({ textAlign: 'center' } as const);
  const between = large ? hairline : { borderStartWidth: StyleSheet.hairlineWidth * 2, borderStartColor: colors.border };
  // The note's terms go under the rate; a note that only restates the rate is not said twice.
  const note = commissionNote(job.commission_note_ar, percent);

  return (
    <View
      style={{
        ...corner('xl'),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: colors.card,
        boxShadow: shadow.card,
      }}
    >
      <View style={{ flexDirection: large ? 'column' : 'row' }}>
        <View style={tile} accessible accessibilityLabel={`${t('basicSalary')}: ${salary.unit ? `${salary.figures} ${salary.unit}` : salary.figures}`}>
          <Label icon={<Banknote size={14} color={colors.mutedForeground} />}>{t('basicSalary')}</Label>
          {salary.unit ? (
            <>
              {/* A range on one line, made smaller to fit its third rather than broken at the dash. */}
              <Text
                variant="title"
                weight="bold"
                tone="primary"
                numberOfLines={large ? undefined : 1}
                adjustsFontSizeToFit={!large}
                minimumFontScale={0.55}
                style={[TABULAR, centred]}
              >
                {salary.figures}
              </Text>
              <Text variant="caption" tone="mutedForeground" style={centred}>
                {salary.unit}
              </Text>
            </>
          ) : (
            <Text weight="semibold" tone="mutedForeground" style={centred}>
              {salary.figures}
            </Text>
          )}
        </View>
        <View
          style={[tile, between]}
          accessible
          accessibilityLabel={`${t('commission')}: ${pay.commission(job, locale)}${note.terms ? ` ${note.terms}` : ''}`}
        >
          <Label icon={<HandCoins size={14} color={colors.mutedForeground} />}>{t('commission')}</Label>
          {percent !== null ? (
            <Num value={percent} percent variant="title" weight="bold" tone="goldForeground" />
          ) : (
            <Text weight="semibold" style={centred}>
              {pay.commission(job, locale)}
            </Text>
          )}
          {note.terms ? (
            <Text variant="caption" tone="mutedForeground" style={centred}>
              {note.terms}
            </Text>
          ) : null}
        </View>
        <View style={[tile, between]} accessible accessibilityLabel={`${t('leadsSource')}: ${tLeads(job.leads_source)}`}>
          <Label icon={<Target size={14} color={colors.mutedForeground} />}>{t('leadsSource')}</Label>
          <Text variant="small" weight="semibold" tone="primary" style={centred}>
            {tLeads(job.leads_source)}
          </Text>
        </View>
      </View>

      {reference || note.full ? (
        <View style={{ padding: space[4], gap: space[2], ...hairline }}>
          {reference ? (
            <View style={{ flexDirection: 'row', gap: space[1] }}>
              <Scale size={13} color={colors.mutedForeground} style={{ marginTop: 3 }} />
              <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }}>
                {tMoney.markup('reference', {
                  low: formatEgp(reference.low, locale),
                  high: formatEgp(reference.high, locale),
                  count: reference.sample,
                  ...markupTags,
                })}
              </Text>
            </View>
          ) : null}
          {note.full ? (
            <Text variant="small" tone="mutedForeground">
              {note.full}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ padding: space[4], gap: space[2], ...hairline }}>
        <Label icon={<Sparkles size={14} color={colors.mutedForeground} />}>{t('benefits')}</Label>
        {job.benefits.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {job.benefits.map((benefit) => (
              <View
                key={benefit}
                // A capsule on one line; rounded, not clipped, when a large size wraps it.
                style={{ paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.muted }}
              >
                <Text variant="small" weight="medium">
                  {tBenefit(benefit)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="small" tone="mutedForeground">
            {t('noBenefits')}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * The employer's commission note, split for the card. A note that opens with
 * the rate the tile already shows («عمولة 1.5٪ من قيمة الوحدة.») gives only
 * what follows it, as the tile's line («من قيمة الوحدة»); a short remainder
 * goes there, a long one stays below the tiles. A note that says something
 * else is kept whole, below. Nothing is shown twice.
 */
export function commissionNote(note: string | null | undefined, percent: number | null): { terms: string | null; full: string | null } {
  const text = note?.trim() ?? '';
  if (!text) return { terms: null, full: null };
  if (percent === null) return { terms: null, full: text };
  const digits = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.');
  const rate = /^(?:ال)?عمولة\s*(?:بنسبة\s*)?([0-9]+(?:\.[0-9]+)?)\s*[%٪]\s*/.exec(digits) ?? /^([0-9]+(?:\.[0-9]+)?)\s*[%٪]\s*/.exec(digits);
  if (!rate || Number(rate[1]) !== percent) return { terms: null, full: text };
  const rest = text.slice(rate[0].length).replace(/^[،,:\-–—\s]+/, '').replace(/[.。]\s*$/, '').trim();
  if (!rest) return { terms: null, full: null };
  return rest.length <= 40 ? { terms: rest, full: null } : { terms: null, full: rest };
}

function Label({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1.5] }}>
      {icon}
      <Text variant="caption" weight="medium" tone="mutedForeground">
        {children}
      </Text>
    </View>
  );
}
