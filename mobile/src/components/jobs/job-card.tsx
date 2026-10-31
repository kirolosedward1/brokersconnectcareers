import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { VerifiedMark } from '~/components/companies/verified-mark';
import { Ban, Bookmark, BookmarkCheck, CircleSlash, EyeOff, FileText, Share2, Sparkles } from '~/components/ui/lucide';
import type { JobListItem } from '@/lib/job-list';
import { formatList, formatNumber, formatRelativeDay } from '@/lib/format';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { TABULAR } from '~/components/ui/num';
import { Text } from '~/components/ui/text';
import { CompanyLogo } from '~/components/companies/company-logo';
import { SaveJobIcon, useSaveJob } from '~/components/saved/save-controls';
import { useCompensationText } from '~/features/jobs/compensation';
import { useJobMatch } from '~/features/jobs/match';
import { markupTags } from '~/i18n/rich';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { iconSize, radius, space } from '~/theme/tokens';
import { toast } from '~/components/feedback/toast';
import { ActionMenu, type MenuItem } from '~/components/ui/action-menu';
import { shareJobLink } from '~/features/jobs/share';
import { hideCompany, unhideCompany } from '~/features/moderation/hidden-companies';
import { hideJob, unhideJob } from '~/features/moderation/hidden-jobs';
import { haptic } from '~/lib/haptics';
import { useSheet } from '~/lib/use-sheet';
import { useFewerLikeThis } from './fewer-like-this';
import { SwipeCard } from './swipe-card';
import { ZoomLink } from './zoom-link';

/**
 * A listing in a list — the website's JobCard, the same facts set as a card
 * to be read in one look, the same card wherever listings are listed (Home,
 * the board, Saved, a company's page, an area's landing): who is hiring —
 * their logo or the generic building, their name cut short with an ellipsis
 * rather than wrapped, where and how fresh — then the role, then what it pays:
 * the basic salary, the largest thing on the card, with its currency and
 * «/ شهر», in the primary ink. Under it the facts as chips: who brings the
 * clients (in champagne when it is the company), the track, and the open
 * seats when there is more than one (the experience asked otherwise), then
 * closed and how well it fits. A sponsored listing has a champagne edge and
 * its name on a tab at the top. Never the commission: the listing states it,
 * with its terms. A candidate can bookmark it from here without opening it
 * (the website's card toggle); once they have applied, «قدّمت» stands there
 * instead. The design's card (Components, Jobs boards).
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
  const salary = pay.salary(job);
  const companyLeads = job.leads_source === 'company_provided';
  const age = job.published_at ? formatRelativeDay(job.published_at, locale) : null;
  // More than one seat is worth a chip of its own; one seat says nothing, and the experience asked does.
  const seatsOrExperience =
    job.seats > 1
      ? `${formatNumber(job.seats, locale)} ${t('jobs.seatsLabel', { count: job.seats })}`
      : // A span of years reads right to left, the fewer years at the right.
        `\u2067${t(`experienceBand.${job.experience_band}`)}\u2069`;
  // The company bringing the clients is the fact a broker looks for first: in champagne, the rest muted.
  const chips = [
    { key: 'leads', label: t(`leadsSource.${job.leads_source}_short`), variant: companyLeads ? ('accent' as const) : ('default' as const) },
    { key: 'track', label: t(`track.${job.track}`), variant: 'default' as const },
  ];
  // Two chips on the card (owner's call, 31 Oct: save space); the seats or years are on the listing, and VoiceOver hears them.
  const fitLabel = seatsOrExperience;

  // One element to VoiceOver, so it says everything the card shows, in the
  // order it shows it: who and where, what it pays and who brings the
  // clients, then what is true of it (featured, closed, applied to) and the
  // rest — a closed listing read as an open one was the cost.
  const spoken = [
    formatList([title, company, district], locale),
    job.company.verification_status === 'verified' ? t('companies.verified') : null,
    salary.unit ? `${salary.figures} ${salary.unit}` : salary.figures,
    ...chips.map((chip) => chip.label),
    fitLabel,
    job.is_featured ? t('jobs.featured') : null,
    closed ? t('jobs.closedShort') : null,
    applied ? t('app.jobs.appliedChip') : null,
    match ? t.markup('app.jobs.match', { percent: match.percent, ...markupTags }) : null,
    age,
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
  // At once, as hiding the one listing is: Undo is the way back, not a question first.
  const hideTheCompany = () => {
    hideCompany(job.company.id, { name: company, slug: job.company.slug });
    toast.show({
      message: t('app.toast.companyHidden', { company }),
      icon: Ban,
      action: { label: t('app.toast.undo'), onPress: () => unhideCompany(job.company.id) },
    });
  };
  const share = () => shareJobLink({ slug: job.slug, title });
  const fewer = useFewerLikeThis(job);

  const items: MenuItem[] = [
    { label: t('app.jobMenu.open'), icon: FileText, onPress: open },
    ...(save.savable && !save.pending ? [{ label: save.label, icon: save.saved ? BookmarkCheck : Bookmark, onPress: save.toggle }] : []),
    { label: t('app.jobMenu.share'), icon: Share2, onPress: share },
    ...(fewer ? [fewer] : []),
    { label: t('app.jobMenu.hideJob'), icon: EyeOff, onPress: hideThis },
    { label: t('app.jobMenu.hideCompany'), icon: Ban, onPress: hideTheCompany, destructive: true },
  ];

  // The card, pressed to open the listing — by itself, or (zoomed) by the link around it.
  const drawn = (onPress?: () => void) => (
    <Card
      onPress={onPress}
      // Tighter than a card's own padding: more listings to a screen (owner's call, 31 Oct).
      style={job.is_featured ? { padding: space[3], borderColor: colors.champagne, borderWidth: 1 } : { padding: space[3] }}
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
        if (action === 'save' && !save.pending) save.toggle();
        if (action === 'share') share();
        if (action === 'hide') hideThis();
      }}
    >
      {/* Sponsored: a champagne edge and its name on a tab at the card's top end, as the design draws it. */}
      {job.is_featured ? (
        <View
          style={{
            position: 'absolute',
            top: -1,
            end: space[4],
            paddingHorizontal: space[2.5],
            paddingVertical: space[0.5],
            borderBottomStartRadius: radius.md,
            borderBottomEndRadius: radius.md,
            backgroundColor: colors.champagne,
          }}
        >
          <Text variant="label" weight="semibold" style={{ color: colors.champagneForeground }}>
            {t('jobs.featured')}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2.5] }}>
        <CompanyLogo name={company} logoUrl={job.company.logo_url} size="sm" />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1.5] }}>
            <Text variant="small" weight="medium" numberOfLines={large ? 2 : 1} ellipsizeMode="tail" style={{ flexShrink: 1 }}>
              {company}
            </Text>
            {job.company.verification_status === 'verified' ? <VerifiedMark size={14} /> : null}
          </View>
          <Text variant="caption" tone="mutedForeground" numberOfLines={large ? undefined : 1}>
            {age ? `${district} · ${age}` : district}
          </Text>
        </View>
        {/* Applied to: «قدّمت» where the bookmark was — saving it is still in the menu and the swipe. */}
        {applied ? (
          <Badge size="md" weight="semibold" variant="primary" label={t('app.jobs.appliedChip')} />
        ) : save.savable ? (
          <SaveJobIcon save={save} />
        ) : null}
      </View>

      <Text
        variant="headline"
        weight="semibold"
        tone={closed ? 'mutedForeground' : 'foreground'}
        numberOfLines={large ? undefined : 2}
        style={{ marginTop: space[2] }}
      >
        {title}
      </Text>

      {/* The basic salary, on a line of its own and the largest thing on the
          card — what a broker weighs a listing by — in the primary ink, with
          its currency and the month beside it. Words where there is no basic
          ("commission only") are set smaller, muted. */}
      {salary.unit ? (
        <Text variant="title" style={[TABULAR, { marginTop: space[1] }]}>
          <Text variant="title" weight="bold" tone="primary">
            {salary.figures}
          </Text>
          <Text variant="caption" weight="regular" tone="mutedForeground">{`  ${salary.unit}`}</Text>
        </Text>
      ) : (
        <Text variant="headline" weight="semibold" tone="mutedForeground" style={{ marginTop: space[1] }}>
          {salary.figures}
        </Text>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5], marginTop: space[2] }}>
        {chips.map(({ key, label, variant }) => (
          <Badge key={key} size="md" variant={variant} label={label} />
        ))}
        {closed ? (
          <Badge
            size="md"
            label={t('jobs.closedShort')}
            icon={<CircleSlash size={iconSize.label} color={colors.mutedForeground} />}
          />
        ) : null}
        {match ? (
          <Badge
            size="md"
            weight="semibold"
            variant="success"
            label={t.markup('app.jobs.match', { percent: match.percent, ...markupTags })}
            icon={<Sparkles size={iconSize.label} color={colors.success} />}
          />
        ) : null}
      </View>
    </Card>
  );
  const card = (
    <ZoomLink href={{ pathname: '/jobs/[slug]', params: { slug: job.slug } }} card={drawn()} fallback={drawn(open)} />
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
              <CompanyLogo name={company} logoUrl={job.company.logo_url} size="sm" />
              <View style={{ flex: 1 }}>
                <Text weight="semibold" numberOfLines={large ? undefined : 2}>
                  {title}
                </Text>
                <Text variant="small" tone="mutedForeground" numberOfLines={large ? undefined : 1}>
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
