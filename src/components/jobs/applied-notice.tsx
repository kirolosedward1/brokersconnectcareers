'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Link } from '@/i18n/navigation';

/**
 * What the apply button becomes once you have applied.
 *
 * It was a disabled button reading "already applied", which is a dead end in
 * the literal sense: it states a fact, offers nothing, and cannot be pressed
 * to find out more. The only way to reach the explanation was to type the
 * apply URL by hand and land on a page whose whole content was one sentence.
 *
 * Now it opens, and says where the application went. A dialog rather than a
 * page because nothing here is worth leaving the listing for — the person is
 * reading a job, and the answer is one line and a link.
 */
export function AppliedNotice({ full = false }: { full?: boolean }) {
  const t = useTranslations('jobs');
  const tApply = useTranslations('apply');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        className={full ? 'w-full' : undefined}
        onClick={() => setOpen(true)}
      >
        <CheckCircle2 aria-hidden />
        {t('applied')}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={t('applied')}
        closeLabel={tCommon('close')}
      >
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-9 text-success" aria-hidden />
          <p className="mt-3 font-semibold">{t('applied')}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{tApply('alreadyApplied')}</p>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/dashboard/applications">{tApply('viewApplications')}</Link>
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tCommon('close')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
