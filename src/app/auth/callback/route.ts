import { NextResponse, type NextRequest } from 'next/server';
import { linkFailureRedirect } from '@/lib/auth/cross-device';
import { landingAfterSignIn } from '@/lib/auth/landing';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth / magic-link landing point. Lives outside the locale segment because
 * the redirect URL is registered with the provider and cannot vary by language.
 *
 * The code flow: Google, and email links minted before /auth/confirm took over
 * the templates. The confirmation template itself sends a token hash to
 * /auth/confirm, which verifies on any device. A code still arrives for an
 * older mail, and for a project whose template is still {{ .ConfirmationURL }}.
 * Where somebody goes once the code is exchanged is decided by
 * landingAfterSignIn(), which /auth/confirm shares.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next');
  const next = nextParam ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const failure = linkFailureRedirect({
      flow: 'code',
      error,
      type: searchParams.get('type'),
      next: nextParam,
      marker: searchParams.get('flow'),
    });
    if (failure === 'confirmed') {
      return NextResponse.redirect(`${origin}/sign-in?confirmed=1`);
    }
    return NextResponse.redirect(`${origin}/sign-in?error=exchange_failed`);
  }

  return NextResponse.redirect(await landingAfterSignIn(supabase, origin, next));
}
