import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import type { JobListItem } from '@/lib/job-list';
import { formatDateTime, formatList } from '@/lib/format';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { toast } from '~/components/feedback/toast';
import { JobCard } from '~/components/jobs/job-card';
import { Pop } from '~/components/motion/pop';
import { Badge } from '~/components/ui/badge';
import { BellCheck, BellOff, BellPlus, CircleAlert, Hourglass } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useListOwner } from '~/features/jobs/recent';
import { COMPARE_MAX } from '~/features/saved/compare';
import { useJobNote } from '~/features/saved/note-queries';
import { useRefreshSavedMarks } from '~/features/saved/queries';
import { useReminderWords } from '~/features/saved/reminder-words';
import {
  cancelReminder,
  closingInDays,
  CLOSING_SOON_DAYS,
  reminderAt,
  setReminder,
  useJobReminder,
  type JobReminder,
} from '~/features/saved/reminders';
import { markupTags } from '~/i18n/rich';
import { haptic } from '~/lib/haptics';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, iconSize, radius, space } from '~/theme/tokens';
import { NoteLine, openNoteSheet } from './note-sheet';

/** While choosing listings to compare: where this one stands. */
export type ComparePick = {
  /** Its place among those picked (1, 2, 3), or null when it is not one of them. */
  order: number | null;
  /** Three are picked and this is not one of them. */
  full: boolean;
  onToggle: () => void;
};

/**
 * A saved listing: the board's own card, and tucked under it a tray of what
 * the candidate keeps about it on this phone — when it closes soon, their
 * note, and the reminder before it closes.
 *
 * While listings are being chosen to compare (`pick`), the card is one thing
 * to tap, ringed and numbered when chosen; the tray waits, dimmed.
 */
export function SavedJobItem({ job, applied, pick }: { job: JobListItem; applied: boolean; pick: ComparePick | null }) {
  const comparing = pick !== null;
  return (
    <View>
      <View style={styles.card}>
        <View accessibilityElementsHidden={comparing} importantForAccessibility={comparing ? 'no-hide-descendants' : 'auto'}>
          <JobCard job={job} applied={applied} />
        </View>
        {pick ? <PickOverlay job={job} pick={pick} /> : null}
      </View>
      <Tray job={job} applied={applied} waiting={comparing} />
    </View>
  );
}

/** The card while choosing: the whole of it a checkbox, its number in the corner where the bookmark was. */
function PickOverlay({ job, pick }: { job: JobListItem; pick: ComparePick }) {
  const t = useTranslations('app.saved.compare');
  const locale = useLocale();
  const { colors } = useTheme();
  const chosen = pick.order !== null;
  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={formatList([title, company], locale)}
      accessibilityHint={pick.full && !chosen ? t.markup('limit', { max: COMPARE_MAX, ...markupTags }) : t('pickHint')}
      accessibilityState={{ checked: chosen, disabled: pick.full && !chosen }}
      onPress={pick.onToggle}
      testID={`compare-pick-${job.id}`}
      style={[
        StyleSheet.absoluteFill,
        {
          ...corner('xl'),
          borderWidth: chosen ? 2 : StyleSheet.hairlineWidth * 2,
          borderColor: chosen ? colors.primary : colors.border,
        },
      ]}
    >
      {/* Not to be chosen now: the card faded back, still readable. */}
      {pick.full && !chosen ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { ...corner('xl'), backgroundColor: colors.background, opacity: 0.55 }]} />
      ) : null}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: space[3],
          end: space[3],
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: chosen ? colors.primary : colors.input,
          backgroundColor: chosen ? colors.primary : colors.card,
        }}
      >
        {chosen ? (
          <Text variant="small" weight="bold" style={{ color: colors.primaryForeground, lineHeight: 20 }}>
            {String(pick.order)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Under the card: "closes tomorrow" when it is three days or fewer from
 * closing, the note (or the offer to write one), and the reminder — offered
 * on an open listing not yet applied to with time left to remind, and shown
 * wherever one is set, so it can be taken back.
 */
function Tray({ job, applied, waiting }: { job: JobListItem; applied: boolean; waiting: boolean }) {
  const t = useTranslations('app.saved');
  const { colors } = useTheme();
  const locale = useLocale();
  const note = useJobNote(job.id);
  const reminder = useJobReminder(job.id);
  const large = useLargeText();
  const live = jobIsLive(job);
  const days = live ? closingInDays(job.expires_at) : null;
  // The days left, when they are few enough to say.
  const soon = days !== null && days <= CLOSING_SOON_DAYS ? days : null;
  const remindable = live && !applied && reminderAt(job.expires_at) !== null;

  return (
    <View
      pointerEvents={waiting ? 'none' : 'auto'}
      accessibilityElementsHidden={waiting}
      importantForAccessibility={waiting ? 'no-hide-descendants' : 'auto'}
      style={{
        marginTop: -TUCK,
        marginHorizontal: space[3],
        paddingTop: TUCK + space[1],
        paddingBottom: space[1],
        paddingHorizontal: space[3],
        gap: space[1],
        borderBottomLeftRadius: radius.lg,
        borderBottomRightRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderTopWidth: 0,
        borderColor: colors.border,
        backgroundColor: colors.muted,
        opacity: waiting ? 0.4 : 1,
      }}
    >
      {soon !== null ? (
        <View style={{ flexDirection: 'row', paddingTop: space[2] }}>
          <Badge
            variant="warning"
            label={t.markup('closing', { days: soon, ...markupTags })}
            icon={<Hourglass size={iconSize.label} color={colors.warning} />}
          />
        </View>
      ) : null}
      {/* Side by side; at the accessibility text sizes the reminder goes under the note rather than squeezing it. */}
      <View style={large ? { gap: space[1], paddingBottom: space[2] } : { flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <View style={large ? undefined : { flex: 1 }}>
          <NoteLine note={note} onPress={() => openNoteSheet(job.id, localized(locale, job.title_ar, job.title_en))} />
        </View>
        {remindable || reminder ? (
          <View style={{ alignItems: 'flex-start' }}>
            <RemindButton job={job} reminder={reminder} locale={locale} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** How far the tray runs up under the card: its corner's height, so the card's rounded foot sits on it. */
const TUCK = radius.xl;

/**
 * "Remind me", or — with one set — a bell with a tick saying it is, which
 * takes it back when pressed (with Undo). Setting one asks the phone first if
 * it never has; refused, the toast says where to turn notifications on.
 */
function RemindButton({ job, reminder, locale }: { job: JobListItem; reminder: JobReminder | null; locale: string }) {
  const t = useTranslations('app.saved.remind');
  const tCommon = useTranslations('common');
  const tPush = useTranslations('app.push');
  const tToast = useTranslations('app.toast');
  const { colors } = useTheme();
  const owner = useListOwner();
  const queryClient = useQueryClient();
  const words = useReminderWords()(job);
  const refreshMarks = useRefreshSavedMarks();
  const [busy, setBusy] = useState(false);
  // The reader's own taps that set one: what the bell's pop answers.
  const [sets, setSets] = useState(0);

  const set = async () => {
    setBusy(true);
    const result = await setReminder(owner, job, words);
    setBusy(false);
    // The phone may have just been asked: the account's switch and the push bridge read it again.
    void queryClient.invalidateQueries({ queryKey: ['push', 'state'] });
    if (result.status === 'set') {
      // Kept on the bookmark: the website's saved page says it now too.
      void refreshMarks();
      haptic.tap();
      setSets((count) => count + 1);
      toast.show({
        message: t('when', { when: formatDateTime(result.at, locale) }),
        icon: BellCheck,
        tone: 'success',
        action: { label: tCommon('cancel'), onPress: () => void takeBack(false) },
      });
    } else if (result.status === 'denied') {
      toast.show({
        message: t('denied'),
        icon: BellOff,
        action: { label: tPush('openSettings'), onPress: () => void Linking.openSettings().catch(() => {}) },
      });
    } else if (result.status === 'closing') {
      toast.show({ message: t('tooLate'), icon: Hourglass });
    } else {
      toast.show({ message: t('failed'), icon: CircleAlert });
    }
  };

  const takeBack = async (offerUndo: boolean) => {
    setBusy(true);
    const gone = await cancelReminder(owner, job.id);
    setBusy(false);
    if (!gone) {
      // The website could not be told: it is still set, here and there.
      toast.show({ message: t('cancelFailed'), icon: CircleAlert });
      return;
    }
    void refreshMarks();
    toast.show({
      message: t('cancelled'),
      icon: BellOff,
      action: offerUndo ? { label: tToast('undo'), onPress: () => void set() } : undefined,
    });
  };

  const on = reminder !== null;
  const when = reminder ? formatDateTime(new Date(reminder.fireAt), locale) : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? t('when', { when }) : t('setSpoken')}
      accessibilityHint={on ? t('cancelHint') : undefined}
      accessibilityState={{ selected: on, busy }}
      disabled={busy}
      hitSlop={4}
      onPress={() => {
        haptic.selection();
        if (on) void takeBack(true);
        else void set();
      }}
      style={({ pressed }) => ({
        minHeight: hitTarget - 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        paddingHorizontal: space[3],
        borderRadius: 18,
        borderCurve: 'continuous',
        borderWidth: on ? 0 : StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: on ? colors.secondary : pressed ? colors.muted : colors.card,
        opacity: busy ? 0.6 : 1,
      })}
    >
      <Pop key={job.id} trigger={sets}>
        {on ? <BellCheck size={16} color={colors.primary} /> : <BellPlus size={16} color={colors.foreground} />}
      </Pop>
      <Text variant="small" weight="semibold" style={{ color: on ? colors.primary : colors.foreground }}>
        {on ? t('on') : t('set')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Over the tray tucked under it.
  card: { zIndex: 1 },
});
