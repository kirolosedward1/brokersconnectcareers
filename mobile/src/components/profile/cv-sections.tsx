import { useState, type ComponentType } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Award, Briefcase, GraduationCap, Pencil, Plus, Trash2, type LucideProps } from '~/components/ui/lucide';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { isolate } from '~/i18n/rich';
import { useDeleteCvEntry, type CvSection, type CvSections as Sections } from '~/features/profile/queries';
import { useTheme } from '~/theme/provider';
import { hitTarget, radius, space } from '~/theme/tokens';
import { CvEntrySheet, type CvEntry } from './cv-entry-sheet';
import { monthOf } from './fields';

/**
 * The CV sections — work history, education, certifications — the website's
 * CvEditor with editing as well as adding: each entry opens in a sheet, saves
 * on its own, and deleting takes it off at once (put back if refused).
 */
export function CvSections({ agentId, sections }: { agentId: string; sections: Sections }) {
  const t = useTranslations();
  const [open, setOpen] = useState<CvEntry | null>(null);
  const remove = useDeleteCvEntry(agentId);

  const confirmDelete = (section: CvSection, id: string, label: string) =>
    Alert.alert(label, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate({ section, id }) },
    ]);

  // A range of two dates, each isolated left to right, the pair following the sentence.
  const range = (from: string, to: string | null) => `${isolate(monthOf(from))} — ${to ? isolate(monthOf(to)) : t('cv.present')}`;

  return (
    <View style={{ gap: space[4] }}>
      {remove.isError ? <Notice tone="destructive">{t('common.errorBody')}</Notice> : null}

      <Section icon={Briefcase} title={t('cv.experience')} hint={t('cv.experienceHint')}>
        {sections.experience.length ? (
          sections.experience.map((row) => (
            <Row
              key={row.id}
              primary={`${row.title} · ${row.company_name}`}
              secondary={row.track ? t(`track.${row.track}`) : null}
              meta={range(row.started, row.ended)}
              onEdit={() => setOpen({ section: 'experience', row })}
              onDelete={() => confirmDelete('experience', row.id, `${row.title} · ${row.company_name}`)}
            />
          ))
        ) : (
          <Empty text={t('cv.experienceEmpty')} />
        )}
        <Add label={t('cv.addExperience')} onPress={() => setOpen({ section: 'experience', row: null })} />
      </Section>

      <Section icon={GraduationCap} title={t('cv.education')}>
        {sections.education.length ? (
          sections.education.map((row) => (
            <Row
              key={row.id}
              primary={row.institution}
              secondary={[row.degree, row.field].filter(Boolean).join(' · ') || null}
              meta={row.graduated ? isolate(String(row.graduated)) : null}
              onEdit={() => setOpen({ section: 'education', row })}
              onDelete={() => confirmDelete('education', row.id, row.institution)}
            />
          ))
        ) : (
          <Empty text={t('cv.educationEmpty')} />
        )}
        <Add label={t('cv.addEducation')} onPress={() => setOpen({ section: 'education', row: null })} />
      </Section>

      <Section icon={Award} title={t('cv.certifications')}>
        {sections.certifications.length ? (
          sections.certifications.map((row) => (
            <Row
              key={row.id}
              primary={row.name}
              secondary={row.issuer}
              meta={row.issued ? isolate(monthOf(row.issued)) : null}
              onEdit={() => setOpen({ section: 'certification', row })}
              onDelete={() => confirmDelete('certification', row.id, row.name)}
            />
          ))
        ) : (
          <Empty text={t('cv.certificationsEmpty')} />
        )}
        <Add label={t('cv.addCertification')} onPress={() => setOpen({ section: 'certification', row: null })} />
      </Section>

      <CvEntrySheet agentId={agentId} entry={open} onClose={() => setOpen(null)} />
    </View>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.xl,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.muted,
          }}
        >
          <Icon size={20} color={colors.mutedForeground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text weight="semibold" accessibilityRole="header">
            {title}
          </Text>
          {hint ? (
            <Text variant="small" tone="mutedForeground">
              {hint}
            </Text>
          ) : null}
        </View>
      </View>
      {children}
    </Card>
  );
}

function Row({
  primary,
  secondary,
  meta,
  onEdit,
  onDelete,
}: {
  primary: string;
  secondary?: string | null;
  meta?: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const icon = { width: hitTarget, height: hitTarget, alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[1],
        paddingStart: space[3],
        paddingVertical: space[1],
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flex: 1, paddingVertical: space[2], gap: 2 }}>
        <Text weight="medium">{primary}</Text>
        {secondary ? (
          <Text variant="small" tone="mutedForeground">
            {secondary}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="caption" tone="mutedForeground">
            {meta}
          </Text>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('app.profile.edit')}: ${primary}`} onPress={onEdit} style={icon}>
        <Pencil size={16} color={colors.mutedForeground} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.delete')}: ${primary}`} onPress={onDelete} style={icon}>
        <Trash2 size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Text variant="small" tone="mutedForeground">
      {text}
    </Text>
  );
}

function Add({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Button label={label} variant="outline" size="sm" icon={<Plus size={14} color={colors.foreground} />} onPress={onPress} />
    </View>
  );
}
