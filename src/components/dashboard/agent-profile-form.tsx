'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Eye, EyeOff, FileText, ShieldCheck, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { localized } from '@/i18n/routing';
import { SubmitButton } from '@/components/ui/submit-button';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { cn, uuid } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { CV_BUCKET } from '@/lib/buckets';
import { safeExtension } from '@/lib/storage-path';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import { saveAgentProfile } from '@/lib/actions/agent-profile';

const MAX_CV_BYTES = 10 * 1024 * 1024;
const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const CV_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
import type {
  AgentProfileRow,
  AgentVisibility,
  DeveloperRow,
  DistrictRow,
  ProfileRow,
} from '@/lib/supabase/database.types';
import { useSessionRecovery } from '@/lib/session-expired';

const VISIBILITY_ICON: Record<AgentVisibility, React.ReactNode> = {
  public: <Eye className="size-4" aria-hidden />,
  verified_employers_only: <ShieldCheck className="size-4" aria-hidden />,
  hidden: <EyeOff className="size-4" aria-hidden />,
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

  const [tracks, setTracks] = useState<string[]>(agent?.tracks ?? []);
  const [districtIds, setDistrictIds] = useState<number[]>(agent?.district_ids ?? []);
  const [developerIds, setDeveloperIds] = useState<number[]>(selectedDeveloperIds);
  const [languages, setLanguages] = useState<string[]>(agent?.languages ?? ['ar']);
  const [visibility, setVisibility] = useState<AgentVisibility>(
    agent?.visibility ?? 'verified_employers_only',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

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
    if (!CV_TYPES.includes(file.type)) {
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
    const form = new FormData(event.currentTarget);
    setSaved(false);

    startTransition(async () => {
      let cvPath: string | null = null;
      const file = fileRef.current?.files?.[0];

      if (file) {
        const extension = CV_EXTENSIONS[file.type] ?? safeExtension(file.name, 'pdf');
        const path = `${profile.id}/${uuid()}.${extension}`;
        const { error } = await createClient()
          .storage.from(CV_BUCKET)
          .upload(path, file, { contentType: file.type });

        if (error) {
          setErrors({ cv: tCommon('errorBody') });
          return;
        }
        cvPath = path;
      }

      const result = await saveAgentProfile({
        fullName: String(form.get('fullName') ?? ''),
        whatsapp: String(form.get('whatsapp') ?? ''),
        headlineAr: String(form.get('headlineAr') ?? ''),
        headlineEn: String(form.get('headlineEn') ?? ''),
        yearsExperience: String(form.get('yearsExperience') ?? '0'),
        tracks,
        districtIds,
        developerIds,
        languages,
        availability: String(form.get('availability') ?? 'open_to_offers'),
        visibility,
        cvPath,
        removeCv,
      });

      if (!result.ok) {
        /*
          Take the file back out.

          The CV is uploaded before the profile is saved, because the action
          wants a path rather than bytes — so every refusal after this point
          left a file in the private bucket with nothing pointing at it, and
          each retry left another. Storage RLS confines this account to its own
          folder, which is the same rule that allowed the upload.
        */
        if (cvPath) await createClient().storage.from(CV_BUCKET).remove([cvPath]);
        if (recoverSession(result)) return;
        setErrors(result.fieldErrors ?? { form: tCommon('errorBody') });
        return;
      }

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
            defaultValue={profile.full_name}
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
            className="numeral-field"
            defaultValue={profile.whatsapp_phone}
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
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{tAgents('whoSeesProfile')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['public', 'verified_employers_only', 'hidden'] as AgentVisibility[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setVisibility(value)}
                aria-pressed={visibility === value}
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
              defaultValue={agent?.availability ?? 'open_to_offers'}
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
              min={0}
              max={60}
              className="numeral-field sm:w-28"
              defaultValue={agent?.years_experience ?? 0}
            />
          </Field>
        </div>

        <Field label={tAgents('headlineAr')} htmlFor="headlineAr">
          <Textarea
            id="headlineAr"
            name="headlineAr"
            rows={2}
            maxLength={160}
            defaultValue={agent?.headline_ar ?? ''}
          />
        </Field>

        <Field label={tAgents('headlineEn')} htmlFor="headlineEn">
          <Textarea
            id="headlineEn"
            name="headlineEn"
            rows={2}
            maxLength={160}
            dir="ltr"
            defaultValue={agent?.headline_en ?? ''}
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
          label={hasCv && !removeCv ? tAgents('cvReplace') : tAgents('downloadCv')}
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
          <input
            ref={fileRef}
            id="cv"
            type="file"
            accept=".pdf,.doc,.docx"
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
