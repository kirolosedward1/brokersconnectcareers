'use client';

import { useState, useTransition } from 'react';
import { LogOut, Settings, User } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

export function UserMenu({
  name,
  signOutLabel,
  accountLabel,
  locale,
}: {
  name: string;
  signOutLabel: string;
  accountLabel: string;
  locale: Locale;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await createClient().auth.signOut();
      router.replace('/', { locale });
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <User />
        <span className="hidden max-w-24 truncate sm:inline">{name}</span>
      </Button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute end-0 z-20 mt-1 w-48 rounded-lg border border-border bg-popover p-1 shadow-lg"
          >
            {/* Where the privacy policy says these rights are exercised, so it
                has to be reachable without knowing the URL. */}
            <Link
              role="menuitem"
              href="/dashboard/account"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm transition-colors hover:bg-muted"
            >
              <Settings className="size-4" aria-hidden />
              {accountLabel}
            </Link>

            <div className="my-1 h-px bg-border" />

            <button
              role="menuitem"
              type="button"
              onClick={signOut}
              disabled={pending}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-muted disabled:opacity-60"
            >
              <LogOut className="size-4" aria-hidden />
              {signOutLabel}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
