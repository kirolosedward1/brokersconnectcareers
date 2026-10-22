import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import { isAdmin } from '@/lib/permissions';
import type { SafetyFlag } from '@/lib/supabase/database.types';
import { Button } from '~/components/ui/button';
import { AlertTriangle, ExternalLink, Info, KeyRound, ShieldAlert, ShieldCheck } from '~/components/ui/lucide';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAdminDoor } from '~/features/admin/door';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/** Whole days since a date, as the website's queues count a wait. */
export function daysSince(date: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
}

/** A page of the website's console, in the in-app browser: what the app's console leaves to it. */
export function openOnWebsite(path: string) {
  WebBrowser.openBrowserAsync(`${env.siteUrl}${path}`).catch(() => {});
}

/**
 * The console's door on the phone, the website's requireAdmin(): an admin
 * whose session has proved what the console asks of it gets the screen;
 * anybody else is told what is missing and how to get it. Every admin screen
 * is drawn inside one.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const { actor } = useSession();
  const door = useAdminDoor();
  const [checking, setChecking] = useState(false);

  if (!isAdmin(actor)) {
    return <EmptyState icon={ShieldAlert} title={t('admin.errors.forbidden')} />;
  }
  if (door.state === 'checking') return <LoadingState />;
  if (door.state === 'error') return <ErrorState error={null} onRetry={() => void door.recheck()} />;
  if (door.state === 'challenge') {
    return (
      <EmptyState
        icon={KeyRound}
        title={t('app.admin.door.challengeTitle')}
        body={t('app.admin.door.challengeBody')}
        action={<Button label={t('app.admin.door.challengeGo')} onPress={() => router.push('/mfa')} />}
      />
    );
  }
  if (door.state === 'enrol') {
    return (
      <EmptyState
        icon={ShieldCheck}
        title={t('app.admin.door.enrolTitle')}
        body={t('app.admin.door.enrolBody')}
        action={
          <View style={{ gap: space[2], alignSelf: 'stretch' }}>
            <Button
              label={t('app.admin.door.enrolOpen')}
              icon={<ExternalLink size={18} color={colors.primaryForeground} />}
              onPress={() => openOnWebsite('/dashboard/account?mfa=required')}
            />
            <Button
              label={t('app.admin.door.enrolDone')}
              variant="ghost"
              loading={checking}
              onPress={() => {
                setChecking(true);
                door.recheck().then(() => setChecking(false));
              }}
            />
          </View>
        }
      />
    );
  }
  return children;
}

/**
 * What a listing or a company says in its own words that deserves a second
 * look (migration 327) — the website's SafetyFlags: the weighty ones first,
 * each with the words that raised it. Facts for review, never a verdict.
 */
export function FlagList({ flags, empty = false }: { flags: SafetyFlag[]; empty?: boolean }) {
  const t = useTranslations('admin');
  const { colors } = useTheme();
  const sorted = [...flags].sort((a, b) => (a.weight === b.weight ? 0 : a.weight === 'high' ? -1 : 1));
  if (!sorted.length) {
    return empty ? (
      <Text variant="small" tone="mutedForeground">
        {t('flagsNone')}
      </Text>
    ) : null;
  }
  return (
    <View style={{ gap: space[1] }}>
      {sorted.map((flag) => {
        const high = flag.weight === 'high';
        const Icon = high ? AlertTriangle : Info;
        return (
          <View key={`${flag.flag}:${flag.evidence ?? ''}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
            <Icon size={14} color={high ? colors.warning : colors.mutedForeground} style={{ marginTop: 4 }} />
            <Text variant="small" tone={high ? 'warning' : 'mutedForeground'} style={{ flex: 1 }}>
              {t(`flag.${flag.flag}`)}
              {flag.evidence ? ` «${flag.evidence}»` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** A label and its value, one under the other: the facts of a listing or a case. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 2, minWidth: '45%', flexGrow: 1 }}>
      <Text variant="caption" tone="mutedForeground">
        {label}
      </Text>
      {typeof children === 'string' ? <Text variant="small">{children}</Text> : children}
    </View>
  );
}

/** A heading over a block of a screen. */
export function SectionTitle({ children }: { children: string }) {
  return (
    <Text variant="label" weight="semibold" tone="mutedForeground" accessibilityRole="header" style={{ paddingHorizontal: space[1] }}>
      {children}
    </Text>
  );
}
