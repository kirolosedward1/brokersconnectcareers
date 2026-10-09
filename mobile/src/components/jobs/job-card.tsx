import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { VerifiedMark } from '~/components/companies/verified-mark';
import { Ban, Bookmark, BookmarkCheck, CircleSlash, EyeOff, FileText, Share2, Sparkles, Star, Target } from '~/components/ui/lucide';
import type { JobListItem } from '@/lib/job-list';
import { formatList, formatNumber, formatRelativeDay } from '@/lib/format';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { CompanyLogo } from '~/components/companies/company-logo';
import { SaveJobIcon, useSaveJob } from '~/components/saved/save-controls';
import { useCompensationText } from '~/features/jobs/compensation';
import { useJobMatch } from '~/features/jobs/match';
import { markupTags } from '~/i18n/rich';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';
import { toast } from '~/components/feedback/toast';
import { ActionMenu, type MenuItem } from '~/components/ui/action-menu';
import { shareJobLink } from '~/features/jobs/share';
import { hideCompany, unhideCompany } from '~/features/moderation/hidden-companies';
import { hideJob, unhideJob } from '~/features/moderation/hidden-jobs';
import { dialog } from '~/lib/dialog';
import { haptic } from '~/lib/haptics';
import { useSheet } from '~/lib/use-sheet';
import { SwipeCard } from './swipe-card';

/**
 * A listing in a list — the website's JobCard, the same facts set as a card
 * to be read in one look: who is hiring and where, then what it pays — the
 * salary first and largest, the commission and where the clients come from
 * beside it — and under a hairline the kind of role, the experience asked
 * for, the seats and how fresh it is. A candidate can bookmark it from here
 * without opening it (the website's card toggle).
 *
 * Held, it offers what can be done with it without opening it: save, share,
 * hide it or everything from its company. On the board (`swipeable`) it is
 * also swiped: right to save, left to set it aside — each with Undo.
 */
export function JobCard({ job, applied = false, swipeable = false }: { job: JobListItem; applied?: boolean; swipeable?: boolean }) {
  const locale = useLocale();
  const t = useTranslations();
  const { colors } = useTheme();
  const pay = useCompensationText();
  const save = useSaveJob(job.id);
  const menu = useSheet();
  // At the accessibility sizes nothing is cut short: the title and company in
  // full, and the footer's facts above the date rather than squeezed by it.
  const large = useLargeText();

  // How well it fits the candidate's own profile, when it fits at all (features/jobs/match.ts).
  // Not on a listing already applied to: the fit was weighed when applying.
  const fit = useJobMatch()(job);
  const match = applied ? null : fit;
  const closed = !jobIsLive(job);
  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const district = localized(locale, job.district.name_ar, job.district.name_en);
  const salary = pay.salary(job, locale);
  const companyLeads = job.leads_source === 'company_provided';
  const leadsTone = companyLeads ? colors.primary : colors.mutedForeground;
  const flags = job.is_featured || closed || applied || match;
  const commission = job.commission_type === 'percentage' && job.commission_value != null ? pay.commission(job, locale) : null;
  const facts = [
    t(`track.${job.track}`),
    t(`experienceBand.${job.experience_band}`),
    `${formatNumber(job.seats, locale)} ${t('jobs.seatsLabel', { count: job.seats })}`,
  ].join(' · ');

  // One element to VoiceOver, so it says everything the card shows: who and
  // where, then what is true of it (featured, closed, applied to), what it
  // pays and the rest — a closed listing read as an open one was the cost.
  const spoken = [
    formatList([title, company, district], locale),
    job.company.verification_status === 'verified' ? t('companies.verified') : null,
    job.is_featured ? t('jobs.featured') : null,
    closed ? t('jobs.closedShort') : null,
    applied ? t('jobs.applied') : null,
    match ? t.markup('app.jobs.match', { percent: match.percent, ...markupTags }) : null,
    salary.perMonth ? `${salary.amount} ${salary.perMonth}` : salary.amount,
    commission,
    t(`leadsSource.${job.leads_source}_short`),
    facts,
    job.published_at ? formatRelativeDay(job.published_at, locale) : null,
  ]
    .filter(Boolean)
    .join('. ');

  const open = () => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } });
  const hideThis = () => {
    hideJob(job.id, { name: title, slug: job.slug });
    toast.show({
      message: t('app.toast.jobHidden'),
      icon: EyeOff,
      action: { label: t('app.toast.undo'), onPress: () => unhideJob(job.id) },
    });
  };
  const hideTheCompany = () =>
    dialog.alert(t('app.moderation.hideTitle', { company }), t('app.moderation.hideBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('app.moderation.hideConfirm'),
        style: 'destructive',
        onPress: () => {
          hideCompany(job.company.id, { name: company, slug: job.company.slug });
          toast.show({
            message: t('app.toast.companyHidden', { company }),
            icon: Ban,
            action: { label: t('app.toast.undo'), onPress: () => unhideCompany(job.company.id) },
          });
        },
      },
    ]);
  const share = () => shareJobLink({ slug: job.slug, title });

  const items: MenuItem[] = [
    { label: t('app.jobMenu.open'), icon: FileText, onPress: open },
    ...(save.savable && !save.pending ? [{ label: save.label, icon: save.saved ? BookmarkCheck : Bookmark, onPress: save.toggle }] : []),
    { label: t('app.jobMenu.share'), icon: Share2, onPress: share },
    { label: t('app.jobMenu.hideJob'), icon: EyeOff, onPress: hideThis },
    { label: t('app.jobMenu.hideCompany'), icon: Ban, onPress: hideTheCompany, destructive: true },
  ];

  const card = (
    <Card
      onPress={open}
      onLongPress={() => {
        haptic.tap();
        menu.show();
      }}
      accessibilityLabel={spoken}
      accessibilityActions={[
        ...(save.savable ? [{ name: 'save', label: save.label }] : []),
        { name: 'share', label: t('app.jobMenu.share') },
        { name: 'hide', label: t('app.jobMenu.hideJob') },
      ]}
      onAccessibilityAction={(event) => {
        const action = event.nativeEvent.actionName;
        if (action === 'save') save.toggle();
        if (action === 'share') share();
        if (action === 'hide') hideThis();
      }}
    >
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <CompanyLogo name={company} logoUrl={job.company.logo_url} seed={job.company.slug} size="sm" />

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
            <Text
              variant="headline"
              weight="semibold"
              tone={closed ? 'mutedForeground' : 'foreground'}
              numberOfLines={large ? undefined : 2}
              style={{ flex: 1 }}
            >
              {title}
            </Text>
            {save.savable ? <SaveJobIcon save={save} /> : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[1], rowGap: 2 }}>
            <Text variant="small" weight="medium" numberOfLines={large ? undefined : 1} style={{ flexShrink: 1 }}>
              {company}
            </Text>
            {job.company.verification_status === 'verified' ? (
              <VerifiedMark size={15} />
            ) : null}
            <Text variant="small" tone="mutedForeground">
              {` · ${district}`}
            </Text>
          </View>
        </View>
      </View>

      {flags ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginTop: space[3] }}>
          {job.is_featured ? (
            <Badge variant="primary" label={t('jobs.featured')} icon={<Star size={11} color={colors.primary} />} />
          ) : null}
          {closed ? (
            <Badge label={t('jobs.closedShort')} icon={<CircleSlash size={11} color={colors.mutedForeground} />} />
          ) : null}
          {applied ? <Badge variant="success" label={t('jobs.applied')} /> : null}
          {match ? (
            <Badge
              variant="accent"
              label={t.markup('app.jobs.match', { percent: match.percent, ...markupTags })}
              icon={<Sparkles size={11} color={colors.accentForeground} />}
            />
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: space[3], gap: 2 }}>
        <Text variant="body">
          <Text weight="semibold">{salary.amount}</Text>
          {salary.perMonth ? <Text variant="small" tone="mutedForeground">{` ${salary.perMonth}`}</Text> : null}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[3], rowGap: 2 }}>
          {commission ? (
            <Text variant="small" weight="medium">
              {commission}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Target size={13} color={leadsTone} />
            <Text variant="small" weight={companyLeads ? 'medium' : 'regular'} style={{ color: leadsTone }}>
              {t(`leadsSource.${job.leads_source}_short`)}
            </Text>
          </View>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: space[3],
          rowGap: 2,
          marginTop: space[3],
          paddingTop: space[3],
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: colors.border,
        }}
      >
        <Text variant="caption" tone="mutedForeground" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160 }}>
          {facts}
        </Text>
        {job.published_at ? (
          <Text variant="caption" tone="mutedForeground">
            {formatRelativeDay(job.published_at, locale)}
          </Text>
        ) : null}
      </View>
    </Card>
  );

  return (
    <>
      {swipeable ? (
        <SwipeCard
          key={job.id}
          right={
            save.savable && !save.pending
              ? {
                  label: save.saved ? t('app.jobMenu.swipeUnsave') : t('app.jobMenu.swipeSave'),
                  icon: save.saved ? Bookmark : BookmarkCheck,
                  ground: colors.accent,
                  ink: colors.accentForeground,
                  onSwipe: save.toggle,
                }
              : undefined
          }
          left={{ label: t('app.jobMenu.swipeHide'), icon: EyeOff, ground: colors.secondary, ink: colors.secondaryForeground, leaves: true, onSwipe: hideThis }}
        >
          {card}
        </SwipeCard>
      ) : (
        card
      )}
      {menu.mounted ? (
        <ActionMenu
          visible={menu.open}
          onClose={menu.hide}
          onDismiss={menu.onDismiss}
          items={items}
          header={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <CompanyLogo name={company} logoUrl={job.company.logo_url} seed={job.company.slug} size="sm" />
              <View style={{ flex: 1 }}>
                <Text weight="semibold" numberOfLines={2}>
                  {title}
                </Text>
                <Text variant="small" tone="mutedForeground" numberOfLines={1}>
                  {`${company} · ${district}`}
                </Text>
              </View>
            </View>
          }
        />
      ) : null}
    </>
  );
}
