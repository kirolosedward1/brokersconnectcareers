import { useState } from 'react';
import { ActionSheetIOS, Platform, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { CheckCircle2, FileCheck2, Upload } from '~/components/ui/lucide';
import type { CompanyDocumentRow, VerificationStatus } from '@/lib/supabase/database.types';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import {
  DocumentRefused,
  pickDocument,
  pickDocumentPhoto,
  useUploadDocument,
  type DocType,
  type DocumentSource,
} from '~/features/employer/company';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { dialog } from '~/lib/dialog';

const DOC_TYPES: readonly DocType[] = ['commercial_register', 'tax_card'];

/**
 * The papers a company is verified on — the website's VerificationPanel: the
 * commercial register and the tax card, each with what has been sent and
 * where it stands (a reviewer's note when one is asked for again), and a way
 * to send another — a PDF or a photo of it. Verified, it says so and nothing
 * else. A company admin's: the database refuses anybody else.
 */
export function VerificationPanel({
  companyId,
  status,
  documents,
}: {
  companyId: string;
  status: VerificationStatus;
  documents: CompanyDocumentRow[];
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const upload = useUploadDocument(companyId);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<DocType | null>(null);

  if (status === 'verified') {
    return (
      <Notice tone="success" icon={<CheckCircle2 size={16} color={colors.success} />} title={t('companies.verified')} />
    );
  }

  /** Where the paper is: photographed now, in the library, or a file — the phone's own chooser. */
  const askSource = (): Promise<DocumentSource | null> =>
    new Promise((resolve) => {
      const choices: [DocumentSource, string][] = [
        ['camera', t('app.company.docCamera')],
        ['library', t('app.company.docPhotos')],
        ['file', t('app.company.docFile')],
      ];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { title: t('app.company.docFrom'), options: [...choices.map(([, label]) => label), t('common.cancel')], cancelButtonIndex: choices.length },
          (index) => resolve(choices[index]?.[0] ?? null),
        );
      } else {
        dialog.alert(
          t('app.company.docFrom'),
          undefined,
          choices.map(([source, label]) => ({ text: label, onPress: () => resolve(source) })),
          { cancelable: true, onDismiss: () => resolve(null) },
        );
      }
    });

  const send = async (docType: DocType) => {
    setError(null);
    const source = await askSource();
    if (!source) return;
    const picked = await (source === 'file' ? pickDocument() : pickDocumentPhoto(source)).catch(() => null);
    if (!picked) return;
    if ('problem' in picked) {
      return setError(picked.problem === 'camera' ? t('app.company.cameraDenied') : t(`validation.${picked.problem}`));
    }
    setSending(docType);
    upload.mutate(
      { docType, document: picked.document },
      {
        onSettled: () => setSending(null),
        onError: (failure) => {
          const reason = failure instanceof DocumentRefused ? failure.reason : 'failed';
          setError(reason === 'failed' ? t('common.errorBody') : t(`validation.${reason}`));
        },
      },
    );
  };

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('employer.verification')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('employer.verificationBody')}
        </Text>
      </View>

      {DOC_TYPES.map((docType) => {
        const label = docType === 'commercial_register' ? t('employer.commercialRegister') : t('employer.taxCard');
        const sent = documents.filter((doc) => doc.doc_type === docType);
        return (
          <View key={docType} style={{ gap: space[2], padding: space[3], ...corner('lg'), borderWidth: 1, borderColor: colors.border }}>
            <Text variant="small" weight="medium">
              {label}
            </Text>
            {sent.map((doc) => (
              <View key={doc.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
                <FileCheck2 size={14} color={colors.mutedForeground} />
                <Badge
                  variant={doc.status === 'rejected' ? 'destructive' : 'warning'}
                  label={doc.status === 'rejected' ? t('employer.docRejected') : t('employer.docUnderReview')}
                />
                {doc.review_note ? (
                  <Text variant="caption" tone="mutedForeground" style={{ flexShrink: 1 }}>
                    {doc.review_note}
                  </Text>
                ) : null}
              </View>
            ))}
            <View style={{ alignItems: 'flex-start' }}>
              <Button
                label={t('employer.uploadDoc')}
                accessibilityLabel={`${t('employer.uploadDoc')}: ${label}`}
                variant="ghost"
                size="sm"
                icon={<Upload size={16} color={colors.primary} />}
                loading={sending === docType}
                disabled={upload.isPending}
                onPress={() => send(docType)}
              />
            </View>
          </View>
        );
      })}

      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
        <Text variant="caption" tone="mutedForeground">
          {t('employer.unverifiedCap')}
        </Text>
      </View>
    </Card>
  );
}
