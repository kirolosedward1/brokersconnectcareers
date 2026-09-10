'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The submit control for a form that only works once JavaScript has loaded.
 *
 * A `<form onSubmit={...}>` with no `action` renders as `<form>` in the HTML —
 * no action, no method — and a browser submitting that does a GET to the same
 * URL with every field in the query string. React's handler is what prevents
 * it, and React's handler does not exist until the page hydrates.
 *
 * So between paint and hydration, every one of these forms had a live button
 * that silently did the wrong thing. On /sign-in that meant an email and a
 * password in `location.href` — browser history, the Referer header on every
 * same-origin request that followed, and the platform's access log — and no
 * sign-in. On the apply form it meant a name, a WhatsApp number and a cover
 * note in the URL, and an application that was never created. This is not
 * theoretical: it happened while testing the apply form, which is how it was
 * found. On a 230 KB page over Egyptian mobile data that window is not
 * milliseconds.
 *
 * Disabled until mounted, therefore. A disabled button cannot be clicked, and
 * the HTML spec skips implicit submission when the form's default button is
 * disabled — so Enter in a text field is covered by the same line.
 *
 * This is not a downgrade in reach: these forms cannot work without JavaScript
 * at all, so the only thing lost is a submission that was going to fail. Forms
 * that *are* progressive — the keyword search, whose native GET produces
 * exactly the `?q=` the page reads, and the ones with a real server action —
 * keep their plain Button and must not use this.
 */
export function SubmitButton({
  disabled,
  ...props
}: React.ComponentProps<typeof Button>) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return <Button type="submit" disabled={!hydrated || disabled} {...props} />;
}
