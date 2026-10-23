'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Eye, EyeOff, FileText, ShieldCheck, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { localized } from '@/i18n/routing';
import { SubmitButton } from '@/components/ui/submit-button';
import { Button } from '@/components/ui/button';
import { Field, fieldMessageId, Input, Select, Textarea } from '@/components/ui/field';
import { cn, uuid } from '@/lib/utils';
import { fileExtension, fileType } from '@/lib/file-type';
import { createClient } from '@/lib/supabase/client';
import { CV_BUCKET } from '@/lib/buckets';
import { releaseUnusedCv } from '@/lib/cv-in-use';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import { saveAgentProfile } from '@/lib/actions/agent-profile';
import { reach } from '@/lib/reach';
import type {
  AgentProfileRow,
  AgentVisibility,
  DeveloperRow,
  DistrictRow,
  ProfileRow,
} from '@/lib/supabase/database.types';
import { useSessionRecovery } from '@/lib/session-expired';
import { useUploadFailure } from '@/lib/use-upload-failure';
import { draftBase, draftKey } from '@/lib/form-draft';
import { useFormDraft } from '@/lib/use-form-draft';
import { DraftNotice } from '@/components/ui/draft-notice';

const MAX_CV_BYTES = 10 * 1024 * 1024;
const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const VISIBILITY_ICON: Record<AgentVisibility, React.ReactNode> = {
  public: <Eye className="size-4" aria-hidden />,
  verified_employers_only: <ShieldCheck className="size-4" aria-hidden />,
  hidden: <EyeOff className="size-4" aria-hidden />,
};

const VISIBILITIES: AgentVisibility[] = ['public', 'verified_employers_only', 'hidden'];

/** What is typed into the form's fields, as the draft keeps it. */
type Fields = {
  fullName: string;
  whatsapp: string;
  headlineAr: string;
  headlineEn: string;
  yearsExperience: string;
  availability: string;
};

/** Everything the form would lose, kept as one draft (lib/use-form-draft.ts). Never the CV: a file is not kept. */
type Kept = {
  fields: Fields;
  tracks: string[];
  districtIds: number[];
  developerIds: number[];
  languages: string[];
  visibility: AgentVisibility;
};

export function AgentProfileForm({
  locale,
  profile,
  agent,
  districts,
  developers,
  selectedDeveloperIds,
}: {
  locale: string;
  profile: ProfileRow;
  agent: AgentProfileRow | null;
  districts: DistrictRow[];
  developers: DeveloperRow[];
  selectedDeveloperIds: number[];
}) {
  const t = useTranslations('dashboard');
  const tAgents = useTranslations('agents');
  const tOnboarding = useTranslations('onboarding');
  const tVisibility = useTranslations('visibility');
  const tAvailability = useTranslations('availability');
  const tTrack = useTranslations('track');
  const tLanguage = useTranslations('language');
  const tFilters = useTranslations('filters');
  const tCommon = useTranslations('common');
  const tValidation = useTranslations('validation');

  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  // What the server holds, as the form shows it: the opening values, and,
  // refreshed after each save, the record a draft was typed over.
  const held = useMemo<Kept>(
    () => ({
      fields: {
        fullName: profile.full_name ?? '',
        whatsapp: profile.whatsapp_phone ?? '',
        headlineAr: agent?.headline_ar ?? '',
        headlineEn: agent?.headline_en ?? '',
        yearsExperience: String(agent?.years_experience ?? 0),
        availability: agent?.availability ?? 'open_to_offers',
      },
      tracks: agent?.tracks ?? [],
      districtIds: agent?.district_ids ?? [],
      developerIds: selectedDeveloperIds,
      languages: agent?.languages ?? ['ar'],
      visibility: agent?.visibility ?? 'verified_employers_only',
    }),
    [profile, agent, selectedDeveloperIds],
  );
  const [fields, setFields] = useState<Fields>(held.fields);
  const setField = (key: keyof Fields) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));
  const [tracks, setTracks] = useState<string[]>(held.tracks);
  const [districtIds, setDistrictIds] = useState<number[]>(held.districtIds);
  const [developerIds, setDeveloperIds] = useState<number[]>(held.developerIds);
  const [languages, setLanguages] = useState<string[]>(held.languages);
  const [visibility, setVisibility] = useState<AgentVisibility>(held.visibility);
  const visibilityRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const kept = useMemo<Kept>(
    () => ({ fields, tracks, districtIds, developerIds, languages, visibility }),
    [fields, tracks, districtIds, developerIds, languages, visibility],
  );
  const restoreDraft = useCallback((held: Kept) => {
    setFields((current) => ({ ...current, ...held.fields }));
    setTracks(held.tracks);
    setDistrictIds(held.districtIds);
    setDeveloperIds(held.developerIds);
    setLanguages(held.languages);
    setVisibility(VISIBILITIES.includes(held.visibility) ? held.visibility : 'verified_employers_only');
  }, []);
  // The profile has no version column: what the fields were filled from
  // stands in for one (draftBase), so a draft typed before a save made in the
  // app is offered over it rather than poured in. A refresh brings the newest
  // row but leaves the fields as they are, so it is taken over only after
  // this form's own save.
  const [filledFrom, setFilledFrom] = useState(() => draftBase(held));
  const [ownSave, setOwnSave] = useState(false);
  if (ownSave && draftBase(held) !== filledFrom) {
    setFilledFrom(draftBase(held));
    setOwnSave(false);
  }
  const draft = useFormDraft({
    key: draftKey('agent-profile', profile.id),
    values: kept,
    restore: restoreDraft,
    base: filledFrom,
  });

  /*
    One choice of three, so a radio group: one stop in the tab order, and the
    arrows move the choice, as the footer's theme switch does. These were
    toggle buttons, announced as three switches that could each be on. Under
    RTL the left arrow is the next option, because that is where it sits.
  */
  function onVisibilityKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const backward = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (!forward && !backward) return;

    event.preventDefault();
    const next = (index + (forward ? 1 : -1) + VISIBILITIES.length) % VISIBILITIES.length;
    setVisibility(VISIBILITIES[next]);
    visibilityRefs.current[next]?.focus();
  }

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();
  const explainUpload = useUploadFailure();

  /*
    The CV on file, and whether this save takes it down.

    The form used to show a bare file picker with no word about whether a CV
    was already there, and it never cleared the picker after a save — so
    editing a headline re-uploaded the same file and repointed the row at a
    fresh copy, every time. Now the current file is named, removing it is a
    choice, and the picker is emptied once its file has been saved.
  */
  const [hasCv, setHasCv] = useState(Boolean(agent?.cv_path));
  const [removeCv, setRemoveCv] = useState(false);
  const [pickedCv, setPickedCv] = useState<string | null>(null);

  function toggle<T>(list: T[], value: T, setter: (next: T[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function onPickCv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setErrors((current) => ({ ...current, cv: '' }));
    if (!file) {
      setPickedCv(null);
      return;
    }
    if (file.size > MAX_CV_BYTES) {
      setErrors((current) => ({ ...current, cv: tValidation('fileTooLarge') }));
      event.target.value = '';
      setPickedCv(null);
      return;
    }
    // Through fileType(): the browser's guess when it makes one, the extension
    // when it does not — a .docx from a device with no Office is still a CV.
    if (!CV_TYPES.includes(fileType(file))) {
      setErrors((current) => ({ ...current, cv: tValidation('fileType') }));
      event.target.value = '';
      setPickedCv(null);
      return;
    }
    setPickedCv(file.name);
    setRemoveCv(false);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    // Written now, not after the pause: the answer may be a sign-in page.
    draft.flush();

    startTransition(async () => {
      let cvPath: string | null = null;
      const file = fileRef.current?.files?.[0];

      if (file) {
        const path = `${profile.id}/${uuid()}.${fileExtension(file, 'pdf')}`;
        const { error } = await createClient()
          .storage.from(CV_BUCKET)
          .upload(path, file, { contentType: fileType(file) });

        if (error) {
          const message = await explainUpload(error);
          if (message) setErrors({ cv: message });
          return;
        }
        cvPath = path;
      }

      const result = await reach(saveAgentProfile({
        fullName: fields.fullName,
        whatsapp: fields.whatsapp,
        headlineAr: fields.headlineAr,
        headlineEn: fields.headlineEn,
        yearsExperience: fields.yearsExperience || '0',
        tracks,
        districtIds,
        developerIds,
        languages,
        availability: fields.availability || 'open_to_offers',
        visibility,
        cvPath,
        removeCv,
      }));

      if (!result.ok) {
        /*
          Take the file back out.

          The CV is uploaded before the profile is saved, because the action
          wants a path rather than bytes — so every refusal after this point
          left a file in the private bucket with nothing pointing at it, and
          each retry left another. Storage RLS confines this account to its own
          folder, which is the same rule that allowed the upload.
        */
        // Not when the answer was lost: the save may still be running on the
        // server — it checks the file first and writes the profile after — so
        // nothing points at the file yet when this looks. The apply form keeps
        // the file the same way; an orphan is cleared by storage clean-up.
        if (cvPath && result.error !== 'network') {
          // Unless the profile went in with it after all — the row is written
          // before the developer tags, and an answer can be lost on the way
          // back — when this took the file out from under the saved profile.
          const supabase = createClient();
          await releaseUnusedCv(
            {
              profileCv: () => supabase.from('agent_profiles').select('cv_path').eq('cv_path', cvPath).maybeSingle(),
              applicationsWith: (path) => supabase.from('applications').select('id').eq('cv_path', path).limit(1),
            },
            (path) => supabase.storage.from(CV_BUCKET).remove([path]),
            cvPath,
          );
        }
        if (recoverSession(result)) return;
        // The server names a refused CV by its key — 'fileType': the bytes are
        // no PDF or Word document, whatever the name says — and the field
        // showed the key itself, in Latin letters under an Arabic form.
        setErrors(
          result.fieldErrors
            ? { ...result.fieldErrors, ...(result.fieldErrors.cv ? { cv: tValidation('fileType') } : {}) }
            : { form: tCommon('errorBody') },
        );
        return;
      }

      // Saved: the server holds it now, so this browser need not; and what
      // the refresh brings is this save.
      draft.clear();
      setOwnSave(true);
      setErrors({});
      setSaved(true);
      // The picker has done its job; a second save must not upload the same
      // file again.
      if (fileRef.current) fileRef.current.value = '';
      setPickedCv(null);
      setHasCv(Boolean(cvPath) || (hasCv && !removeCv));
      setRemoveCv(false);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <DraftNotice draft={draft} />
      {/* Name and number side by side. Each is a short value, and stacked at
          the form's full width they were two 800px inputs holding twelve
          characters apiece. */}
      <section className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field
          label={tOnboarding('fullName')}
          htmlFor="fullName"
          error={errors.fullName ? tValidation('required') : undefined}
        >
          <Input
            id="fullName"
            name="fullName"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            value={fields.fullName}
            onChange={setField('fullName')}
          />
        </Field>

        <Field
          label={tOnboarding('whatsapp')}
          htmlFor="whatsapp"
          error={errors.whatsapp ? tValidation('invalidPhone') : undefined}
        >
          <Input
            id="whatsapp"
            name="whatsapp"
            type="tel"
            required
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            className="numeral-field"
            value={fields.whatsapp}
            onChange={setField('whatsapp')}
          />
        </Field>
      </section>

      <section className="space-y-4 border-t border-border pt-6">
        <div>
          <h2 className="text-base font-semibold">{t('agentProfile')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('agentProfileHint')}</p>
        </div>

        {/* Visibility comes first, before anything is filled in — the reader
            needs to know who will see this before they write it. */}
        <fieldset role="radiogroup">
          <legend className="mb-2 text-sm font-medium">{tAgents('whoSeesProfile')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {VISIBILITIES.map((value, index) => (
              <button
                key={value}
                ref={(node) => {
                  visibilityRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={visibility === value}
                tabIndex={visibility === value ? 0 : -1}
                onClick={() => setVisibility(value)}
                onKeyDown={(event) => onVisibilityKey(event, index)}
                className={cn(
                  'rounded-lg border p-3 text-start transition-colors',
                  visibility === value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'inline-flex',
                    visibility === value ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {VISIBILITY_ICON[value]}
                </span>
                <span className="mt-1.5 block text-sm font-medium">{tVisibility(value)}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {tVisibility(
                    value === 'public'
                      ? 'publicHint'
                      : value === 'hidden'
                        ? 'hiddenHint'
                        : 'verifiedHint',
                  )}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field label={tAgents('availability')} htmlFor="availability">
            <Select
              id="availability"
              name="availability"
              value={fields.availability}
              onChange={setField('availability')}
            >
              {AVAILABILITIES.map((value) => (
                <option key={value} value={value}>
                  {tAvailability(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tFilters('experienceBand')} htmlFor="yearsExperience">
            <Input
              id="yearsExperience"
              name="yearsExperience"
              type="number"
              // A whole number: the digit pad, where a bare type="number"
              // gets iOS's punctuation keyboard with the digits along its top.
              inputMode="numeric"
              min={0}
              max={60}
              className="numeral-field sm:w-28"
              value={fields.yearsExperience}
              onChange={setField('yearsExperience')}
            />
          </Field>
        </div>

        <Field label={tAgents('headlineAr')} htmlFor="headlineAr">
          <Textarea
            id="headlineAr"
            name="headlineAr"
            rows={2}
            maxLength={160}
            value={fields.headlineAr}
            onChange={setField('headlineAr')}
          />
        </Field>

        <Field label={tAgents('headlineEn')} htmlFor="headlineEn">
          <Textarea
            id="headlineEn"
            name="headlineEn"
            rows={2}
            maxLength={160}
            dir="ltr"
            value={fields.headlineEn}
            onChange={setField('headlineEn')}
          />
        </Field>


        <CheckboxGroup
          legend={tAgents('tracks')}
          options={JOB_TRACKS.map((track) => ({ value: track, label: tTrack(track) }))}
          selected={tracks}
          onToggle={(value) => toggle(tracks, value, setTracks)}
        />

        <CheckboxGroup
          legend={tAgents('districts')}
          scroll
          options={districts.map((district) => ({
            value: String(district.id),
            label: localized(locale, district.name_ar, district.name_en),
          }))}
          selected={districtIds.map(String)}
          onToggle={(value) => toggle(districtIds, Number(value), setDistrictIds)}
        />

        <CheckboxGroup
          legend={tAgents('soldFor')}
          scroll
          options={developers.map((developer) => ({
            value: String(developer.id),
            label: localized(locale, developer.name_ar, developer.name_en),
          }))}
          selected={developerIds.map(String)}
          onToggle={(value) => toggle(developerIds, Number(value), setDeveloperIds)}
        />

        <CheckboxGroup
          legend={tAgents('languages')}
          options={[
            // Named from the same catalogue the public badge reads, so what
            // somebody ticks here is the word a reader sees there.
            { value: 'ar', label: tLanguage('ar') },
            { value: 'en', label: tLanguage('en') },
            { value: 'fr', label: tLanguage('fr') },
          ]}
          selected={languages}
          onToggle={(value) => toggle(languages, value, setLanguages)}
        />

        <Field
          label={hasCv && !removeCv ? tAgents('cvReplace') : tAgents('cvUpload')}
          hint={tAgents('cvHint')}
          error={errors.cv || undefined}
          htmlFor="cv"
        >
          {/* What is on file now, and the way to take it down. Not a link:
              the owner has the file, and a signed URL rendered into a form
              would outlive the page. */}
          {hasCv ? (
            <p
              className={cn(
                'mb-2 flex flex-wrap items-center gap-2 text-sm',
                removeCv && 'text-muted-foreground line-through',
              )}
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {tAgents('cvCurrent')}
              {removeCv ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ms-auto text-destructive hover:text-destructive"
                  onClick={() => setRemoveCv(true)}
                >
                  <Trash2 aria-hidden />
                  {tAgents('cvRemove')}
                </Button>
              )}
            </p>
          ) : (
            <p className="mb-2 text-sm text-muted-foreground">{tAgents('cvNone')}</p>
          )}
          {/* Not one of Field's own controls, so it reads the hint's or the
              error's id itself, as Field's Input would. */}
          <input
            ref={fileRef}
            id="cv"
            type="file"
            accept=".pdf,.doc,.docx"
            aria-describedby={fieldMessageId('cv', { hint: tAgents('cvHint'), error: errors.cv })}
            aria-invalid={errors.cv ? true : undefined}
            onChange={onPickCv}
            className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium"
          />
          {pickedCv ? <p className="mt-1 text-xs text-muted-foreground">{pickedCv}</p> : null}
        </Field>
      </section>

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton size="lg" disabled={pending}>
          {pending ? tCommon('loading') : tCommon('save')}
        </SubmitButton>
        {saved ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            {tCommon('saveSuccess')}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function CheckboxGroup({
  legend,
  options,
  selected,
  onToggle,
  scroll,
}: {
  legend: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  scroll?: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div
        className={cn(
          'flex flex-wrap gap-2',
          scroll && 'max-h-56 overflow-y-auto rounded-lg border border-border p-3',
        )}
      >
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              aria-pressed={active}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:bg-muted',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
