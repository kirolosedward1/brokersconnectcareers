'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { whatsappLink } from '@/lib/utils';
import { employerToAgentOpener } from '@/lib/whatsapp';
import { localized, type Locale } from '@/i18n/routing';
import { getViewer } from '@/lib/auth';
import { logFailure } from '@/lib/observe';

/**
 * Asking for a consultant's number.
 *
 * The card never carries it (migration 203). This is the one door: the
 * database function behind it checks that the caller is signed in, acts for a
 * company in good standing, may open this card at all, and has not opened
 * more cards this hour or this day than a person does — and it writes down
 * every number it hands over. This action adds nothing to that decision; it
 * turns the answer into a WhatsApp link with the opener the product already
 * uses, and into the four outcomes the button knows how to show.
 */

const HANDLE = /^(?:[a-z0-9][a-z0-9-]{0,118}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const schema = z.object({
  handle: z.string().trim().regex(HANDLE),
  locale: z.enum(['ar', 'en']),
});

export type ContactRevealResult =
  | {
      ok: true;
      data: { fullName: string; phone: string; whatsappUrl: string; hasCv: boolean };
    }
  | {
      ok: false;
      error: 'invalid' | 'unauthenticated' | 'forbidden' | 'locked' | 'not_found' | 'rate_limit' | 'failed';
      retryAfterSeconds?: number;
    };

export async function revealAgentContact(input: unknown): Promise<ContactRevealResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'unauthenticated' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('reveal_agent_contact', {
    p_handle: parsed.data.handle,
  });

  if (error) {
    logFailure('directory', 'contact reveal failed', { by: viewer.userId, code: error.code });
    return { ok: false, error: 'failed' };
  }

  const row = data?.[0];
  if (!row) return { ok: false, error: 'failed' };

  switch (row.status) {
    case 'ok':
      break;
    case 'rate_limited':
      return { ok: false, error: 'rate_limit', retryAfterSeconds: row.retry_after_seconds ?? 3600 };
    case 'unauthenticated':
      return { ok: false, error: 'unauthenticated' };
    case 'forbidden':
      return { ok: false, error: 'forbidden' };
    case 'locked':
      return { ok: false, error: 'locked' };
    default:
      return { ok: false, error: 'not_found' };
  }

  if (!row.whatsapp_phone) return { ok: false, error: 'failed' };

  const locale = parsed.data.locale as Locale;
  const companyName = viewer.company
    ? localized(locale, viewer.company.name_ar, viewer.company.name_en)
    : '';

  return {
    ok: true,
    data: {
      fullName: row.full_name ?? '',
      phone: row.whatsapp_phone,
      whatsappUrl: whatsappLink(
        row.whatsapp_phone,
        employerToAgentOpener({ agentName: row.full_name ?? '', companyName, locale }),
      ),
      hasCv: Boolean(row.cv_path),
    },
  };
}
