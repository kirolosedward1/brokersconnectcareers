import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { X } from '~/components/ui/lucide';
import type {
  AgentCertificationRow,
  AgentEducationRow,
  AgentExperienceRow,
  JobTrack,
} from '@/lib/supabase/database.types';
import { JOB_TRACKS } from '@/lib/taxonomy';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { KeyboardRoom } from '~/components/ui/keyboard-room';
import { Notice } from '~/components/ui/notice';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { SaveRefused, useSaveCvEntry, type CvSection } from '~/features/profile/queries';
import { ApiError } from '~/lib/api';
import { useErrorsInView } from '~/lib/use-errors-in-view';
import { useConfirmDiscard } from '~/lib/use-leave-guard';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';
import { dateOf, monthOf, wholeNumber } from './fields';

export type CvEntry =
  | { section: 'experience'; row: AgentExperienceRow | null }
  | { section: 'education'; row: AgentEducationRow | null }
  | { section: 'certification'; row: AgentCertificationRow | null };

/**
 * Adding a CV entry, or changing one — the website's inline forms, as a sheet.
 * Each saves on its own: a mistake in a certification never holds a job just
 * typed hostage. Dates are a year and a month, as the entries show them.
 */
export function CvEntrySheet({ agentId, entry, onClose }: { agentId: string; entry: CvEntry | null; onClose: () => void }) {
  // Whether the form has been typed in: the sheet pulled down asks first then.
  const dirty = useRef(false);
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const confirm = useConfirmDiscard();
  const close = () => (dirty.current ? confirm(onClose) : onClose());
  return (
    <Modal visible={entry !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardRoom>
        {/* A fresh form for every entry opened. */}
        {entry ? (
          <EntryForm
            key={`${entry.section}:${entry.row?.id ?? 'new'}`}
            agentId={agentId}
            entry={entry}
            onClose={onClose}
            onRequestClose={close}
            onDirty={onDirty}
          />
        ) : null}
      </KeyboardRoom>
    </Modal>
  );
}

const TITLE: Record<CvSection, { add: string; section: string }> = {
  experience: { add: 'addExperience', section: 'experience' },
  education: { add: 'addEducation', section: 'education' },
  certification: { add: 'addCertification', section: 'certifications' },
};

function EntryForm({
  agentId,
  entry,
  onClose,
  onRequestClose,
  onDirty,
}: {
  agentId: string;
  entry: CvEntry;
  /** Closes the sheet: after a save. */
  onClose: () => void;
  /** Asks first when something was typed: the X, the sheet pulled down. */
  onRequestClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const save = useSaveCvEntry();

  const experience = entry.section === 'experience' ? entry.row : null;
  const education = entry.section === 'education' ? entry.row : null;
  const certification = entry.section === 'certification' ? entry.row : null;

  // Every field any section has; each section shows its own.
  const [companyName, setCompanyName] = useState(experience?.company_name ?? '');
  const [title, setTitle] = useState(experience?.title ?? '');
  const [track, setTrack] = useState<JobTrack | null>(experience?.track ?? null);
  const [started, setStarted] = useState(monthOf(experience?.started));
  const [ended, setEnded] = useState(monthOf(experience?.ended));
  const [highlights, setHighlights] = useState(experience?.highlights ?? '');
  const [institution, setInstitution] = useState(education?.institution ?? '');
  const [degree, setDegree] = useState(education?.degree ?? '');
  const [field, setField] = useState(education?.field ?? '');
  const [graduated, setGraduated] = useState(education?.graduated == null ? '' : String(education.graduated));
  const [name, setName] = useState(certification?.name ?? '');
  const [issuer, setIssuer] = useState(certification?.issuer ?? '');
  const [issued, setIssued] = useState(monthOf(certification?.issued));
  const [expires, setExpires] = useState(monthOf(certification?.expires));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Save is below every field: an error above it is brought into view and said.
  const scroll = useRef<ScrollView>(null);
  const inView = useErrorsInView(scroll, [
    'companyName',
    'title',
    'started',
    'ended',
    'highlights',
    'institution',
    'graduated',
    'name',
    'issued',
    'expires',
  ]);
  const refuse = (next: Record<string, string>) => {
    setErrors(next);
    inView.show(next);
  };

  const typed = JSON.stringify([companyName, title, track, started, ended, highlights, institution, degree, field, graduated, name, issuer, issued, expires]);
  const [opened] = useState(typed);
  useEffect(() => {
    onDirty(typed !== opened);
  }, [onDirty, typed, opened]);

  const required = t('validation.required');
  const badMonth = t('app.profile.monthInvalid');

  const onError = (failure: unknown) => {
    const reason = failure instanceof SaveRefused ? failure.reason : 'failed';
    const fields = failure instanceof SaveRefused ? failure.fieldErrors : undefined;
    if (reason === 'cap') return refuse({ form: t('cv.capReached') });
    // Named, not a computed key, which the React Compiler does not compile.
    if (fields?.ended) return refuse({ ended: t('app.profile.endBeforeStart') });
    if (fields?.expires) return refuse({ expires: t('app.profile.endBeforeStart') });
    refuse({ form: failure instanceof ApiError && failure.status === 0 ? t('app.offline.body') : t('common.errorBody') });
  };
  const done = { onSuccess: onClose, onError };

  const submit = () => {
    const local: Record<string, string> = {};

    if (entry.section === 'experience') {
      const startedOn = dateOf(started, experience?.started);
      const endedOn = dateOf(ended, experience?.ended);
      if (!companyName.trim()) local.companyName = required;
      if (!title.trim()) local.title = required;
      if (startedOn === null) local.started = required;
      else if (startedOn === undefined) local.started = badMonth;
      if (endedOn === undefined) local.ended = badMonth;
      else if (endedOn && startedOn && endedOn < startedOn) local.ended = t('app.profile.endBeforeStart');
      if (Object.keys(local).length) return refuse(local);
      setErrors({});
      return save.mutate(
        {
          section: 'experience',
          input: {
            ...(experience ? { id: experience.id } : {}),
            agentId,
            companyName: companyName.trim(),
            title: title.trim(),
            track,
            started: startedOn as string,
            ended: endedOn ?? null,
            highlights: highlights.trim() || null,
          },
        },
        done,
      );
    }

    if (entry.section === 'education') {
      const year = wholeNumber(graduated);
      if (!institution.trim()) local.institution = required;
      if (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100)) local.graduated = t('app.profile.yearInvalid');
      if (Object.keys(local).length) return refuse(local);
      setErrors({});
      return save.mutate(
        {
          section: 'education',
          input: {
            ...(education ? { id: education.id } : {}),
            agentId,
            institution: institution.trim(),
            degree: degree.trim() || null,
            field: field.trim() || null,
            graduated: year,
          },
        },
        done,
      );
    }

    const issuedOn = dateOf(issued, certification?.issued);
    const expiresOn = dateOf(expires, certification?.expires);
    if (!name.trim()) local.name = required;
    if (issuedOn === undefined) local.issued = badMonth;
    if (expiresOn === undefined) local.expires = badMonth;
    else if (expiresOn && issuedOn && expiresOn < issuedOn) local.expires = t('app.profile.endBeforeStart');
    if (Object.keys(local).length) return refuse(local);
    setErrors({});
    save.mutate(
      {
        section: 'certification',
        input: {
          ...(certification ? { id: certification.id } : {}),
          agentId,
          name: name.trim(),
          issuer: issuer.trim() || null,
          issued: issuedOn ?? null,
          expires: expiresOn ?? null,
        },
      },
      done,
    );
  };

  const month = (label: string, value: string, set: (text: string) => void, key: string, hint?: string) => (
    <Field ref={inView.place(key)} label={label} hint={hint ?? t('app.profile.monthHint')} error={errors[key]}>
      <TextField value={value} onChangeText={set} accessibilityLabel={label} ltr keyboardType="numbers-and-punctuation" placeholder="2024-03" maxLength={7} />
    </Field>
  );
  const text = (label: string, value: string, set: (text: string) => void, key: string, max: number, optional = false) => (
    <Field ref={inView.place(key)} label={label} hint={optional ? t('common.optional') : undefined} error={errors[key]}>
      <TextField value={value} onChangeText={set} accessibilityLabel={label} maxLength={max} />
    </Field>
  );

  const heading = entry.row ? t(`cv.${TITLE[entry.section].section}` as 'cv.experience') : t(`cv.${TITLE[entry.section].add}` as 'cv.addExperience');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter, paddingVertical: space[4], gap: space[3] }}>
        <Text variant="title" weight="bold" accessibilityRole="header" style={{ flex: 1 }}>
          {heading}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onRequestClose}
          // The glyph, not its 44-point box, on the page's margin.
          style={{ width: hitTarget, height: hitTarget, marginEnd: -(hitTarget - 20) / 2, alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={20} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: gutter, paddingTop: 0, paddingBottom: space[10], gap: space[4] }}
      >
        {entry.section === 'experience' ? (
          <>
            {text(t('cv.company'), companyName, setCompanyName, 'companyName', 120)}
            {text(t('cv.jobTitle'), title, setTitle, 'title', 120)}
            <Field label={t('cv.track')} hint={t('common.optional')}>
              <Select
                label={t('cv.track')}
                value={track}
                placeholder="—"
                options={JOB_TRACKS.map((value) => ({ value, label: t(`track.${value}`) }))}
                onChange={setTrack}
              />
            </Field>
            {month(t('cv.started'), started, setStarted, 'started')}
            {month(t('cv.ended'), ended, setEnded, 'ended', t('app.profile.endedHint'))}
            <Field ref={inView.place('highlights')} label={t('cv.highlights')} error={errors.highlights}>
              <TextField
                value={highlights}
                onChangeText={setHighlights}
                accessibilityLabel={t('cv.highlights')}
                multiline
                maxLength={600}
                style={{ minHeight: 64, paddingVertical: space[2], textAlignVertical: 'top' }}
              />
            </Field>
          </>
        ) : entry.section === 'education' ? (
          <>
            {text(t('cv.institution'), institution, setInstitution, 'institution', 160)}
            {text(t('cv.degree'), degree, setDegree, 'degree', 120, true)}
            {text(t('cv.field'), field, setField, 'field', 120, true)}
            <Field ref={inView.place('graduated')} label={t('cv.graduated')} hint={t('common.optional')} error={errors.graduated}>
              <TextField
                value={graduated}
                onChangeText={setGraduated}
                accessibilityLabel={t('cv.graduated')}
                ltr
                keyboardType="number-pad"
                maxLength={4}
              />
            </Field>
          </>
        ) : (
          <>
            {text(t('cv.certName'), name, setName, 'name', 160)}
            {text(t('cv.issuer'), issuer, setIssuer, 'issuer', 160, true)}
            {month(t('cv.issued'), issued, setIssued, 'issued')}
            {month(t('cv.expires'), expires, setExpires, 'expires')}
          </>
        )}

        {errors.form ? <Notice tone="destructive">{errors.form}</Notice> : null}
        <Button label={t('common.save')} size="lg" loading={save.isPending} onPress={submit} />
      </ScrollView>
    </View>
  );
}
