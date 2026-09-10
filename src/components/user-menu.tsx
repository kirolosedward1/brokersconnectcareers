'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { LogOut, Settings, User } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localeHref, type Locale } from '@/i18n/routing';
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
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Escape closes it, and focus goes back to the button that opened it.
   *
   * The bell and the phone menu both did this; this one did not, so a keyboard
   * user could open the account menu and have no way to dismiss it without
   * tabbing through every item in it. aria-haspopup promises a menu; a menu
   * you cannot leave is not one.
   */
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function signOut() {
    startTransition(async () => {
      await createClient().auth.signOut();
      /*
        A document navigation, not a router push. Signing out changes who the
        server thinks you are, and a client push races the refresh that was
        there to tell it — the sign-in form landed on a blank page that way.
        A full load costs one request and cannot get this wrong.
      */
      window.location.assign(localeHref(locale, '/'));
    });
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        className="h-11 min-w-11"
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
