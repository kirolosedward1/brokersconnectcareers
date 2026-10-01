---
title: Cookies and storage on your device
updated: 2026-10-01
---

This page explains everything the Brokers Connect website keeps in your browser, and everything the app keeps on your phone, and why. It is part of our [Privacy policy](/privacy).

In short: **we use no advertising or tracking cookies, and we let no third party track you through us.** Everything we keep is either needed for a service you asked for — such as staying signed in — or remembers a choice you made yourself.

## What the website keeps in your browser

**Sign-in session cookies** — `sb-…-auth-token`, which may be split into parts named like `sb-…-auth-token.0` and `sb-…-auth-token.1` when it is long.
Set when you sign in, they keep you signed in from page to page and from one visit to the next. They are deleted when you sign out, and otherwise expire after 400 days at most. They are only sent over an encrypted connection, and only when you open our pages yourself, never with requests other websites make in the background. Necessary: without them you cannot use your account.

**Sign-in verification cookies** — named starting `sb-…` and ending `code-verifier`: one for each sign-in under way, and a short index of them.
Set when you start signing in with Google or Apple, create an account, or ask to reset your password, so the website can check that whoever started is the one finishing. They hold random values, nothing about you, and are removed once they have been used. Necessary for signing in securely.

**Our host's security check.** If the firewall at our hosting provider (Vercel) asks your browser to pass a security check — for example on the sign-in and sign-up pages, or while the site is under attack — it keeps a short-lived cookie recording that the check was passed, so you are not asked again on every page. It holds nothing about you and is used only for protection.

**Your appearance choice** — `bc-theme`, in your browser's local storage (localStorage).
Kept only when you yourself choose the light, dark or system appearance at the bottom of a page, so the site stays the way you chose. It stays until you clear it from your browser.

**Where a visit came from** — `bc.src`, in session storage (sessionStorage).
Kept only when visit counting is on, and only if you arrived through a link someone shared, so the visit can be counted as coming from a share. Deleted when you close the tab. Visit counting — if we turn it on — uses a tool that sets no cookies and does not identify individuals (Plausible or Umami): it receives the address of the page you opened, the site you came from, and your browser and device type, and nothing from your account.

## What others set

**Checking you are a person.** On the sign-in, sign-up and password-reset pages a Cloudflare Turnstile check may appear. It reads signals from your browser to tell people from automated programs. It runs in a frame from Cloudflare, under Cloudflare's privacy policy, and is not used for advertising.

**Signing in with Google or Apple.** If you choose one of them you go to Google's or Apple's own page, and what they keep there is under their policies.

There are no advertising tools on the website, no share buttons that track you, and no maps or videos embedded from other sites. The typeface the website uses is served from our own servers, so opening a page does not contact Google or anyone else for it.

## What the app keeps on your phone

The app uses no cookies. It keeps only the following on your phone:

- **Your sign-in session:** encrypted, with a key held in the phone's secure storage (the Keychain on an iPhone), and deleted when you sign out.
- **The last account signed in on this phone:** its kind (consultant or company) and approval status, and its company's id and verification status, so the app knows which tabs to show when it opens, before it reaches the internet. Forgotten when you sign out.
- **Your settings on this phone:** your appearance choice, the companies you hid from lists, and your notification token and choices.
- **A temporary copy of public lists:** governorates, districts and developers, so search screens open quickly. Refreshed every day, and holding nothing from your account.

All of this is deleted when you delete the app from your phone. (An iPhone may keep the encryption key itself in the Keychain after the app is deleted, but with the session it protected gone, it unlocks nothing.)

## Why there is no consent banner

Cookie consent banners exist to ask before tracking, advertising and behaviour analysis. What we keep is needed for a service you asked for or remembers a choice you made, so it needs no question. If we ever add something that does need your consent, we will ask you first and update this page.

## Controlling them

- **Signing out** deletes the session cookies from your browser or phone.
- You can clear cookies and local storage from your browser's settings at any time; you will then need to sign in again and choose your appearance again.
- You can block cookies in your browser's settings, but signing in to your account will not work without them.

## Contact

For any question about this page: **info@topsuite.net**.
