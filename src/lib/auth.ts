import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
import type { Locale } from '@/i18n/routing';

export type Viewer = {
  userId: string;
  email: string | null;
  /** Name the identity provider gave us, used to pre-fill onboarding. */
  suggestedName: string;
  profile: ProfileRow | null;
  company: CompanyRow | null;
};

/**
 * The signed-in user together with their profile and (for employers) their
 * company. Cached per request, so calling it from a layout and again from a
 * page inside that layout costs one round trip, not two.
 *
 * A null profile means the user authenticated but has not been through
 * /onboarding yet — the absence of the row is the signal.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // The site header calls this on every page, including the landing page, the
  // blog and the legal pages, none of which need a database. Treat an
  // unconfigured or unreachable Supabase as "nobody is signed in" rather than
  // letting it 500 the entire site.
  let supabase;
  let user;
  try {
    supabase = await createClient();
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (error) {
    // Next signals control flow by throwing: redirect, notFound, and the
    // dynamic-server-usage error that reading cookies raises during static
    // generation. Catching those turns a page that should have been marked
    // dynamic into one rendered as though nobody were signed in. Only a real
    // failure to reach Supabase should fall through to "signed out".
    unstable_rethrow(error);

    console.warn(
      '[auth] could not determine the current user:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  let company: CompanyRow | null = null;
  if (profile?.role === 'employer') {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .eq('owner_id', user.id)
      .maybeSingle();
    company = data ?? null;
  }

  const metadata = user.user_metadata ?? {};
  const suggestedName =
    (typeof metadata.full_name === 'string' && metadata.full_name) ||
    (typeof metadata.name === 'string' && metadata.name) ||
    (user.email ? user.email.split('@')[0] : '');

  return {
    userId: user.id,
    email: user.email ?? null,
    suggestedName,
    profile: profile ?? null,
    company,
  };
});

/** Signed in and onboarded, or bounced. */
export async function requireProfile(locale: Locale): Promise<Viewer & { profile: ProfileRow }> {
  const viewer = await getViewer();
  if (!viewer) redirect({ href: '/sign-in', locale });
  if (!viewer!.profile) redirect({ href: '/onboarding', locale });
  return viewer as Viewer & { profile: ProfileRow };
}

export async function requireEmployer(locale: Locale) {
  const viewer = await requireProfile(locale);
  if (viewer.profile.role !== 'employer' && viewer.profile.role !== 'admin') {
    redirect({ href: '/dashboard', locale });
  }
  return viewer;
}

export async function requireCandidate(locale: Locale) {
  const viewer = await requireProfile(locale);
  if (viewer.profile.role === 'employer') {
    redirect({ href: '/employer/jobs', locale });
  }
  return viewer;
}

export async function requireAdmin(locale: Locale) {
  const viewer = await requireProfile(locale);
  if (viewer.profile.role !== 'admin') {
    redirect({ href: '/', locale });
  }
  return viewer;
}
