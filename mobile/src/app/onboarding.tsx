import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type ScrollView, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useLocale, useTranslations } from 'use-intl';
import { BadgeCheck, Briefcase, Check, Eye, EyeOff, MailCheck, Search, type LucideProps } from '~/components/ui/lucide';
import type { OnboardingInput } from '@/lib/mobile-api/contract';
import { formatNumber } from '@/lib/format';
import { localized, type Locale } from '@/lib/locale';
import { isValidPhone, normalisePhone } from '@/lib/phone';
import { safeHttpUrl } from '@/lib/security/sanitize';
import { HEADCOUNT_BANDS } from '@/lib/taxonomy';
import type { AgentVisibility, HeadcountBand } from '@/lib/supabase/database.types';
import { AuthScroll } from '~/components/auth/auth-scroll';
import { Appear, type AppearFrom } from '~/components/motion/appear';
import { ProgressBar } from '~/components/motion/progress-bar';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { Field } from '~/components/ui/field';
import { BackChevron } from '~/components/ui/icons';
import { Notice } from '~/components/ui/notice';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Select } from '~/components/ui/select';
import { LoadingState } from '~/components/ui/states';
import { Illustration } from '~/components/ui/illustration';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { deleteAccountHere, type DeleteRefusal } from '~/features/account/delete';
import { asRole, intentFromParams, type AuthIntent, type Role } from '~/features/auth/intent';
import { keepOnboardingIntent, keptOnboardingIntent } from '~/features/auth/kept-intent';
import { useCloseFlow, useLand } from '~/features/auth/land';
import { signOutHere } from '~/features/push/device';
import { useDistricts } from '~/features/taxonomy';
import { markupTags } from '~/i18n/rich';
import { callAction } from '~/lib/api';
import { env } from '~/lib/env';
import { haptic } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { useErrorsInView } from '~/lib/use-errors-in-view';
import { useHoldBack } from '~/lib/use-hold-back';
import { webAddress } from '~/lib/web-address';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, motion, space } from '~/theme/tokens';
import { dialog } from '~/lib/dialog';

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
  const given = intentFromParams(params);
  const t = useTranslations();
  const { ready, session, viewer } = useSession();

  // Opened with a destination: kept for the account, in case iOS ends the app
  // before onboarding is done (kept-intent.ts). Opened without one — the
  // session gate reopening it after such an ending — the kept one is read back.
  const userId = session?.user.id ?? null;
  const givenAny = Boolean(given.next || given.role || given.confirmed);
  const [kept, setKept] = useState<{ userId: string; intent: AuthIntent | null } | null>(null);
  useEffect(() => {
    if (!userId) return;
    if (givenAny) {
      void keepOnboardingIntent(userId, { next: given.next, role: given.role, confirmed: given.confirmed });
      return;
    }
    let active = true;
    keptOnboardingIntent(userId).then((intent) => {
      if (active) setKept({ userId, intent });
    });
    return () => {
      active = false;
    };
  }, [userId, givenAny, given.next, given.role, given.confirmed]);
  const keptHere = kept && kept.userId === userId ? kept : null;
  const intent = givenAny ? given : (keptHere?.intent ?? given);
  const intentKnown = givenAny || Boolean(keptHere);
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
      {ready && session && !viewer?.profile && intentKnown ? (
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
            dialog.alert(t('app.account.deleted'));
            return null;
          }}
        />
      ) : (
        <LoadingState />
      )}
    </>
  );
}

/** The steps, in order. The role is asked only when the door did not settle it; who sees the card, only of a consultant. */
type Step = 'role' | 'details' | 'visibility' | 'finish';

/** Where each answer that can be refused is asked: a refusal takes the person back to its step. */
const FIELD_STEP: Record<string, Step> = {
  fullName: 'details',
  whatsapp: 'details',
  company: 'details',
  companyWebsite: 'details',
  visibility: 'visibility',
  terms: 'finish',
};
const FIELD_ORDER = ['fullName', 'whatsapp', 'company', 'companyWebsite', 'visibility', 'terms'];

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
  const large = useLargeText();
  const locale = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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

  const steps: Step[] = [
    ...(settledRole ? [] : (['role'] as const)),
    'details',
    ...(role === 'candidate' ? (['visibility'] as const) : []),
    'finish',
  ];
  const [at, setAt] = useState(0);
  const index = Math.min(at, steps.length - 1);
  const step = steps[index];
  // Onward, the next step comes in from the side the reading goes to; back, from the other.
  const [arriving, setArriving] = useState<AppearFrom>('below');
  const stepLabel = t.markup('app.jobs.wizardStep', {
    current: formatNumber(index + 1, locale),
    total: formatNumber(steps.length, locale),
    ...markupTags,
  });

  // The button is at the bottom of each step, below its questions: an error
  // above them is brought into view and said.
  const scroll = useRef<ScrollView>(null);
  const inView = useErrorsInView(scroll, FIELD_ORDER);
  const refuse = (next: Record<string, string>) => {
    setErrors(next);
    inView.show(next);
  };
  // The return key moves from the name to the number (the phone pad has none of its own).
  const whatsappField = useRef<TextInput>(null);

  function goTo(next: number) {
    Keyboard.dismiss();
    setArriving(next > index ? 'end' : 'start');
    setAt(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  /** What the website would refuse, said before anything is sent: its own rules. */
  function problems(): Record<string, string> {
    const missing: Record<string, string> = {};
    if (fullName.trim().length < 2) missing.fullName = t('validation.required');
    if (!isValidPhone(normalisePhone(whatsapp))) missing.whatsapp = t('validation.invalidPhone');
    if (role === 'employer' && companyName.trim().length < 2) missing.company = t('validation.required');
    // As the company page takes it: "nilebrokers.com" is https://nilebrokers.com.
    // Sent as typed, the website refused it as not an address.
    const website = role === 'employer' ? webAddress(companyWebsite) : null;
    if (website && !safeHttpUrl(website)) missing.companyWebsite = t('validation.invalidUrl');
    if (role === 'candidate' && !visibility) missing.visibility = t('onboarding.visibilityRequired');
    if (!agreed) missing.terms = t('onboarding.consentRequired');
    return missing;
  }

  /** The refusals given, shown on the first step that asks one of them. */
  function refuseWhereAsked(next: Record<string, string>) {
    const first = steps.findIndex((name) => Object.keys(next).some((field) => FIELD_STEP[field] === name));
    if (first >= 0 && first !== index) goTo(first);
    refuse(next);
  }

  function onward() {
    setErrors({});
    const here = Object.fromEntries(Object.entries(problems()).filter(([field]) => FIELD_STEP[field] === step));
    if (Object.keys(here).length) {
      refuse(here);
      return;
    }
    haptic.selection();
    goTo(index + 1);
  }

  function back() {
    setErrors({});
    goTo(index - 1);
  }

  function confirmDelete() {
    dialog.alert(t('onboarding.leaveDelete'), t('onboarding.leaveConfirm'), [
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
      refuse({ form: refusal === 'apple' ? t('app.account.deleteAppleFailed') : t('onboarding.leaveFailed') });
    }
  }

  async function submit() {
    setErrors({});
    const missing = problems();
    if (Object.keys(missing).length) {
      refuseWhereAsked(missing);
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
              website: webAddress(companyWebsite),
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
      if (!fields || !Object.keys(fields).length) {
        refuse({ form: t('common.errorBody') });
        return;
      }
      refuseWhereAsked({
        ...(fields.fullName ? { fullName: t('validation.required') } : {}),
        ...(fields.whatsapp ? { whatsapp: t('validation.invalidPhone') } : {}),
        ...(fields.company ? { company: t('validation.required') } : {}),
        ...(fields.companyWebsite ? { companyWebsite: t('validation.invalidUrl') } : {}),
        ...(fields.visibility ? { visibility: t('onboarding.visibilityRequired') } : {}),
        ...(fields.agreed ? { terms: t('onboarding.consentRequired') } : {}),
        ...(fields.role || fields.locale ? { form: t('common.errorBody') } : {}),
      });
      return;
    }

    haptic.success();
    await onDone();
    setPending(false);
  }

  const openSitePage = (path: string) => WebBrowser.openBrowserAsync(`${env.siteUrl}${path}`).catch(() => {});
  const last = index === steps.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Where the person is: a way back, the step, and how far through they are. */}
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: gutter, paddingBottom: space[2], gap: space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: hitTarget }}>
          <View style={{ width: hitTarget }}>
            {index > 0 ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={back}
                disabled={pending}
                style={({ pressed }) => ({
                  width: hitTarget,
                  height: hitTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...corner('full'),
                  backgroundColor: pressed ? colors.muted : colors.secondary,
                })}
              >
                <BackChevron size={22} color={colors.secondaryForeground} />
              </PressableScale>
            ) : null}
          </View>
          <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
            <Text variant="small" weight="semibold" numberOfLines={1} style={{ textAlign: 'center' }}>
              {t('onboarding.title')}
            </Text>
            <Text variant="caption" tone="mutedForeground" numberOfLines={1} style={{ textAlign: 'center' }}>
              {stepLabel}
            </Text>
          </View>
          <View style={{ width: hitTarget }} />
        </View>
        <ProgressBar value={(index + 1) / steps.length} label={stepLabel} />
      </View>

      <AuthScroll ref={scroll}>
        {/* Keyed by the step: each one arrives on its own. */}
        <Appear key={step} from={arriving} distance={28} duration={motion.step} style={{ gap: space[5] }}>
          {index === 0 && intent.confirmed ? (
            <Notice tone="success" title={t('onboarding.confirmedBanner')} icon={<MailCheck size={16} color={colors.success} />} />
          ) : null}

          {step === 'role' ? (
            <>
              {/* The website's drawing of a person choosing: the one step with nobody in it yet. */}
              {large ? null : (
                <View style={{ alignItems: 'center' }}>
                  <Illustration name="choose" width={150} />
                </View>
              )}
              <StepHeading title={t('onboarding.roleQuestion')} body={t('app.onboarding.roleBody')} />
              <View style={{ gap: space[3] }} accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.roleQuestion')}>
                <ChoiceCard
                  selected={role === 'candidate'}
                  onPress={() => setRole('candidate')}
                  icon={Search}
                  title={t('onboarding.roleCandidate')}
                  hint={t('onboarding.roleCandidateHint')}
                />
                <ChoiceCard
                  selected={role === 'employer'}
                  onPress={() => setRole('employer')}
                  icon={Briefcase}
                  title={t('onboarding.roleEmployer')}
                  hint={t('onboarding.roleEmployerHint')}
                />
              </View>
              <Text variant="caption" tone="mutedForeground">
                {t('onboarding.roleLocked')}
              </Text>
            </>
          ) : null}

          {step === 'details' ? (
            <>
              <StepHeading
                title={role === 'employer' ? t('app.onboarding.detailsTitleEmployer') : t('app.onboarding.detailsTitle')}
                body={role === 'employer' ? t('app.onboarding.detailsBodyEmployer') : t('app.onboarding.detailsBody')}
              />
              {/* The door chose the kind of account: said, not asked. */}
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
              ) : null}

              <View style={{ gap: space[4] }}>
                <Field ref={inView.place('fullName')} label={t('onboarding.fullName')} error={errors.fullName}>
                  <TextField
                    value={fullName}
                    onChangeText={setFullName}
                    accessibilityLabel={t('onboarding.fullName')}
                    autoComplete="name"
                    textContentType="name"
                    maxLength={120}
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => whatsappField.current?.focus()}
                  />
                </Field>

                <Field ref={inView.place('whatsapp')} label={t('onboarding.whatsapp')} error={errors.whatsapp}>
                  <TextField
                    ref={whatsappField}
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
                    <Field ref={inView.place('company')} label={t('onboarding.companyName')} error={errors.company}>
                      <TextField
                        value={companyName}
                        onChangeText={setCompanyName}
                        accessibilityLabel={t('onboarding.companyName')}
                        autoComplete="organization"
                        textContentType="organizationName"
                        maxLength={160}
                      />
                    </Field>
                    <Field
                      ref={inView.place('companyWebsite')}
                      label={t('onboarding.companyWebsite')}
                      hint={t('common.optional')}
                      error={errors.companyWebsite}
                    >
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
              </View>
            </>
          ) : null}

          {/* Who sees a consultant's card in the directory: asked, with nothing
              chosen for them — the website's question (migration 336). */}
          {step === 'visibility' ? (
            <>
              <StepHeading title={t('onboarding.visibilityQuestion')} body={t('onboarding.visibilityHint')} />
              <View
                ref={inView.place('visibility')}
                style={{ gap: space[3] }}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('onboarding.visibilityQuestion')}
              >
                {(
                  [
                    ['public', 'publicHint', Eye],
                    ['verified_employers_only', 'verifiedHint', BadgeCheck],
                    ['hidden', 'hiddenHint', EyeOff],
                  ] as const
                ).map(([value, hint, Icon]) => (
                  <ChoiceCard
                    key={value}
                    selected={visibility === value}
                    onPress={() => setVisibility(value)}
                    icon={Icon}
                    title={t(`visibility.${value}`)}
                    hint={t(`visibility.${hint}`)}
                  />
                ))}
              </View>
              {errors.visibility ? (
                <Text variant="caption" tone="destructive" accessibilityRole="alert">
                  {errors.visibility}
                </Text>
              ) : null}
            </>
          ) : null}

          {step === 'finish' ? (
            <>
              <StepHeading title={t('app.onboarding.finishTitle')} body={t('app.onboarding.finishBody')} />

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

              {/* One element to VoiceOver, which cannot reach the links inside it:
                  they are offered as its actions too. */}
              <Pressable
                ref={inView.place('terms')}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
                accessibilityActions={[
                  { name: 'terms', label: t('footer.terms') },
                  { name: 'privacy', label: t('footer.privacy') },
                ]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'terms') openSitePage('/terms');
                  if (event.nativeEvent.actionName === 'privacy') openSitePage('/privacy');
                }}
                onPress={() => setAgreed((value) => !value)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: space[3],
                  minHeight: 44,
                  padding: space[4],
                  ...corner('xl'),
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: agreed ? colors.primary : colors.border,
                  backgroundColor: colors.card,
                }}
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
            </>
          ) : null}

          {errors.form ? <Notice tone="destructive">{errors.form}</Notice> : null}

          <Button
            label={last ? t('onboarding.submit') : t('jobForm.next')}
            size="lg"
            loading={pending && last}
            disabled={pending && !last}
            onPress={last ? submit : onward}
          />

          {/* The website's way out of onboarding, where it starts: sign out, or —
              for an account that never got past its email address — go
              without agreeing to anything first. */}
          {index === 0 ? (
            <View style={{ gap: space[1], alignItems: 'stretch' }}>
              <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
                {t('onboarding.leaveQuestion')}
              </Text>
              <Button label={t('nav.signOut')} variant="ghost" disabled={pending} onPress={onSignOut} />
              <Button label={t('onboarding.leaveDelete')} variant="ghost" disabled={pending} onPress={confirmDelete} />
            </View>
          ) : null}
        </Appear>
      </AuthScroll>
    </View>
  );
}

/** A step's question and the sentence under it. */
function StepHeading({ title, body }: { title: string; body?: string | null }) {
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="title" weight="bold" accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text tone="mutedForeground">{body}</Text> : null}
    </View>
  );
}

/**
 * One answer among a few, as a card: its sign, what it is, what it means, and
 * a mark at the end when it is the one chosen. To VoiceOver a radio button,
 * named by both lines.
 */
function ChoiceCard({
  selected,
  onPress,
  icon: Icon,
  title,
  hint,
}: {
  selected: boolean;
  onPress: () => void;
  icon: ComponentType<LucideProps>;
  title: string;
  hint: string;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${hint}`}
      onPress={() => {
        if (!selected) haptic.selection();
        onPress();
      }}
      scaleTo={0.98}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3],
        padding: space[4],
        ...corner('xl'),
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: pressed ? colors.muted : selected ? colors.secondary : colors.card,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? colors.primary : colors.muted,
        }}
      >
        <Icon size={20} color={selected ? colors.primaryForeground : colors.mutedForeground} />
      </View>
      <View style={{ flex: 1, gap: space[1] }}>
        <Text weight="semibold">{title}</Text>
        <Text variant="small" tone="mutedForeground">
          {hint}
        </Text>
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          marginTop: 9,
          borderRadius: 11,
          borderWidth: selected ? 0 : 1.5,
          borderColor: colors.input,
          backgroundColor: selected ? colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Check size={14} color={colors.primaryForeground} /> : null}
      </View>
    </PressableScale>
  );
}
