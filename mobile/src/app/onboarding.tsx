import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useLocale, useTranslations } from 'use-intl';
import { BadgeCheck, Briefcase, Check, Eye, EyeOff, MailCheck, Search } from '~/components/ui/lucide';
import type { OnboardingInput } from '@/lib/mobile-api/contract';
import { localized, type Locale } from '@/lib/locale';
import { safeHttpUrl } from '@/lib/security/sanitize';
import { HEADCOUNT_BANDS } from '@/lib/taxonomy';
import type { AgentVisibility, HeadcountBand } from '@/lib/supabase/database.types';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Select } from '~/components/ui/select';
import { LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { deleteAccountHere, type DeleteRefusal } from '~/features/account/delete';
import { asRole, intentFromParams, type AuthIntent, type Role } from '~/features/auth/intent';
import { useCloseFlow, useLand } from '~/features/auth/land';
import { signOutHere } from '~/features/push/device';
import { useDistricts } from '~/features/taxonomy';
import { callAction } from '~/lib/api';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { useHoldBack } from '~/lib/use-hold-back';
import { webAddress } from '~/lib/web-address';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

/**
 * The step that makes an account a profile — the website's onboarding
 * (src/components/auth/onboarding-form.tsx) through its own action
 * (completeOnboarding), so the profile, the directory entry and the company
 * are created exactly as they are there.
 *
 * The role arrives pre-chosen when the door implied one and is then a receipt,
 * not a question. The name comes from the provider when there was one. A
 * company answers the questions a reviewer needs and no more. And, before
 * anything is created, the Terms of use: the app is where people publish to
 * each other (listings, profiles), and every account agrees to the rules for
 * that — including that abuse is not tolerated — before it can.
 *
 * Shown over everything until it is done; the way out is to sign out, or to
 * delete the account, as on the website.
 */
export default function OnboardingScreen() {
  const params = useLocalSearchParams<{ next?: string; role?: string; confirmed?: string }>();
  const intent = intentFromParams(params);
  const t = useTranslations();
  const { ready, session, viewer } = useSession();
  const land = useLand();
  const close = useCloseFlow();
  useHoldBack();

  // Nothing to ask: signed out in the meantime, or onboarded already (in
  // another tab, on the website) — the website's onboarding page redirects
  // the same way. Once only, however often the session re-renders this.
  const left = useRef(false);
  useEffect(() => {
    if (!ready || left.current) return;
    if (!session) {
      left.current = true;
      close();
    } else if (viewer?.profile) {
      left.current = true;
      void land(intent);
    }
  }, [ready, session, viewer?.profile, close, land, intent]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {/* The form is drawn once the session is known, so what it offers
          (the provider's name, the door's role) is there from the start. */}
      {ready && session && !viewer?.profile ? (
        <OnboardingForm
          session={session}
          intent={intent}
          onDone={async () => {
            left.current = true;
            await land(intent);
          }}
          onSignOut={async () => {
            left.current = true;
            await signOutHere();
            close();
          }}
          onDelete={async () => {
            // Left before the account goes, so the sign-out at the end of the
            // deletion does not close the flow a second time underneath us.
            left.current = true;
            const refusal = await deleteAccountHere(session.user);
            if (refusal) {
              left.current = false;
              return refusal;
            }
            close();
            Alert.alert(t('app.account.deleted'));
            return null;
          }}
        />
      ) : (
        <LoadingState />
      )}
    </>
  );
}

function OnboardingForm({
  session,
  intent,
  onDone,
  onSignOut,
  onDelete,
}: {
  session: Session;
  intent: AuthIntent;
  onDone: () => Promise<void>;
  onSignOut: () => Promise<void>;
  /** Deletes the account; null when it is gone, otherwise why not. */
  onDelete: () => Promise<DeleteRefusal | null>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const districts = useDistricts();

  const metadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const suggestedName =
    (typeof metadata.full_name === 'string' && metadata.full_name) ||
    (typeof metadata.name === 'string' && metadata.name) ||
    (session.user.email ? session.user.email.split('@')[0] : '');
  const settledRole = intent.role ?? asRole(metadata.role);

  const [role, setRole] = useState<Role>(settledRole ?? 'candidate');
  const [fullName, setFullName] = useState(suggestedName);
  const [whatsapp, setWhatsapp] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [headcount, setHeadcount] = useState<HeadcountBand | null>(null);
  const [profileLocale, setProfileLocale] = useState<Locale>(locale);
  const [agreed, setAgreed] = useState(false);
  // Who sees a candidate's directory card: nothing chosen in advance.
  const [visibility, setVisibility] = useState<AgentVisibility | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  function confirmDelete() {
    Alert.alert(t('onboarding.leaveDelete'), t('onboarding.leaveConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('onboarding.leaveConfirmCta'), style: 'destructive', onPress: () => void remove() },
    ]);
  }

  async function remove() {
    setErrors({});
    setPending(true);
    const refusal = await onDelete();
    if (refusal) {
      setPending(false);
      setErrors({ form: refusal === 'apple' ? t('app.account.deleteAppleFailed') : t('onboarding.leaveFailed') });
    }
  }

  async function submit() {
    setErrors({});
    const missing: Record<string, string> = {};
    if (role === 'candidate' && !visibility) missing.visibility = t('onboarding.visibilityRequired');
    if (!agreed) missing.terms = t('onboarding.consentRequired');
    // As the company page takes it: "nilebrokers.com" is https://nilebrokers.com.
    // Sent as typed, the website refused it as not an address.
    const website = role === 'employer' ? webAddress(companyWebsite) : null;
    if (website && !safeHttpUrl(website)) missing.companyWebsite = t('validation.invalidUrl');
    if (Object.keys(missing).length) {
      setErrors(missing);
      return;
    }

    const input: OnboardingInput = {
      role,
      fullName,
      whatsapp,
      locale: profileLocale,
      agreed: true,
      visibility: role === 'candidate' ? (visibility ?? undefined) : undefined,
      company:
        role === 'employer'
          ? {
              nameAr: companyName,
              website,
              headcountBand: headcount,
              districtId,
            }
          : undefined,
    };

    setPending(true);
    const result = await callAction('completeOnboarding', input).catch(() => null);
    if (!result || !result.ok) {
      setPending(false);
      const fields = result && !result.ok ? result.fieldErrors : undefined;
      setErrors(
        fields && Object.keys(fields).length
          ? {
              ...(fields.fullName ? { fullName: t('validation.required') } : {}),
              ...(fields.whatsapp ? { whatsapp: t('validation.invalidPhone') } : {}),
              ...(fields.company ? { company: t('validation.required') } : {}),
              ...(fields.companyWebsite ? { companyWebsite: t('validation.invalidUrl') } : {}),
              ...(fields.visibility ? { visibility: t('onboarding.visibilityRequired') } : {}),
              ...(fields.agreed ? { terms: t('onboarding.consentRequired') } : {}),
              ...(fields.role || fields.locale ? { form: t('common.errorBody') } : {}),
            }
          : { form: t('common.errorBody') },
      );
      return;
    }

    await onDone();
    setPending(false);
  }

  const openSitePage = (path: string) => WebBrowser.openBrowserAsync(`${env.siteUrl}${path}`).catch(() => {});

  return (
    <AuthScroll bare>
      <View style={{ height: space[8] }} />

      {intent.confirmed ? (
        <Notice tone="success" title={t('onboarding.confirmedBanner')} icon={<MailCheck size={16} color={colors.success} />} />
      ) : null}

      <AuthHeading title={t('onboarding.title')} body={t('onboarding.subtitle')} />

      {settledRole ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            padding: space[3],
            ...corner('xl'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.border,
            backgroundColor: colors.muted,
          }}
        >
          {role === 'employer' ? <Briefcase size={16} color={colors.primary} /> : <Search size={16} color={colors.primary} />}
          <Text variant="small" weight="medium" style={{ flexShrink: 1 }}>
            {role === 'employer' ? t('onboarding.roleKnownEmployer') : t('onboarding.roleKnownCandidate')}
          </Text>
        </View>
      ) : (
        <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.roleQuestion')}>
          <Text variant="small" weight="medium">
            {t('onboarding.roleQuestion')}
          </Text>
          <RoleCard
            selected={role === 'candidate'}
            onPress={() => setRole('candidate')}
            icon={<Search size={20} color={role === 'candidate' ? colors.primary : colors.mutedForeground} />}
            title={t('onboarding.roleCandidate')}
            hint={t('onboarding.roleCandidateHint')}
          />
          <RoleCard
            selected={role === 'employer'}
            onPress={() => setRole('employer')}
            icon={<Briefcase size={20} color={role === 'employer' ? colors.primary : colors.mutedForeground} />}
            title={t('onboarding.roleEmployer')}
            hint={t('onboarding.roleEmployerHint')}
          />
          <Text variant="caption" tone="mutedForeground">
            {t('onboarding.roleLocked')}
          </Text>
        </View>
      )}

      <View style={{ gap: space[4] }}>
        <Field label={t('onboarding.fullName')} error={errors.fullName}>
          <TextField
            value={fullName}
            onChangeText={setFullName}
            accessibilityLabel={t('onboarding.fullName')}
            autoComplete="name"
            textContentType="name"
            maxLength={120}
          />
        </Field>

        <Field label={t('onboarding.whatsapp')} error={errors.whatsapp}>
          <TextField
            value={whatsapp}
            onChangeText={setWhatsapp}
            accessibilityLabel={t('onboarding.whatsapp')}
            ltr
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholder={t('onboarding.whatsappPlaceholder')}
          />
        </Field>

        {/* Only for a company, and only what a reviewer needs to decide on. */}
        {role === 'employer' ? (
          <View
            style={{
              gap: space[4],
              padding: space[4],
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: colors.border,
              backgroundColor: colors.muted,
            }}
          >
            <Text variant="small" weight="semibold">
              {t('onboarding.companySection')}
            </Text>
            <Field label={t('onboarding.companyName')} error={errors.company}>
              <TextField
                value={companyName}
                onChangeText={setCompanyName}
                accessibilityLabel={t('onboarding.companyName')}
                autoComplete="organization"
                textContentType="organizationName"
                maxLength={160}
              />
            </Field>
            <Field label={t('onboarding.companyWebsite')} hint={t('common.optional')} error={errors.companyWebsite}>
              <TextField
                value={companyWebsite}
                onChangeText={setCompanyWebsite}
                accessibilityLabel={t('onboarding.companyWebsite')}
                ltr
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="URL"
                placeholder="https://"
                maxLength={200}
              />
            </Field>
            <Field label={t('onboarding.companyDistrict')}>
              <Select
                label={t('onboarding.companyDistrict')}
                value={districtId}
                placeholder={t('common.optional')}
                options={(districts.data ?? []).map((district) => ({
                  value: district.id,
                  label: localized(locale, district.name_ar, district.name_en),
                }))}
                onChange={setDistrictId}
              />
            </Field>
            <Field label={t('onboarding.companyHeadcount')}>
              <Select
                label={t('onboarding.companyHeadcount')}
                value={headcount}
                placeholder={t('common.optional')}
                options={HEADCOUNT_BANDS.map((band) => ({ value: band, label: t(`companies.headcountBand.${band}`) }))}
                onChange={setHeadcount}
              />
            </Field>
            <Text variant="caption" tone="mutedForeground">
              {t('onboarding.companyReviewNote')}
            </Text>
          </View>
        ) : null}

        {/* Who sees a consultant's card in the directory: asked, with nothing
            chosen for them — the website's question (migration 336). */}
        {role === 'candidate' ? (
          <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.visibilityQuestion')}>
            <Text variant="small" weight="medium">
              {t('onboarding.visibilityQuestion')}
            </Text>
            <Text variant="caption" tone="mutedForeground">
              {t('onboarding.visibilityHint')}
            </Text>
            {(
              [
                ['public', 'publicHint', Eye],
                ['verified_employers_only', 'verifiedHint', BadgeCheck],
                ['hidden', 'hiddenHint', EyeOff],
              ] as const
            ).map(([value, hint, Icon]) => (
              <RoleCard
                key={value}
                selected={visibility === value}
                onPress={() => setVisibility(value)}
                icon={<Icon size={20} color={visibility === value ? colors.primary : colors.mutedForeground} />}
                title={t(`visibility.${value}`)}
                hint={t(`visibility.${hint}`)}
              />
            ))}
            {errors.visibility ? (
              <Text variant="caption" tone="destructive" accessibilityRole="alert">
                {errors.visibility}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Each language in its own name: this picks the language of the emails,
            and somebody who cannot read the current one has to find theirs. */}
        <Field label={t('onboarding.locale')}>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('onboarding.locale')}
            style={{ flexDirection: 'row', gap: space[2] }}
          >
            <Chip radio label="العربية" selected={profileLocale === 'ar'} onPress={() => setProfileLocale('ar')} />
            <Chip radio label="English" selected={profileLocale === 'en'} onPress={() => setProfileLocale('en')} />
          </View>
        </Field>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          onPress={() => setAgreed((value) => !value)}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3], minHeight: 44 }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              marginTop: 3,
              ...corner('md'),
              borderWidth: 1.5,
              borderColor: agreed ? colors.primary : colors.input,
              backgroundColor: agreed ? colors.primary : colors.card,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {agreed ? <Check size={16} color={colors.primaryForeground} /> : null}
          </View>
          <Text variant="small" style={{ flex: 1 }}>
            {t.rich('onboarding.consent', {
              terms: (chunks: ReactNode) => (
                <Text variant="small" weight="semibold" tone="primary" onPress={() => openSitePage('/terms')} suppressHighlighting>
                  {chunks}
                </Text>
              ),
              privacy: (chunks: ReactNode) => (
                <Text variant="small" weight="semibold" tone="primary" onPress={() => openSitePage('/privacy')} suppressHighlighting>
                  {chunks}
                </Text>
              ),
            })}
          </Text>
        </Pressable>
        {errors.terms ? (
          <Text variant="caption" tone="destructive" accessibilityRole="alert">
            {errors.terms}
          </Text>
        ) : null}

        {errors.form ? <Notice tone="destructive">{errors.form}</Notice> : null}

        <Button label={t('onboarding.submit')} size="lg" loading={pending} onPress={submit} />
        <Button label={t('nav.signOut')} variant="ghost" disabled={pending} onPress={onSignOut} />
        {/* The website's way out of onboarding: an account that never got past
            its email address can go without agreeing to anything first. */}
        <Button label={t('onboarding.leaveDelete')} variant="ghost" disabled={pending} onPress={confirmDelete} />
      </View>
    </AuthScroll>
  );
}

function RoleCard({
  selected,
  onPress,
  icon,
  title,
  hint,
}: {
  selected: boolean;
  onPress: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space[1],
        padding: space[4],
        ...corner('xl'),
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: pressed ? colors.muted : selected ? colors.secondary : colors.card,
      })}
    >
      {icon}
      <Text weight="semibold">{title}</Text>
      <Text variant="small" tone="mutedForeground">
        {hint}
      </Text>
    </Pressable>
  );
}
