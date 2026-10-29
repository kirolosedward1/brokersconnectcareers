import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, Switch, View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { BadgeCheck, Briefcase, Building2, Check, CircleDashed, Eye, EyeOff, FileText, MailCheck, Paperclip, Search } from '~/components/ui/lucide';
import type { OnboardingInput } from '@/lib/mobile-api/contract';
import { formatEgp, formatList, formatNumber } from '@/lib/format';
import { localized, type Locale } from '@/lib/locale';
import { isValidPhone, normalisePhone } from '@/lib/phone';
import { safeHttpUrl } from '@/lib/security/sanitize';
import { COMPANY_TYPES, EXPERIENCE_BANDS, JOB_TRACKS, MIN_SALARY_STEPS } from '@/lib/taxonomy';
import type { AgentVisibility, CompanyType, ExperienceBand, JobTrack } from '@/lib/supabase/database.types';
import { ConsentCheck } from '~/components/auth/consent-check';
import { StepFrame, StepSection } from '~/components/onboarding/frame';
import { LogoControls } from '~/components/employer/logo-controls';
import { TeamSettings } from '~/components/employer/team-settings';
import { VerificationPanel } from '~/components/employer/verification-panel';
import type { AppearFrom } from '~/components/motion/appear';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { ChoiceCard } from '~/components/ui/choice-card';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { NUM_STYLE } from '~/components/ui/num';
import { Select } from '~/components/ui/select';
import { LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { deleteAccountHere, type DeleteRefusal } from '~/features/account/delete';
import { asRole, intentFromParams, type AuthIntent, type Role } from '~/features/auth/intent';
import { keepOnboardingIntent, keptOnboardingIntent } from '~/features/auth/kept-intent';
import { useCloseFlow, useLand } from '~/features/auth/land';
import { pickCv, type PickedCv } from '~/features/cv/files';
import { useCompanyPage } from '~/features/employer/company';
import { useBoardTotal } from '~/features/jobs/queries';
import {
  answersFilters,
  answersQuery,
  finishCandidate,
  finishCompany,
  type LeadsChoice,
} from '~/features/onboarding/finish';
import { signOutHere } from '~/features/push/device';
import { useDistricts } from '~/features/taxonomy';
import { markupTags } from '~/i18n/rich';
import { track } from '~/lib/analytics';
import { callAction } from '~/lib/api';
import { haptic } from '~/lib/haptics';
import { fetchViewer, useSession } from '~/lib/session';
import { useErrorsInView } from '~/lib/use-errors-in-view';
import { useHoldBack } from '~/lib/use-hold-back';
import { webAddress } from '@/lib/web-address';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { dialog } from '~/lib/dialog';
import { toast } from '~/components/feedback/toast';

/**
 * The step that makes an account a profile — the website's onboarding
 * (src/components/auth/onboarding-form.tsx) through its own action
 * (completeOnboarding), so the profile, the directory entry and the company
 * are created exactly as they are there — set out as the design's three
 * steps for each kind of account.
 *
 * A consultant: what they work in and for how long; where, for what basic,
 * and who brings the clients; then their directory card — a CV, what they
 * have sold, the number companies write to, who sees the card (asked, with
 * nothing chosen for them), whether they are open to offers, an alert for
 * the jobs that fit — and the Terms of use. The account is made with the
 * last step, then everything else is written onto it (features/onboarding/finish.ts).
 *
 * A company: who it is and who is signing it up, and the Terms — the account
 * and the company are made there, since the next two steps need them: the
 * papers it is verified on, then what is left to do (the first listing, a
 * colleague on the team).
 *
 * The role arrives pre-chosen when the door implied one and is then a
 * receipt; otherwise it is asked first, outside the three. Shown over
 * everything until the account is made; the way out is to sign out, or to
 * delete the account, as on the website.
 */
export default function OnboardingScreen() {
  const params = useLocalSearchParams<{ next?: string; role?: string; confirmed?: string; setup?: string }>();
  const given = intentFromParams(params);
  // A consultant whose account was just made from the apply screen (guest
  // apply): the application went first, and their tracks, areas and pay come
  // now, onto the profile that exists.
  const setup = params.setup === '1';
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

  // Once the account is being made, the steps stay on screen until they are
  // done: a company's papers and first listing come after its profile exists.
  const [continuing, setContinuing] = useState(false);

  // Nothing to ask: signed out in the meantime, or onboarded already (in
  // another tab, on the website) — the website's onboarding page redirects
  // the same way. Once only, however often the session re-renders this.
  const left = useRef(false);
  useEffect(() => {
    if (!ready || left.current) return;
    if (!session) {
      left.current = true;
      close();
    } else if (viewer?.profile && !setup) {
      left.current = true;
      void land(intent);
    }
  }, [ready, session, viewer?.profile, close, land, intent, setup]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {/* The form is drawn once the session is known, so what it offers
          (the provider's name, the door's role) is there from the start. */}
      {ready && session && ((setup && viewer?.profile) || continuing || (!viewer?.profile && intentKnown)) ? (
        <OnboardingForm
          session={session}
          intent={intent}
          existing={setup && viewer?.profile ? { fullName: viewer.profile.full_name, whatsapp: viewer.profile.whatsapp_phone } : null}
          onCreating={() => {
            left.current = true;
            setContinuing(true);
          }}
          onFailedToCreate={() => {
            left.current = false;
            setContinuing(false);
          }}
          onDone={async (next) => {
            left.current = true;
            await land(next ? { ...intent, next } : intent);
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
            // Said in passing, not in an alert to dismiss: the welcome is opening as it is said (HIG, Alerts).
            toast.show({ message: t('app.account.deleted'), tone: 'success' });
            return null;
          }}
        />
      ) : (
        <LoadingState />
      )}
    </>
  );
}

type CandidateStep = 'work' | 'area' | 'directory';
type CompanyStep = 'company' | 'verify' | 'ready';
type Step = 'role' | CandidateStep | CompanyStep;

/** Where the answers that can be refused are asked — all on one step for each kind of account: a refusal takes the person back to it. */
function refusedStep(role: Role): Step {
  return role === 'employer' ? 'company' : 'directory';
}
const FIELD_ORDER = ['fullName', 'whatsapp', 'company', 'companyWebsite', 'visibility', 'terms'];

function OnboardingForm({
  session,
  intent,
  existing,
  onCreating,
  onFailedToCreate,
  onDone,
  onSignOut,
  onDelete,
}: {
  session: Session;
  intent: AuthIntent;
  /** A consultant's profile already made (guest apply): only their answers are asked, and saved onto it. */
  existing: { fullName: string; whatsapp: string } | null;
  /** The account is about to be made: the screen stays until the steps are done. */
  onCreating: () => void;
  onFailedToCreate: () => void;
  /** Leave, for `next` when given (a company's first listing), otherwise where the person was going. */
  onDone: (next?: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  /** Deletes the account; null when it is gone, otherwise why not. */
  onDelete: () => Promise<DeleteRefusal | null>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const districts = useDistricts();

  const metadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const providerName =
    (typeof metadata.full_name === 'string' && metadata.full_name) || (typeof metadata.name === 'string' && metadata.name) || '';
  const suggestedName = providerName || (session.user.email ? session.user.email.split('@')[0] : '');
  const settledRole = existing ? 'candidate' : (intent.role ?? asRole(metadata.role));

  // The account.
  const [role, setRole] = useState<Role>(settledRole ?? 'candidate');
  const [fullName, setFullName] = useState(suggestedName);
  const [whatsapp, setWhatsapp] = useState('');
  const [profileLocale, setProfileLocale] = useState<Locale>(locale);
  const [agreed, setAgreed] = useState(false);
  // Who sees a candidate's directory card: nothing chosen in advance.
  const [visibility, setVisibility] = useState<AgentVisibility | null>(null);

  // A consultant's answers.
  const [tracks, setTracks] = useState<JobTrack[]>([]);
  const [band, setBand] = useState<ExperienceBand | null>(null);
  const [districtIds, setDistrictIds] = useState<number[]>([]);
  const [allDistricts, setAllDistricts] = useState(false);
  const [minSalary, setMinSalary] = useState<number | null>(null);
  const [leads, setLeads] = useState<LeadsChoice>('either');
  const [cv, setCv] = useState<PickedCv | null>(null);
  const [units, setUnits] = useState('');
  const [openToOffers, setOpenToOffers] = useState(true);
  const [alert, setAlert] = useState(true);

  // A company's.
  const [companyName, setCompanyName] = useState('');
  const [companyNameEn, setCompanyNameEn] = useState('');
  const [companyType, setCompanyType] = useState<CompanyType | null>(null);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [companyWebsite, setCompanyWebsite] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Made: from here the account exists, and the steps before cannot be gone back to.
  const [created, setCreated] = useState(false);

  // Signing out takes a moment (the phone forgotten for pushes, then the
  // session): said on the button, and everything else held, so a second tap
  // does not close the flow a second time — popping whatever was under it.
  const signOut = () => {
    if (pending) return;
    setPending(true);
    setSigningOut(true);
    // Stays busy when it works: the screen closes.
    onSignOut().catch(() => {
      setPending(false);
      setSigningOut(false);
    });
  };

  const counted: Step[] = role === 'candidate' ? ['work', 'area', 'directory'] : ['company', 'verify', 'ready'];
  const steps: Step[] = [...(settledRole ? [] : (['role'] as const)), ...counted];
  const [at, setAt] = useState(0);
  const index = Math.min(at, steps.length - 1);
  const step = steps[index];
  const place = counted.indexOf(step);
  // Onward, the next step comes in from the side the reading goes to; back, from the other.
  const [arriving, setArriving] = useState<AppearFrom>('below');
  const position =
    place >= 0
      ? {
          current: place + 1,
          total: counted.length,
          label: t.markup('app.jobs.wizardStep', {
            current: formatNumber(place + 1, locale),
            total: formatNumber(counted.length, locale),
            ...markupTags,
          }),
        }
      : null;
  const eyebrow =
    place >= 0
      ? t.markup(role === 'candidate' ? 'app.onboarding.forCandidates' : 'app.onboarding.forCompanies', {
          current: place + 1,
          total: counted.length,
          ...markupTags,
        })
      : null;

  // The button is at the bottom of each step, below its questions: an error
  // above them is brought into view and said.
  const scroll = useRef<ScrollViewInstance>(null);
  const inView = useErrorsInView(scroll, FIELD_ORDER);
  const refuse = (next: Record<string, string>) => {
    setErrors(next);
    inView.show(next);
  };
  const whatsappField = useRef<TextInputInstance>(null);

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
    const website = role === 'employer' ? webAddress(companyWebsite) : null;
    if (website && !safeHttpUrl(website)) missing.companyWebsite = t('validation.invalidUrl');
    if (role === 'candidate' && !visibility) missing.visibility = t('onboarding.visibilityRequired');
    if (!agreed) missing.terms = t('onboarding.consentRequired');
    return missing;
  }

  /** A number or an address checked as the reader leaves its field, once something is typed in it. */
  function checkOnLeave(field: 'whatsapp' | 'companyWebsite', typed: string) {
    const problem = typed.trim() ? problems()[field] : undefined;
    setErrors((current) => {
      if ((current[field] ?? undefined) === problem) return current;
      const next = { ...current };
      if (problem) next[field] = problem;
      else delete next[field];
      return next;
    });
  }

  function onward() {
    setErrors({});
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

  /** The account, through the website's own action: refused fields are said where they are asked. */
  async function createAccount(): Promise<boolean> {
    setErrors({});
    const missing = problems();
    if (Object.keys(missing).length) {
      refuse(missing);
      return false;
    }
    const input: OnboardingInput = {
      role,
      fullName,
      whatsapp,
      locale: profileLocale,
      agreed: true,
      attribution: { inApp: true },
      visibility: role === 'candidate' ? (visibility ?? undefined) : undefined,
      company:
        role === 'employer'
          ? { nameAr: companyName, website: webAddress(companyWebsite), headcountBand: null, districtId }
          : undefined,
    };
    setPending(true);
    onCreating();
    const result = await callAction('completeOnboarding', input).catch(() => null);
    if (!result || !result.ok) {
      setPending(false);
      onFailedToCreate();
      const fields = result && !result.ok ? result.fieldErrors : undefined;
      if (!fields || !Object.keys(fields).length) {
        refuse({ form: t('common.errorBody') });
        return false;
      }
      const said = {
        ...(fields.fullName ? { fullName: t('validation.required') } : {}),
        ...(fields.whatsapp ? { whatsapp: t('validation.invalidPhone') } : {}),
        ...(fields.company ? { company: t('validation.required') } : {}),
        ...(fields.companyWebsite ? { companyWebsite: t('validation.invalidUrl') } : {}),
        ...(fields.visibility ? { visibility: t('onboarding.visibilityRequired') } : {}),
        ...(fields.agreed ? { terms: t('onboarding.consentRequired') } : {}),
        ...(fields.role || fields.locale ? { form: t('common.errorBody') } : {}),
      };
      const first = steps.indexOf(refusedStep(role));
      if (first >= 0 && first !== index) goTo(first);
      refuse(said);
      return false;
    }
    setCreated(true);
    track(role === 'candidate' ? 'candidate_onboarding_completed' : 'employer_onboarding_completed', {});
    return true;
  }

  const districtRows = useMemo(() => districts.data ?? [], [districts.data]);
  const filters = useMemo(
    () => answersFilters({ tracks, districtIds, minSalary, leads }, districtRows),
    [tracks, districtIds, minSalary, leads, districtRows],
  );
  const matchingQuery = answersQuery(filters);
  const matching = useBoardTotal(matchingQuery, role === 'candidate' && (step === 'area' || step === 'directory'));

  async function finishAsCandidate() {
    if (existing) setPending(true);
    else if (!(await createAccount())) return;
    const unitsClosed = /^\d+$/.test(units.trim()) ? Number(units.trim()) : null;
    const label = formatList(
      [
        ...tracks.map((value) => t(`track.${value}`)),
        ...districtIds
          .map((id) => districtRows.find((row) => row.id === id))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map((row) => localized(locale, row.name_ar, row.name_en)),
      ],
      locale,
    );
    const hasFilters = Boolean(tracks.length || districtIds.length || minSalary || leads !== 'either');
    const outcome = await finishCandidate(
      session.user.id,
      existing ? { ...existing, visibility: null } : { fullName, whatsapp, visibility: visibility as AgentVisibility },
      {
        tracks,
        band,
        districtIds,
        minSalary,
        leads,
        cv,
        unitsClosed,
        availability: openToOffers ? 'open_to_offers' : 'employed_not_looking',
        alert,
      },
      alert && hasFilters ? { label: label || t('app.onboarding.alertLabel'), query: matchingQuery } : null,
    );
    haptic.success();
    if (!outcome.complete) toast.show({ message: t('app.onboarding.partlySaved') });
    // The board the person lands on is the one these answers make.
    await onDone(hasFilters && !intent.next ? `/jobs?${matchingQuery}` : undefined);
    setPending(false);
  }

  async function createCompany() {
    if (!(await createAccount())) return;
    const outcome = await finishCompany(session.user.id, {
      nameAr: companyName,
      nameEn: companyNameEn.trim() || null,
      website: webAddress(companyWebsite),
      companyType,
      districtId,
    });
    // The company the next steps work on: in the session before they draw.
    await fetchViewer(queryClient).catch(() => null);
    setPending(false);
    haptic.success();
    if (!outcome.complete) toast.show({ message: t('app.onboarding.partlySaved') });
    goTo(index + 1);
  }

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const firstName = providerName.trim().split(/\s+/)[0] ?? '';
  const visibleDistricts = allDistricts ? districtRows : districtRows.slice(0, 8);

  // ——— The steps ———

  let title = '';
  let body: string | null = null;
  let content: ReactNode = null;
  let action: ReactNode = null;
  let footnote: ReactNode = null;
  let skip: { label: string; onPress: () => void } | null = null;

  const matchingLine =
    matching.data != null ? (
      <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
        {t.markup('app.onboarding.matching', { count: matching.data, ...markupTags })}
      </Text>
    ) : null;

  if (step === 'role') {
    title = t('onboarding.roleQuestion');
    body = t('app.onboarding.roleBody');
    content = (
      <>
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
    );
    action = <Button label={t('jobForm.next')} size="lg" disabled={pending} onPress={onward} />;
  }

  if (step === 'work') {
    title = firstName ? t('app.onboarding.workTitleNamed', { name: firstName }) : t('app.onboarding.workTitle');
    body = t('app.onboarding.workBody');
    content = (
      <>
        <View style={{ gap: space[2] }} accessibilityLabel={t('app.onboarding.workTitle')}>
          {JOB_TRACKS.map((value) => (
            <ChoiceCard
              key={value}
              multiple
              selected={tracks.includes(value)}
              onPress={() => setTracks((list) => toggle(list, value))}
              title={t(`track.${value}`)}
              hint={t(`app.onboarding.trackHint.${value}`)}
            />
          ))}
        </View>
        <StepSection title={t('app.onboarding.yearsTitle')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('app.onboarding.yearsTitle')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {EXPERIENCE_BANDS.map((value) => (
              <Chip key={value} radio label={t(`experienceBand.${value}`)} selected={band === value} onPress={() => setBand(value)} />
            ))}
          </View>
        </StepSection>
      </>
    );
    action = <Button label={t('app.onboarding.workNext')} size="lg" disabled={pending} onPress={onward} />;
    skip = { label: t('app.onboarding.skip'), onPress: () => goTo(steps.indexOf('directory')) };
  }

  if (step === 'area') {
    title = t('app.onboarding.areaTitle');
    body = t('app.onboarding.areaBody');
    content = (
      <>
        <StepSection title={t('app.onboarding.districtsTitle')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {visibleDistricts.map((row) => (
              <Chip
                key={row.id}
                label={localized(locale, row.name_ar, row.name_en)}
                selected={districtIds.includes(row.id)}
                onPress={() => setDistrictIds((list) => toggle(list, row.id))}
              />
            ))}
            {!allDistricts && districtRows.length > visibleDistricts.length ? (
              <Chip label={t('app.onboarding.moreDistricts')} feedback={false} onPress={() => setAllDistricts(true)} />
            ) : null}
          </View>
        </StepSection>
        <StepSection title={t('app.onboarding.minBasicTitle')} hint={t('app.onboarding.minBasicHint')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('app.onboarding.minBasicTitle')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Chip radio label={t('app.onboarding.anySalary')} selected={minSalary === null} onPress={() => setMinSalary(null)} />
            {MIN_SALARY_STEPS.map((value) => (
              <Chip
                key={value}
                radio
                label={t.markup('app.money.amount', { amount: formatEgp(value, locale), ...markupTags })}
                selected={minSalary === value}
                onPress={() => setMinSalary(value)}
              />
            ))}
          </View>
        </StepSection>
        <StepSection title={t('app.onboarding.leadsTitle')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('app.onboarding.leadsTitle')} style={{ gap: space[2] }}>
            {(['company', 'self', 'either'] as const).map((value) => (
              <ChoiceCard
                key={value}
                selected={leads === value}
                onPress={() => setLeads(value)}
                title={t(`app.onboarding.leads.${value}`)}
                hint={t(`app.onboarding.leads.${value}Hint`)}
              />
            ))}
          </View>
        </StepSection>
      </>
    );
    action = <Button label={t('app.onboarding.areaNext')} size="lg" disabled={pending} onPress={onward} />;
    footnote = matchingLine;
    skip = { label: t('app.onboarding.skip'), onPress: () => goTo(steps.indexOf('directory')) };
  }

  if (step === 'directory') {
    title = t('app.onboarding.directoryTitle');
    body = t('app.onboarding.directoryBody');
    content = (
      <>
        <View style={{ gap: space[2] }}>
          <Button
            label={cv ? cv.name : t('app.onboarding.cvUpload')}
            variant="outline"
            icon={cv ? <FileText size={16} color={colors.foreground} /> : <Paperclip size={16} color={colors.foreground} />}
            onPress={async () => {
              setErrors((current) => ({ ...current, cv: '' }));
              const picked = await pickCv().catch(() => null);
              if (!picked) return;
              if ('problem' in picked) setErrors((current) => ({ ...current, cv: t(`validation.${picked.problem}`) }));
              else setCv(picked.cv);
            }}
          />
          <Text variant="caption" tone={errors.cv ? 'destructive' : 'mutedForeground'}>
            {errors.cv || t.markup('app.onboarding.cvHint', markupTags)}
          </Text>
        </View>

        <Field label={t('app.onboarding.unitsLabel')} hint={t('common.optional')}>
          <TextField
            value={units}
            onChangeText={(value) => setUnits(value.replace(/[^\d]/g, ''))}
            accessibilityLabel={t('app.onboarding.unitsLabel')}
            ltr
            keyboardType="number-pad"
            maxLength={5}
          />
        </Field>

        {/* The account's own answers: not asked again of a profile that exists. */}
        {existing ? null : (
          <>
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
        <Field ref={inView.place('whatsapp')} label={t('onboarding.whatsapp')} hint={t('app.onboarding.whatsappHint')} error={errors.whatsapp}>
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
            onBlur={() => checkOnLeave('whatsapp', whatsapp)}
          />
        </Field>

        {/* Who sees a consultant's card in the directory: asked, with nothing
            chosen for them — the website's question (migration 336). */}
        <StepSection title={t('onboarding.visibilityQuestion')} hint={t('onboarding.visibilityHint')}>
          <View ref={inView.place('visibility')} style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.visibilityQuestion')}>
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
        </StepSection>
          </>
        )}

        <View
          style={{
            ...corner('xl'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <SwitchRow title={t('app.onboarding.openTitle')} hint={t('app.onboarding.openHint')} value={openToOffers} onChange={setOpenToOffers} />
          <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border, marginStart: space[4] }} />
          <SwitchRow title={t('app.onboarding.alertTitle')} hint={t('app.onboarding.alertHint')} value={alert} onChange={setAlert} />
        </View>

        {existing ? null : (
          <>
        {/* Each language in its own name: this picks the language of the emails. */}
        <Field label={t('onboarding.locale')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.locale')} style={{ flexDirection: 'row', gap: space[2] }}>
            <Chip radio label={t('app.onboarding.localeAr')} selected={profileLocale === 'ar'} onPress={() => setProfileLocale('ar')} />
            <Chip radio label={t('app.onboarding.localeEn')} selected={profileLocale === 'en'} onPress={() => setProfileLocale('en')} />
          </View>
        </Field>

        <ConsentCheck ref={inView.place('terms')} agreed={agreed} onChange={setAgreed} error={errors.terms} />
          </>
        )}
      </>
    );
    action = (
      <Button label={existing ? t('app.onboarding.setupSubmit') : t('app.onboarding.directorySubmit')} size="lg" loading={pending} onPress={finishAsCandidate} />
    );
    if (existing) skip = { label: t('app.onboarding.skip'), onPress: () => void onDone() };
    footnote = (
      <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
        {t('app.onboarding.editLater')}
      </Text>
    );
  }

  if (step === 'company') {
    title = t('app.onboarding.companyTitle');
    body = t('app.onboarding.companyBody');
    content = (
      <>
        <Field ref={inView.place('company')} label={t('app.onboarding.companyNameAr')} error={errors.company}>
          <TextField
            value={companyName}
            onChangeText={setCompanyName}
            accessibilityLabel={t('app.onboarding.companyNameAr')}
            autoComplete="organization"
            textContentType="organizationName"
            maxLength={160}
          />
        </Field>
        <Field label={t('app.onboarding.companyNameEn')} hint={t('app.onboarding.companyNameEnHint')}>
          <TextField value={companyNameEn} onChangeText={setCompanyNameEn} accessibilityLabel={t('app.onboarding.companyNameEn')} ltr autoCapitalize="words" maxLength={160} />
        </Field>
        <StepSection title={t('companies.companyType')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('companies.companyType')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {COMPANY_TYPES.map((value) => (
              <Chip key={value} radio label={t(`companyType.${value}`)} selected={companyType === value} onPress={() => setCompanyType(value)} />
            ))}
          </View>
        </StepSection>
        <Field label={t('onboarding.companyDistrict')} hint={t('common.optional')}>
          <Select
            label={t('onboarding.companyDistrict')}
            value={districtId}
            placeholder={t('common.optional')}
            options={districtRows.map((row) => ({ value: row.id, label: localized(locale, row.name_ar, row.name_en) }))}
            onChange={setDistrictId}
          />
        </Field>
        <Field ref={inView.place('companyWebsite')} label={t('app.onboarding.companyWebsite')} hint={t('common.optional')} error={errors.companyWebsite}>
          <TextField
            value={companyWebsite}
            onChangeText={setCompanyWebsite}
            accessibilityLabel={t('app.onboarding.companyWebsite')}
            ltr
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="URL"
            placeholder="https://"
            maxLength={200}
            onBlur={() => checkOnLeave('companyWebsite', companyWebsite)}
          />
        </Field>

        <StepSection title={t('app.onboarding.youTitle')} hint={t('app.onboarding.youHint')}>
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
              onBlur={() => checkOnLeave('whatsapp', whatsapp)}
            />
          </Field>
        </StepSection>

        <Field label={t('onboarding.locale')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.locale')} style={{ flexDirection: 'row', gap: space[2] }}>
            <Chip radio label={t('app.onboarding.localeAr')} selected={profileLocale === 'ar'} onPress={() => setProfileLocale('ar')} />
            <Chip radio label={t('app.onboarding.localeEn')} selected={profileLocale === 'en'} onPress={() => setProfileLocale('en')} />
          </View>
        </Field>

        <Text variant="caption" tone="mutedForeground">
          {t('onboarding.companyReviewNote')}
        </Text>
        <ConsentCheck ref={inView.place('terms')} agreed={agreed} onChange={setAgreed} error={errors.terms} />
      </>
    );
    action = <Button label={t('app.onboarding.companyNext')} size="lg" loading={pending} onPress={createCompany} />;
  }

  if (step === 'verify') {
    title = t('app.onboarding.verifyTitle');
    body = t('app.onboarding.verifyBody');
    content = <CompanyPapers />;
    action = <Button label={t('app.onboarding.verifyNext')} size="lg" onPress={onward} />;
    skip = { label: t('app.onboarding.later'), onPress: onward };
  }

  if (step === 'ready') {
    title = t('app.onboarding.readyTitle', { company: companyName.trim() });
    body = t('app.onboarding.readyBody');
    content = <CompanyReady />;
    action = <Button label={t('app.onboarding.readyListing')} size="lg" onPress={() => void onDone('/employer/jobs/new')} />;
    footnote = <Button label={t('app.onboarding.readyDashboard')} variant="ghost" onPress={() => void onDone()} />;
  }

  return (
    <StepFrame
      scrollRef={scroll}
      stepKey={step}
      arriving={arriving}
      position={position}
      eyebrow={eyebrow}
      title={title}
      body={body}
      // Once the account is made, its own step is behind the person: the
      // company's papers go back no further than themselves.
      onBack={index > 0 && !(created && steps[index - 1] === 'company') ? back : undefined}
      skip={skip}
      busy={pending}
      action={action}
      footnote={footnote}
    >
      {/* Arrived from the confirmation email: said on the first step, whichever it is. */}
      {index === 0 && intent.confirmed ? (
        <Notice tone="success" title={t('onboarding.confirmedBanner')} icon={<MailCheck size={16} color={colors.success} />} />
      ) : null}
      {content}
      {errors.form ? <Notice tone="destructive" announce={false}>{errors.form}</Notice> : null}
      {/* The website's way out of onboarding, where it starts: sign out, or —
          for an account that never got past its email address — go
          without agreeing to anything first. */}
      {index === 0 && !created && !existing ? (
        <View style={{ gap: space[1], alignItems: 'stretch' }}>
          <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {t('onboarding.leaveQuestion')}
          </Text>
          <Button label={t('nav.signOut')} variant="ghost" loading={signingOut} disabled={pending} onPress={signOut} />
          <Button label={t('onboarding.leaveDelete')} variant="ghost" disabled={pending} onPress={confirmDelete} />
        </View>
      ) : null}
    </StepFrame>
  );
}

/** One yes-or-no with what it means under it, the switch at the end. */
function SwitchRow({ title, hint, value, onChange }: { title: string; hint: string; value: boolean; onChange: (value: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], minHeight: 64 }}>
      <View style={{ flex: 1, gap: space[0.5] }}>
        <Text weight="medium">{title}</Text>
        <Text variant="caption" tone="mutedForeground">
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          haptic.selection();
          onChange(next);
        }}
        accessibilityLabel={title}
        accessibilityHint={hint}
        trackColor={{ true: colors.primary, false: colors.input }}
      />
    </View>
  );
}

/** The company's papers, from the company just made — the company page's own panel. */
function CompanyPapers() {
  const t = useTranslations();
  const { viewer } = useSession();
  const page = useCompanyPage();
  const company = viewer?.company ?? null;
  if (!company || page.isPending) return <LoadingState />;
  return (
    <View style={{ gap: space[4] }}>
      <VerificationPanel companyId={company.id} status={company.verification_status} documents={page.data?.documents ?? []} />
      <Text variant="caption" tone="mutedForeground">
        {t('app.onboarding.docsPrivate')}
      </Text>
    </View>
  );
}

/** What is done and what is next: the company, its papers, its first listing — its logo and a colleague, as on the company page. */
function CompanyReady() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { viewer } = useSession();
  const page = useCompanyPage();
  const company = viewer?.company ?? null;
  if (!company) return <LoadingState />;
  const sent = (page.data?.documents ?? []).length > 0;
  const verified = company.verification_status === 'verified';
  const rows = [
    { key: 'company', done: true, title: t('app.onboarding.stepCompany'), hint: localized(locale, company.name_ar, company.name_en) },
    {
      key: 'verify',
      done: verified,
      title: t('app.onboarding.stepVerify'),
      hint: verified ? t('companies.verified') : sent ? t('app.onboarding.verifyInReview') : t('app.onboarding.verifyNotSent'),
    },
    { key: 'listing', done: false, title: t('app.onboarding.stepListing'), hint: t('app.onboarding.stepListingHint') },
  ];
  return (
    <View style={{ gap: space[5] }}>
      <View style={{ ...corner('xl'), borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, backgroundColor: colors.card }}>
        {rows.map((row, index) => (
          <View
            key={row.key}
            accessible
            accessibilityLabel={`${row.title}. ${row.hint}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              padding: space[4],
              borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
              borderTopColor: colors.border,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                ...corner('full'),
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: row.done ? colors.successMuted : row.key === 'verify' && sent ? colors.warningMuted : colors.secondary,
              }}
            >
              {row.done ? (
                <Check size={16} color={colors.success} />
              ) : row.key === 'verify' ? (
                <CircleDashed size={16} color={sent ? colors.warning : colors.primary} />
              ) : (
                <Text variant="small" weight="semibold" tone="primary" style={NUM_STYLE}>
                  {formatNumber(index + 1, locale)}
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{row.title}</Text>
              <Text variant="caption" tone="mutedForeground">
                {row.hint}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <LogoControls companyId={company.id} companyName={company.name_ar} companySlug={company.slug} logoUrl={company.logo_url} />

      {page.data ? <TeamSettings members={page.data.team} canManage /> : null}

      <View style={{ flexDirection: 'row', gap: space[2], padding: space[3], ...corner('lg'), backgroundColor: colors.accent }}>
        <Building2 size={16} color={colors.accentForeground} />
        <Text variant="caption" style={{ flex: 1, color: colors.accentForeground }}>
          {t('app.onboarding.plansNote')}
        </Text>
      </View>
    </View>
  );
}

