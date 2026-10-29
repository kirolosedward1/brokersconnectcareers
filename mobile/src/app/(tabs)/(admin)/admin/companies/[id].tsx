import { useState, type ReactNode } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useLocale, useTranslations } from 'use-intl';
import { isAdminErrorCode } from '@/lib/admin/errors';
import { formatDate, formatNumber } from '@/lib/format';
import { displayJobStatus } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import type { JobStatus, VerificationStatus } from '@/lib/supabase/database.types';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, ApprovalBadge, Fact, FlagList, SectionTitle } from '~/components/admin/kit';
import { Record } from '~/components/admin/record';
import { CompanySignalList } from '~/components/admin/signals';
import { CompanyLogo } from '~/components/companies/company-logo';
import { toast } from '~/components/feedback/toast';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { BadgeCheck, Ban, CheckCheck, FilePen, FileText, RotateCcw, ShieldOff, X } from '~/components/ui/lucide';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { TextLink } from '~/components/ui/text-link';
import { useCompanyFile, type CompanyFile, type CompanyMember, type CompanyPaper, type CompanyReport } from '~/features/admin/companies';
import { UUID } from '~/features/admin/listings';
import { markupTags } from '~/i18n/rich';
import { callAction } from '~/lib/api';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

const STATUS_VARIANT: Record<JobStatus, 'default' | 'outline' | 'success' | 'warning' | 'destructive'> = {
  draft: 'outline',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

const VERIFICATION_VARIANT: Record<VerificationStatus, 'outline' | 'success' | 'warning' | 'destructive'> = {
  unverified: 'outline',
  pending: 'warning',
  verified: 'success',
  rejected: 'destructive',
};

/**
 * One company, and every lever an operator has over it — the website's
 * /admin/companies/<id>: the papers and the verification decision, the people
 * who act for it, the listings it has put up, what readers have reported
 * about it, what its own words and its doings flag, and the record of what
 * admins did. The papers are private: each opens through a five-minute link
 * made for that tap alone and recorded, never a path kept on the screen.
 */
export default function AdminCompanyScreen() {
  const t = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.company') }} />
      <AdminGate>
        <File id={typeof id === 'string' && UUID.test(id) ? id : undefined} />
      </AdminGate>
    </>
  );
}

/** The facts of a card, side by side where they fit. */
function Facts({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[3], columnGap: space[4] }}>{children}</View>;
}

/** A row that opens another file of the console. */
function LinkRow({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: hitTarget, justifyContent: 'center', gap: 2, opacity: pressed ? 0.7 : 1 })}
    >
      {children}
    </Pressable>
  );
}

function File({ id }: { id: string | undefined }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const file = useCompanyFile(id);
  const pull = usePullRefresh(() => file.refetch());

  if (!id) return <NotFoundState />;
  if (file.isPending) return <LoadingState />;
  if (file.isError && !file.data) return <ErrorState error={file.error} onRetry={() => file.refetch()} />;
  const data = file.data;
  if (!data) return <NotFoundState />;

  const { company, papers, members, listings, reports } = data;
  const n = (value: number) => formatNumber(value, locale);
  const name = localized(locale, company.name_ar, company.name_en);
  const suspended = Boolean(company.suspended_at);
  const openComplaints = reports.filter((report) => report.status === 'open' || report.status === 'investigating').length;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[5] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
        <CompanyLogo name={name} logoUrl={company.logo_url} size="lg" />
        <View style={{ flex: 1, gap: space[1] }}>
          <Text variant="title" weight="semibold" accessibilityRole="header">
            {name}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {t('admin.joinedOn', { date: formatDate(company.created_at, locale) })}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
            <Badge variant={VERIFICATION_VARIANT[company.verification_status]} label={t(`admin.verification.${company.verification_status}`)} />
            {suspended ? <Badge variant="destructive" label={t('admin.suspended')} /> : null}
          </View>
          <TextLink label={t('admin.publicPage')} onPress={() => router.push({ pathname: '/companies/[slug]', params: { slug: company.slug } })} />
        </View>
      </View>

      {suspended ? (
        <View accessibilityRole="alert" style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.destructiveMuted }}>
          <Text variant="small" tone="destructive">
            {t('admin.companySuspendedBanner', { date: formatDate(company.suspended_at as string, locale) })}
            {data.suspensionReason ? ` «${data.suspensionReason}»` : ''}
          </Text>
        </View>
      ) : null}

      <Verification file={data} name={name} />
      <Suspension file={data} name={name} />

      {/* What the company says about itself and what it has been doing that
          deserves a second look. Facts for review, never verdicts. */}
      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.safetyHeading')}</SectionTitle>
        <FlagList flags={data.flags} empty />
        <CompanySignalList signals={data.signals} empty />
      </Card>

      <Card style={{ gap: space[4] }}>
        <SectionTitle>{t('admin.companyDetails')}</SectionTitle>
        <Facts>
          <Fact label={t('admin.nameAr')}>{company.name_ar}</Fact>
          <Fact label={t('admin.nameEn')}>{company.name_en ?? '—'}</Fact>
          <Fact label={t('admin.colSlug')}>
            <Text variant="small" selectable style={{ writingDirection: 'ltr' }}>
              {company.slug}
            </Text>
          </Fact>
          <Fact label={t('admin.companyType')}>{company.company_type ? t(`companyType.${company.company_type}`) : '—'}</Fact>
          <Fact label={t('admin.district')}>
            {company.district ? localized(locale, company.district.name_ar, company.district.name_en) : '—'}
          </Fact>
          <Fact label={t('admin.website')}>
            {company.website ? (
              <Text
                variant="small"
                tone="primary"
                accessibilityRole="link"
                style={{ writingDirection: 'ltr' }}
                onPress={() => Linking.openURL(company.website as string).catch(() => {})}
              >
                {company.website}
              </Text>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label={t('billing.credits')}>{n(company.post_credits)}</Fact>
          <Fact label={t('admin.verifiedAt')}>{company.verified_at ? formatDate(company.verified_at, locale) : '—'}</Fact>
          <Fact label={t('admin.createdAt')}>{formatDate(company.created_at, locale)}</Fact>
          <Fact label={t('admin.accountId')}>
            {/* The id as written, left to right, and copyable. */}
            <Text variant="caption" selectable style={{ writingDirection: 'ltr' }}>
              {company.id}
            </Text>
          </Fact>
        </Facts>
        {company.about_ar ? (
          <Text variant="small" tone="mutedForeground" selectable>
            {company.about_ar}
          </Text>
        ) : null}
      </Card>

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.verificationPapers')}</SectionTitle>
        {papers.length === 0 ? (
          <Text variant="small" tone="mutedForeground">
            {t('admin.noDocuments')}
          </Text>
        ) : (
          papers.map((paper) => <Paper key={paper.id} paper={paper} />)
        )}
      </Card>

      <Card style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.members')}</SectionTitle>
        {members.map((member) =>
          member.profile ? <MemberRow key={member.profile.id} member={member} profile={member.profile} owner={member.profile.id === company.owner_id} /> : null,
        )}
      </Card>

      <Card style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.listingsCount', { count: n(data.listingsTotal) })}</SectionTitle>
        {data.openListingReports ? (
          <TextLink
            label={t('admin.openListingReports', { count: data.openListingReports })}
            onPress={() => router.push({ pathname: '/admin/reports', params: { type: 'job' } })}
          />
        ) : null}
        {data.listingsTotal === 0 ? (
          <Text variant="small" tone="mutedForeground">
            {t('admin.noListings')}
          </Text>
        ) : (
          listings.map((job) => {
            const title = localized(locale, job.title_ar, job.title_en) || t('admin.untitled');
            const shown = displayJobStatus(job);
            return (
              <LinkRow key={job.id} label={title} onPress={() => router.push({ pathname: '/admin/jobs/[id]', params: { id: job.id } })}>
                <Text weight="medium" tone="primary">
                  {title}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] }}>
                  <Text variant="caption" tone="mutedForeground">
                    {t('admin.applicantsN', { count: job.applications[0]?.count ?? 0 })}
                  </Text>
                  <Badge variant={STATUS_VARIANT[shown]} label={t(`jobStatus.${shown}`)} />
                </View>
              </LinkRow>
            );
          })
        )}
      </Card>

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.reportsAbout')}</SectionTitle>
        {reports.length === 0 ? (
          <Text variant="small" tone="mutedForeground">
            {t('admin.noReports')}
          </Text>
        ) : (
          reports.map((report) => <ReportCard key={report.id} report={report} />)
        )}
        {openComplaints ? (
          <View style={{ gap: space[1] }}>
            <Text variant="small">{t('admin.reportCount', { count: openComplaints })}</Text>
            <TextLink label={t('admin.openReportsQueue')} onPress={() => router.push({ pathname: '/admin/reports', params: { type: 'company' } })} />
          </View>
        ) : null}
      </Card>

      <Record targetType="company" targetId={company.id} />
    </ScrollView>
  );
}

/** One of the people who act for the company: a link to their file, their role, whether they own it, and their standing. */
function MemberRow({
  member,
  profile,
  owner,
}: {
  member: CompanyMember;
  profile: NonNullable<CompanyMember['profile']>;
  owner: boolean;
}) {
  const t = useTranslations();
  return (
    <LinkRow label={profile.full_name} onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: profile.id } })}>
      <Text weight="medium" tone="primary">
        {profile.full_name}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] }}>
        <Text variant="caption" tone="mutedForeground">
          {t(`admin.memberRole.${member.role}`)}
        </Text>
        {owner ? <Badge variant="outline" label={t('admin.owner')} /> : null}
        <ApprovalBadge status={profile.approval_status} />
      </View>
      {member.contact?.email || member.contact?.phone ? (
        <Text variant="caption" tone="mutedForeground" selectable style={{ writingDirection: 'ltr', textAlign: 'left' }}>
          {[member.contact.email, member.contact.phone].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </LinkRow>
  );
}

/**
 * The verification decision, as the website's aside offers it: verify
 * anything not yet verified (with a note if there is something to say; the
 * body says when there are no papers to go on), send pending papers back or
 * refuse them with a note the company is sent, and revoke a badge for a
 * reason kept on the record. Each carries the version the screen showed.
 */
function Verification({ file, name }: { file: CompanyFile; name: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const { company, papers } = file;
  const status = company.verification_status;
  const lever = (decision: 'verify' | 'request_changes' | 'reject' | 'revoke') => ({
    do: 'company' as const,
    companyId: company.id,
    decision,
    // A revocation is about now, whatever was read.
    version: decision === 'revoke' ? undefined : company.version,
  });
  const buttons: ReactNode[] = [];

  if (status !== 'verified') {
    buttons.push(
      <Button
        key="verify"
        label={t('admin.verify')}
        accessibilityLabel={`${t('admin.verify')}: ${name}`}
        icon={<BadgeCheck size={18} color={colors.primaryForeground} />}
        onPress={() =>
          openDecision({
            lever: lever('verify'),
            title: t('admin.verifyCompanyTitle', { name }),
            body: papers.some((paper) => paper.status === 'pending') ? t('admin.verifyCompanyBody') : t('admin.verifyWithoutPapers'),
            confirmLabel: t('admin.verify'),
            reason: 'optional',
          })
        }
      />,
    );
  }
  if (status === 'pending') {
    buttons.push(
      <Button
        key="changes"
        label={t('admin.requestChanges')}
        variant="outline"
        icon={<FilePen size={18} color={colors.foreground} />}
        onPress={() =>
          openDecision({
            lever: lever('request_changes'),
            title: t('admin.requestChanges'),
            body: t('admin.requestChangesCompanyBody'),
            confirmLabel: t('admin.requestChanges'),
            reason: 'required',
            reasonLabel: t('admin.reasonToCompany'),
          })
        }
      />,
    );
  }
  if (status === 'pending' || status === 'unverified') {
    buttons.push(
      <Button
        key="reject"
        label={t('admin.reject')}
        variant="ghost"
        icon={<X size={18} color={colors.destructive} />}
        onPress={() =>
          openDecision({
            lever: lever('reject'),
            title: t('admin.rejectVerification'),
            body: t('admin.rejectVerificationBody'),
            confirmLabel: t('admin.reject'),
            destructive: true,
            reason: 'required',
            reasonLabel: t('admin.reasonToCompany'),
          })
        }
      />,
    );
  }
  if (status === 'verified') {
    buttons.push(
      <Button
        key="revoke"
        label={t('admin.revokeVerification')}
        variant="ghost"
        icon={<ShieldOff size={18} color={colors.destructive} />}
        onPress={() =>
          openDecision({
            lever: lever('revoke'),
            title: t('admin.revokeVerification'),
            body: t('admin.revokeVerificationBody'),
            confirmLabel: t('admin.revokeVerification'),
            destructive: true,
            reason: 'required',
          })
        }
      />,
    );
  }

  return (
    <Card style={{ gap: space[3] }}>
      <SectionTitle>{t('admin.verification.title')}</SectionTitle>
      <View style={{ gap: space[2] }}>{buttons}</View>
    </Card>
  );
}

/**
 * The firm-level switch — for a company that is itself the problem, not one
 * bad recruiter. Suspending takes every live and waiting listing down at
 * once and tells the members why; lifting it brings none back (each listing
 * is restored from its own screen), and the reason stays on the record.
 */
function Suspension({ file, name }: { file: CompanyFile; name: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const { company } = file;
  const suspended = Boolean(company.suspended_at);

  return (
    <Card style={{ gap: space[3] }}>
      <SectionTitle>{t('admin.suspension')}</SectionTitle>
      <Text variant="small" tone="mutedForeground">
        {suspended ? t('admin.restoreCompanyHint') : t('admin.suspendCompanyHint')}
      </Text>
      <View style={{ gap: space[2] }}>
        {suspended ? (
          <Button
            label={t('admin.restoreCompany')}
            variant="outline"
            icon={<RotateCcw size={18} color={colors.success} />}
            onPress={() =>
              openDecision({
                lever: { do: 'suspension', companyId: company.id, suspend: false },
                title: t('admin.restoreCompany'),
                body: t('admin.restoreCompanyBody'),
                confirmLabel: t('admin.restoreCompany'),
                reason: 'required',
              })
            }
          />
        ) : (
          <Button
            label={t('admin.suspendCompany')}
            variant="ghost"
            icon={<Ban size={18} color={colors.destructive} />}
            onPress={() =>
              openDecision({
                lever: { do: 'suspension', companyId: company.id, suspend: true },
                title: t('admin.suspendCompanyTitle', { name }),
                body: t('admin.suspendCompanyBody'),
                confirmLabel: t('admin.suspendCompany'),
                destructive: true,
                reason: 'required',
                reasonLabel: t('admin.reasonToCompany'),
                // How many listings came down with it: the one thing the admin who pulled this wants to hear.
                onDone: (data) => {
                  const takenDown = data && typeof data === 'object' && 'takenDown' in data ? Number((data as { takenDown: unknown }).takenDown) : NaN;
                  if (!Number.isFinite(takenDown)) return;
                  toast.show({
                    message: `${t('admin.doneWhat', { what: t('admin.suspendCompanyTitle', { name }) })} · ${t.markup('app.admin.companies.takenDown', { count: takenDown, ...markupTags })}`,
                    icon: CheckCheck,
                    tone: 'success',
                  });
                },
              })
            }
          />
        )}
      </View>
    </Card>
  );
}

/**
 * One verification paper: its kind, when it came, what the reviewer wrote
 * on it and where it stands — opened in the in-app browser through a link
 * made for this tap alone, never kept on the screen, where it would outlive
 * the moment it was asked for.
 */
function Paper({ paper }: { paper: CompanyPaper }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = paper.doc_type === 'commercial_register' ? t('employer.commercialRegister') : t('employer.taxCard');

  const open = () => {
    if (pending) return;
    setPending(true);
    setError(null);
    callAction('getDocumentUrl', { documentId: paper.id })
      .then((result) => {
        if (result.ok && result.data) return WebBrowser.openBrowserAsync(result.data.url).then(() => undefined);
        const code = result.ok ? 'not_found' : result.error;
        if (code === 'mfa_required' || code === 'mfa_challenge') setError(t(`app.admin.door.${code}`));
        else setError(isAdminErrorCode(code) ? t(`admin.errors.${code}` as never) : t('admin.errors.unknown'));
      })
      .catch(() => setError(t('admin.errors.network')))
      .then(() => setPending(false));
  };

  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="small" weight="medium">
            {label}
          </Text>
          <Text variant="caption" tone="mutedForeground">
            {`${formatDate(paper.created_at, locale)}${paper.review_note ? ` · «${paper.review_note}»` : ''}`}
          </Text>
          <Badge variant={VERIFICATION_VARIANT[paper.status]} label={t(`admin.verification.${paper.status}`)} />
        </View>
        <Button
          label={t('admin.viewDocument')}
          accessibilityLabel={`${t('admin.viewDocument')}: ${label}`}
          variant="outline"
          size="sm"
          loading={pending}
          icon={<FileText size={16} color={colors.foreground} />}
          onPress={open}
        />
      </View>
      {error ? (
        <Text variant="caption" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** One report about the company: what was alleged, its standing, and who filed it (a link to their file). */
function ReportCard({ report }: { report: CompanyReport }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const reporter = report.reporter;
  return (
    <View style={{ gap: 2, padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <Text variant="small" weight="medium" style={{ flex: 1 }}>
          {t(`reportReason.${report.reason}`)}
        </Text>
        <Badge variant="outline" label={t(`admin.reportStatus.${report.status}`)} />
      </View>
      {report.detail ? (
        <Text variant="small" tone="mutedForeground">
          {report.detail}
        </Text>
      ) : null}
      <Text variant="caption" tone="mutedForeground">
        {reporter ? (
          <Text
            variant="caption"
            tone="primary"
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: reporter.id } })}
          >
            {reporter.full_name}
          </Text>
        ) : (
          t('admin.unknownActor')
        )}
        {` · ${formatDate(report.created_at, locale)}`}
      </Text>
    </View>
  );
}
