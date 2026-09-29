import { useMemo } from 'react';
import { useLocale } from 'use-intl';
import { localized } from '@/lib/locale';
import { useDistricts } from '~/features/taxonomy';
import { useSession } from '~/lib/session';

/**
 * What every applicant card on a screen shares: the company's name for the
 * WhatsApp opener, who is reading (whose notes they may take back), and the
 * districts' names — resolved once per screen rather than per card.
 */
export function useApplicantContext() {
  const locale = useLocale();
  const { session, viewer } = useSession();
  const districts = useDistricts().data;
  const districtName = useMemo(
    () => new Map((districts ?? []).map((row) => [row.id, localized(locale, row.name_ar, row.name_en)])),
    [districts, locale],
  );
  return {
    companyName: viewer?.company ? localized(locale, viewer.company.name_ar, viewer.company.name_en) : '',
    viewerId: session?.user.id ?? null,
    districtNames: (ids: number[]) => ids.map((id) => districtName.get(id)).filter((name): name is string => Boolean(name)),
  };
}
