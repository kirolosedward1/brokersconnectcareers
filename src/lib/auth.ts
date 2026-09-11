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
  /**
   * The account type chosen on the sign-up door, kept in user metadata so it
   * survives a confirmation link that carries no query string. A suggestion
   * for onboarding only — the profile row is the decision, and this is never
   * read once one exists.
   */
  suggestedRole?: 'candidate' | 'employer';
  profile: ProfileRow | null;
  company: CompanyRow | null;
  /**
   * The profile row could not be read — as distinct from not existing.
   *
   * The absence of a profile is how this app knows onboarding has not run, so
   * a failed read looked exactly like a new account: a database blip sent an
   * established user back through the sign-up form. Recorded rather than
   * flattened, so the protected pages can say "something went wrong" while the
   * public header carries on treating an unreachable database as "nobody is
   * signed in", which is all it needs to know.
   */
  profileUnreadable: boolean;
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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  let company: CompanyRow | null = null;
  if (profile?.role === 'employer') {
    /*
      Through membership, not ownership.

      A company is a team: row-level security lets any member read its jobs
      and applicants and post on its behalf, and only an admin member edit
      the company itself. Keyed on owner_id this returned null for every
      colleague who was invited rather than signing up — so a recruiter with
      full database access saw a console with no company in it, and the
      contact button on the consultant directory, which gates on
      viewer.company, never appeared for them.

      my_company_id() is the single answer to "which company am I acting
      for", and it breaks ties deterministically: admin first, then oldest.
    */
    const { data: companyId } = await supabase.rpc('my_company_id');
    if (companyId) {
      const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
      company = data ?? null;
    }
  }

  const metadata = user.user_metadata ?? {};
  const suggestedName =
    (typeof metadata.full_name === 'string' && metadata.full_name) ||
    (typeof metadata.name === 'string' && metadata.name) ||
    (user.email ? user.email.split('@')[0] : '');

  const suggestedRole =
    metadata.role === 'candidate' || metadata.role === 'employer' ? metadata.role : undefined;

  return {
    userId: user.id,
    email: user.email ?? null,
    suggestedName,
    suggestedRole,
    profile: profile ?? null,
    company,
    profileUnreadable: Boolean(profileError),
  };
});

/** Signed in and onboarded, or bounced. */
export async function requireProfile(locale: Locale): Promise<Viewer & { profile: ProfileRow }> {
  const viewer = await getViewer();
  if (!viewer) redirect({ href: '/sign-in', locale });

  /*
    A read that failed is not an account that has not onboarded.

    Both arrive here as `profile: null`, and treating them alike sent somebody
    with a perfectly good account back to /onboarding the moment the database
    hiccupped — where the form would have been filled in again, met the
    duplicate key, and bounced them onward. Thrown instead, so the console's
    error boundary says what actually happened and offers Retry, with the
    shell still around it.
  */
  if (viewer!.profileUnreadable) {
    throw new Error('the profile row could not be read');
  }

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
