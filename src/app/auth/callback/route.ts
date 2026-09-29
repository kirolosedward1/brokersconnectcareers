import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { landingAfterSignIn } from '@/lib/auth/landing';

/**
 * OAuth / magic-link landing point. Lives outside the locale segment because
 * the redirect URL is registered with the provider and cannot vary by language.
 *
 * The code flow: Google, and email links minted before /auth/confirm took over
 * the templates. Where somebody goes once the code is exchanged is decided by
 * landingAfterSignIn(), which /auth/confirm shares.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=exchange_failed`);
  }

  return NextResponse.redirect(await landingAfterSignIn(supabase, origin, next));
}
