import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import { canAccessCandidateArea } from '@/lib/permissions';
import type { AgentAvailability, JobTrack } from '@/lib/supabase/database.types';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import { toast } from '~/components/feedback/toast';
import { ChipGroup } from '~/components/profile/fields';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { ChoiceRow, SettingsGroup, SettingsTitle } from '~/components/ui/settings-list';
import { LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { toggled } from '~/features/jobs/filters';
import { useBoardTotal } from '~/features/jobs/queries';
import { answersFilters, answersQuery } from '~/features/onboarding/finish';
import { useSaveCardFields } from '~/features/profile/card-fields';
import { useDistricts } from '~/features/taxonomy';
import { markupTags } from '~/i18n/rich';
import { haptic } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/use-leave-guard';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * Where a consultant stands in their search (the Availability board): the
 * directory card's three states as the website names them, and the tracks
 * and areas they work in — the card's own answers, saved together — with
 * how many listings published now match those, which is the board's own
 * search, counted.
 *
 * The board's other answers (a fourth "within a month" state, notice period,
 * start date, full or part time, contact hours, a reminder to update) have no
 * column behind them yet: they are in the Phase B design notes.
 */
export default function AvailabilityScreen() {
  const t = useTranslations();
  const { actor } = useSession();
  const card = useSaveCardFields();
  const header = <Stack.Screen options={{ title: t('app.seeking.title') }} />;

  if (canAccessCandidateArea(actor) && card.card.isPending) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    );
  }
  if (!card.agent) {
    return (
      <>
        {header}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: gutter, gap: space[3] }}>
          <Notice tone="muted">{t('app.seeking.noCard')}</Notice>
          <Button label={t('app.privacy.noCardCta')} variant="outline" onPress={() => router.push('/account/profile')} />
        </ScrollView>
      </>
    );
  }
  return (
    <>
      {header}
      <SeekingForm
        // Read back after a save, the form starts again from what was kept.
        key={[card.agent.availability, card.agent.tracks, card.agent.district_ids].join('|')}
        initial={{
          availability: card.agent.availability,
          tracks: (card.agent.tracks ?? []) as JobTrack[],
          districtIds: card.agent.district_ids ?? [],
        }}
        card={card}
      />
    </>
  );
}

type Answers = {
  availability: AgentAvailability;
  tracks: JobTrack[];
  districtIds: number[];
};

function SeekingForm({ initial, card }: { initial: Answers; card: ReturnType<typeof useSaveCardFields> }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const districts = useDistricts().data ?? [];
  const [answers, setAnswers] = useState<Answers>(initial);
  const dirty =
    answers.availability !== initial.availability ||
    answers.tracks.join() !== initial.tracks.join() ||
    answers.districtIds.join() !== initial.districtIds.join();
  useLeaveGuard(dirty, card.isPending);

  // The board's own search for these tracks and areas, counted: nothing is said until it is known.
  const query = answersQuery(
    answersFilters(
      {
        tracks: answers.tracks,
        districtIds: answers.districtIds,
        minSalary: null,
        leads: 'either',
      },
      districts,
    ),
  );
  const matches = useBoardTotal(query, answers.tracks.length + answers.districtIds.length > 0 && districts.length > 0);

  const save = () =>
    card.saveFields(answers, {
      onSuccess: () => toast.show({ message: t('app.seeking.saved'), tone: 'success' }),
      onError: () => toast.show({ message: t('common.errorBody'), tone: 'destructive' }),
    });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: gutter,
        paddingBottom: space[12],
        gap: space[6],
      }}
    >
      <SettingsGroup title={t('app.seeking.status')} footer={t('app.seeking.statusHint')}>
        <View accessibilityRole="radiogroup">
          {AVAILABILITIES.map((value) => (
            <ChoiceRow
              key={value}
              label={t(`availability.${value}`)}
              hint={t(`app.seeking.${value}`)}
              selected={answers.availability === value}
              onPress={() => {
                if (answers.availability !== value) haptic.selection();
                setAnswers((current) => ({ ...current, availability: value }));
              }}
            />
          ))}
        </View>
      </SettingsGroup>

      <View style={{ gap: space[4] }}>
        <SettingsTitle header>{t('app.seeking.looking')}</SettingsTitle>
        <ChipGroup
          legend={t('app.seeking.tracks')}
          options={JOB_TRACKS.map((track) => ({
            value: track,
            label: t(`track.${track}`),
          }))}
          selected={answers.tracks}
          onToggle={(value) =>
            setAnswers((current) => ({
              ...current,
              tracks: toggled(current.tracks, value),
            }))
          }
        />
        <ChipGroup
          legend={t('app.seeking.districts')}
          scroll
          options={districts.map((district) => ({
            value: district.id,
            label: localized(locale, district.name_ar, district.name_en),
          }))}
          selected={answers.districtIds}
          onToggle={(value) =>
            setAnswers((current) => ({
              ...current,
              districtIds: toggled(current.districtIds, value),
            }))
          }
          max={20}
        />
      </View>

      {matches.data != null ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            padding: space[4],
            ...corner('xl'),
            backgroundColor: colors.secondary,
          }}
        >
          <Text variant="small" weight="medium">
            {t.markup('app.seeking.matches', {
              count: matches.data,
              ...markupTags,
            })}
          </Text>
        </View>
      ) : null}

      <Button label={t('common.save')} size="lg" onPress={save} loading={card.isPending} disabled={!dirty || !card.ready} />
    </ScrollView>
  );
}
