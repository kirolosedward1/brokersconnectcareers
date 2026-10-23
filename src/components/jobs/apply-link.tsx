'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { useSignInGate } from '@/components/auth/sign-in-gate';

/**
 * The Apply button: a link to the apply form for somebody signed in, and for
 * a visitor the sign-in dialog first (sign-in-gate.tsx), naming the listing,
 * then the same form — in place of the round trip through the sign-in page
 * that lost them the listing they were reading.
 */
export function ApplyLink({
  href,
  signedIn,
  intent,
  children,
  ...button
}: {
  href: string;
  signedIn: boolean;
  intent: { job: string; company: string };
  children: ReactNode;
} & Pick<ComponentProps<typeof Button>, 'size' | 'variant' | 'className'>) {
  const requireSignIn = useSignInGate();
  const router = useRouter();

  if (signedIn) {
    return (
      <Button asChild {...button}>
        <Link href={href}>{children}</Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      {...button}
      onClick={() => {
        void requireSignIn({ reason: 'apply', next: href, intent }).then((ok) => {
          if (ok) router.push(href);
        });
      }}
    >
      {children}
    </Button>
  );
}
