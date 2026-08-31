'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { localized } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import { saveAgentProfile } from '@/lib/actions/agent-profile';
import type {
  AgentProfileRow,
  AgentVisibility,
  DeveloperRow,
  DistrictRow,
  ProfileRow,
} from '@/lib/supabase/database.types';

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

  function toggle<T>(list: T[], value: T, setter: (next: T[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);

    startTransition(async () => {
      let cvPath: string | null = null;
      const file = fileRef.current?.files?.[0];

      if (file) {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? 'pdf';
        const path = `${profile.id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await createClient()
          .storage.from('cvs')
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
      });

      if (!result.ok) {
        setErrors(result.fieldErrors ?? { form: tCommon('errorBody') });
        return;
      }

      setErrors({});
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="space-y-5">
        <Field label={tOnboarding('fullName')} htmlFor="fullName">
          <Input id="fullName" name="fullName" required defaultValue={profile.full_name} />
        </Field>

        <Field
          label={tOnboarding('whatsapp')}
          hint={tOnboarding('whatsappHint')}
          htmlFor="whatsapp"
          error={errors.whatsapp ? tValidation('invalidPhone') : undefined}
        >
          <Input
            id="whatsapp"
            name="whatsapp"
            type="tel"
            required
            dir="ltr"
            className="numeral"
            defaultValue={profile.whatsapp_phone}
          />
        </Field>
      </section>

      <section className="space-y-5 border-t border-border pt-8">
        <div>
          <h2 className="text-lg font-semibold">{t('agentProfile')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('agentProfileHint')}</p>
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

        <Field label="العنوان المهني" htmlFor="headlineAr">
          <Textarea
            id="headlineAr"
            name="headlineAr"
            rows={2}
            maxLength={160}
            defaultValue={agent?.headline_ar ?? ''}
          />
        </Field>

        <Field label="Headline (English)" htmlFor="headlineEn">
          <Textarea
            id="headlineEn"
            name="headlineEn"
            rows={2}
            maxLength={160}
            dir="ltr"
            defaultValue={agent?.headline_en ?? ''}
          />
        </Field>

        <Field label={tFilters('experienceBand')} htmlFor="yearsExperience">
          <Input
            id="yearsExperience"
            name="yearsExperience"
            type="number"
            min={0}
            max={60}
            className="numeral w-28"
            defaultValue={agent?.years_experience ?? 0}
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
            { value: 'ar', label: 'العربية' },
            { value: 'en', label: 'English' },
            { value: 'fr', label: 'Français' },
          ]}
          selected={languages}
          onToggle={(value) => toggle(languages, value, setLanguages)}
        />

        <Field label={tAgents('downloadCv')} error={errors.cv || undefined} htmlFor="cv">
          <input
            ref={fileRef}
            id="cv"
            type="file"
            accept=".pdf,.doc,.docx"
            className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium"
          />
        </Field>
      </section>

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? tCommon('loading') : tCommon('save')}
        </Button>
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
