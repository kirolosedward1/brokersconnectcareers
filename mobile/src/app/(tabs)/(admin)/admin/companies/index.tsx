import { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { isAdminErrorCode } from '@/lib/admin/errors';
import { formatDate } from '@/lib/format';
import { localized } from '@/lib/locale';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, daysSince, openOnWebsite } from '~/components/admin/kit';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { BadgeCheck, Building2, Clock, ExternalLink, FilePen, FileText, X } from '~/components/ui/lucide';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { usePendingCompanies, type QueueCompany } from '~/features/admin/queries';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { callAction } from '~/lib/api';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * Companies whose papers are waiting — the website's /admin/companies: the
 * commercial register and the tax card each a tap away, through a link that
 * lives five minutes and is made only when asked for (the asking is on the
 * record), and the review's three answers: verify, ask for corrected copies,
 * or reject. The two that send the company back need a note, which it is sent.
 */
export default function AdminCompaniesScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('dashboard.statCompaniesPending') }} />
      <AdminGate>
        <Queue />
      </AdminGate>
    </>
  );
}

function Queue() {
  const t = useTranslations();
  const queue = usePendingCompanies();
  const pull = usePullRefresh(() => queue.refetch());
  const list = useTabList<FlashListRef<QueueCompany>>();

  if (queue.isPending) return <LoadingState />;
  if (queue.isError && !queue.data) return <ErrorState error={queue.error} onRetry={() => queue.refetch()} />;
  const { rows, total } = queue.data;

  return (
    <FlashList
      {...list}
      data={rows}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <CompanyRow key={item.id} company={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={
        rows.length < total ? (
          <Text variant="small" tone="mutedForeground" style={{ marginBottom: space[3] }}>
            {t.markup('app.admin.showing', { shown: rows.length, total, ...markupTags })}
          </Text>
        ) : null
      }
      ListEmptyComponent={<EmptyState icon={Building2} title={t('admin.emptyQueue')} />}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

function CompanyRow({ company }: { company: QueueCompany }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const name = localized(locale, company.name_ar, company.name_en);
  // How long the papers have waited: the oldest of them, not the company's age.
  const waited = daysSince(company.company_documents.map((doc) => doc.created_at).sort()[0] ?? company.created_at);
  const lever = (decision: 'verify' | 'request_changes' | 'reject') => {
    const words = {
      verify: {
        title: t('admin.verifyCompanyTitle', { name }),
        body: t('admin.verifyCompanyBody'),
        confirmLabel: t('admin.verify'),
        reason: 'optional' as const,
      },
      request_changes: {
        title: `${t('admin.requestChanges')} — ${name}`,
        body: t('admin.requestChangesCompanyBody'),
        confirmLabel: t('admin.requestChanges'),
        reason: 'required' as const,
        reasonLabel: t('admin.reasonToCompany'),
      },
      reject: {
        title: `${t('admin.rejectVerification')} — ${name}`,
        body: t('admin.rejectVerificationBody'),
        confirmLabel: t('admin.reject'),
        destructive: true,
        reason: 'required' as const,
        reasonLabel: t('admin.reasonToCompany'),
      },
    }[decision];
    openDecision({ ...words, lever: { do: 'company', companyId: company.id, decision, version: company.version } });
  };

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text weight="semibold">{name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Clock size={14} color={waited >= 1 ? colors.destructive : colors.mutedForeground} />
          <Text variant="caption" tone={waited >= 1 ? 'destructive' : 'mutedForeground'}>
            {t('admin.waiting', { days: waited })}
          </Text>
        </View>
      </View>

      <View style={{ gap: space[2] }}>
        <Text variant="caption" tone="mutedForeground">
          {t('app.admin.papers')}
        </Text>
        {company.company_documents.map((doc) => (
          <Paper key={doc.id} documentId={doc.id} label={doc.doc_type === 'commercial_register' ? t('employer.commercialRegister') : t('employer.taxCard')} date={formatDate(doc.created_at, locale)} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Button
          label={t('admin.verify')}
          accessibilityLabel={`${t('admin.verify')}: ${name}`}
          size="sm"
          icon={<BadgeCheck size={16} color={colors.primaryForeground} />}
          onPress={() => lever('verify')}
        />
        <Button
          label={t('admin.requestChanges')}
          variant="outline"
          size="sm"
          icon={<FilePen size={16} color={colors.foreground} />}
          onPress={() => lever('request_changes')}
        />
        <Button
          label={t('admin.reject')}
          variant="ghost"
          size="sm"
          icon={<X size={16} color={colors.destructive} />}
          onPress={() => lever('reject')}
        />
        <Button
          label={t('app.admin.onWebsite')}
          variant="ghost"
          size="sm"
          icon={<ExternalLink size={16} color={colors.foreground} />}
          onPress={() => openOnWebsite(`/admin/companies/${company.id}`)}
        />
      </View>
    </Card>
  );
}

/**
 * One verification paper, opened in the in-app browser through a link made
 * for this tap alone — never kept on the screen, where it would outlive the
 * moment it was asked for.
 */
function Paper({ documentId, label, date }: { documentId: string; label: string; date: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    if (pending) return;
    setPending(true);
    setError(null);
    callAction('getDocumentUrl', { documentId })
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
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Text variant="small" style={{ flex: 1 }}>{`${label} · ${date}`}</Text>
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
