import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import { isSuspended } from '@/lib/permissions';
import { ApplicantCard } from '~/components/employer/applicant-card';
import { useApplicantContext } from '~/components/employer/applicant-context';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  APPLICANTS_CAP,
  notesOf,
  STAGES,
  useApplicantNotes,
  useListingApplicants,
  useMarkSeen,
} from '~/features/employer/applicants';
import { markupTags } from '~/i18n/rich';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/**
 * One listing's applicants — the website's /employer/jobs/<id>/applicants:
 * the newest two hundred, grouped by where they stand, in the pipeline's
 * order. Each is stamped as seen once it is on screen. Open from the listing
 * console, from a notification about new applicants, and from the inbox.
 */
export default function ListingApplicantsScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = typeof raw === 'string' ? raw : '';
  const { session, viewer, actor } = useSession();
  const pipeline = useListingApplicants(id);
  const applicants = pipeline.data?.applicants;
  const notes = useApplicantNotes((applicants ?? []).map((row) => row.id));
  const context = useApplicantContext();
  // Nobody is told a suspended company opened their application: its
  // applicants are hidden from it (migration 349), whatever a read returns.
  useMarkSeen(viewer?.company?.suspended_at ? undefined : applicants);
  // A new applicant, or a colleague's move, reaches the pipeline with a pull.
  const pull = usePullRefresh(() => Promise.all([pipeline.refetch(), applicants?.length ? notes.refetch() : null]));

  const job = pipeline.data?.job ?? null;
  const title = job ? localized(locale, job.title_ar, job.title_en) : t('employer.jobs');
  const header = <Stack.Screen options={{ title }} />;

  let body: React.ReactNode;
  if (!session || !viewer?.profile) body = <ViewerPending />;
  else if (isSuspended(actor)) body = <EmptyState title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  else if (!viewer.company) body = <NotFoundState />;
  // A suspended company's applicants are hidden (migration 349): said, not
  // shown as an empty pipeline.
  else if (viewer.company.suspended_at) {
    body = <EmptyState title={t('employer.applicantsSuspendedTitle')} body={t('employer.applicantsSuspendedBody')} />;
  } else if (pipeline.isPending) body = <LoadingState />;
  else if (pipeline.isError && !pipeline.data) body = <ErrorState error={pipeline.error} onRetry={() => pipeline.refetch()} />;
  else if (!pipeline.data || !job) body = <NotFoundState />;
  else if (pipeline.data.applicants.length === 0) {
    // In a scroll view of its own, so the first applicant arrives with a pull too.
    body = (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      >
        <EmptyState
          title={t('employer.noApplicants')}
          body={t('employer.noApplicantsHint')}
          action={
            <View style={{ gap: space[2], alignSelf: 'stretch' }}>
              <Button
                label={t('employer.viewListing')}
                variant="outline"
                onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })}
              />
              <Button label={t('employer.allApplicants')} variant="ghost" onPress={() => router.navigate('/employer/applicants' as never)} />
            </View>
          }
        />
      </ScrollView>
    );
  } else {
    const { total } = pipeline.data;
    const rows = pipeline.data.applicants;
    body = (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}
        refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      >
        <Text tone="mutedForeground">{t.markup('employer.pipelineCount', { count: total, ...markupTags })}</Text>

        {total > rows.length ? (
          <View style={{ gap: space[1], padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
            <Text variant="small">{t.markup('employer.applicantsCapped', { count: APPLICANTS_CAP, ...markupTags })}</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.navigate({ pathname: '/employer/applicants', params: { job: job.id } } as never)}
              hitSlop={{ top: 4, bottom: 4 }}
              style={{ minHeight: hitTarget - 8, justifyContent: 'center' }}
            >
              <Text variant="small" weight="medium" tone="primary">
                {t('employer.allApplicants')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* One list, each stage's header among its cards. A card whose stage
            changes on a re-read — a colleague's move, read again after a pull
            or a push — moves under its new header as the same card, keeping
            the reason or note being typed in it; in a box per stage it was
            built again, empty. */}
        {STAGES.flatMap((stage) => {
          const inStage = rows.filter((row) => row.status === stage);
          if (!inStage.length) return [];
          return [
            <View
              key={`stage:${stage}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] }}
            >
              <Text weight="semibold" accessibilityRole="header">
                {t(`applicationStatus.${stage}`)}
              </Text>
              <Badge label={String(inStage.length)} />
            </View>,
            ...inStage.map((row) => (
              <ApplicantCard
                key={row.id}
                applicant={row}
                jobTitle={title}
                companyName={context.companyName}
                districtNames={context.districtNames(row.candidate?.agent_profiles?.district_ids ?? [])}
                notes={notesOf(notes.data, row.id)}
                authors={notes.data?.authors ?? {}}
                viewerId={context.viewerId}
              />
            )),
          ];
        })}
      </ScrollView>
    );
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}
