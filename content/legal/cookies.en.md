---
title: Cookies and storage on your device
updated: 2026-10-27
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

**Opened from the app** — `bc_app`.
Set only when a page is opened with `?app=1`, so the card about the app stays hidden for the rest of that browser session. A session cookie: nothing about you, and deleted when you close the browser.

**Google One Tap closed** — `bc.google-one-tap`, in session storage (sessionStorage).
On the home page, the jobs list and a job's page, while you are signed out, the site may ask Google to offer signing in with a Google account already on this browser. If you close that offer, this entry remembers the close for this tab only, so it is not shown again until the tab is closed. It holds nothing about you. It is not used on the sign-in or sign-up pages, and not inside the mobile app.

**Forms you have not finished** — `bc-draft:…`, in your browser's local storage (localStorage).
While you are signed in and typing into a job application, a job advert or the form that sets up your account, what you have typed is kept as you go, so that closing the tab, losing the connection or being asked to sign in again does not lose it. It is kept under your account only and shown back only to you, and it never includes a file you attached or your agreement to our terms. It is deleted as soon as the form is sent, when you choose "Start over", when you sign out, and in any case after seven days.

**The first page this browser opened** — `bc_touch`, a cookie and a copy in local storage (localStorage), kept for 180 days.
Written on the first page this browser opens here, and a later page does not replace it. It holds the path you landed on, the site you came from, the campaign name when the link carried one (`utm_source`, `utm_medium`, `utm_campaign`), whether that link had a Google or Meta click id (the id itself is not stored), whether the page was opened inside the app, and the time. When you create an account — or on the first signed-in visit, if the account is still new — that record is copied onto the account once. An account that already existed is left without it. Nothing in it is your name, your email, or a click id.

**That this copy already reached your account** — `bc_touch_sent`, in session storage (sessionStorage).
A flag only, with nothing about you, so the browser does not send the same record again after the account has taken it. Removed when you close the tab.

## What others set

**Checking you are a person.** On the sign-in, sign-up and password-reset pages a Cloudflare Turnstile check may appear. It reads signals from your browser to tell people from automated programs. It runs in a frame from Cloudflare, under Cloudflare's privacy policy, and is not used for advertising.

**Signing in with Google or Apple.** Choosing Google or Apple on the sign-in page opens Google's or Apple's own page, and what they keep there is under their policies. On the home page, the jobs list and a job's page, while you are signed out, Google One Tap may also be shown by a script loaded from `accounts.google.com`. Google may then store its own cookie (such as `g_state`) to decide how soon that offer may appear again. That cookie is Google's, under Google's policy. Closing the offer does not remove it — that spacing is Google's, and we do not override it. The offer is not shown on the sign-in or sign-up pages, and not inside the app.

There are no advertising tools on the website, no share buttons that track you, and no maps or videos embedded from other sites. The typeface the website uses is served from our own servers, so opening a page does not contact Google or anyone else for it.

## What the app keeps on your phone

The app uses no cookies. It keeps only the following on your phone:

- **Your sign-in session:** encrypted, with a key held in the phone's secure storage (the Keychain on an iPhone), and deleted when you sign out.
- **The last account signed in on this phone:** its kind (consultant or company) and approval status, and its company's id and verification status, so the app knows which tabs to show when it opens, before it reaches the internet. Forgotten when you sign out.
- **Your settings on this phone:** your appearance choice, the companies, consultants and listings you hid from lists, your notification token and choices, and whether the app asks for Face ID or your passcode when it opens.
- **Forms you have not finished:** while you write a job advert or apply for a job, what you have typed is kept as you go, so that the phone closing the app does not lose it. Kept under your account only, never a file you attached, and deleted once the form is sent, when you choose "Start over" or leave it and discard it, when you sign out, and in any case after seven days.
- **What you keep for yourself in the app:** the scheduled notifications for closing-date reminders on saved jobs (the phone shows them at the time you chose), your saved consultant searches and the alerts they send, your saved WhatsApp replies, the kinds of listing you asked to see fewer of, the listings and searches you looked at lately, and where you got to on the job board, so it can show what is new since. These are kept for your account alone, are never sent to us, and are deleted from the phone when you delete your account. (When to remind you, and the note you write on a saved job, are part of your account, kept with the bookmark and shown on the website too. The phone keeps the scheduled notification, a copy of that time.)
- **For signing in:** where you were going when you started creating your account (a listing you tapped Apply on, say), until you get there; and, if you signed in with Apple on this phone, which Apple ID you used, so the app can sign you out if you stop using Apple with it. Both are forgotten when you sign out or delete your account.
- **The last crash:** if the app closes because of an error, a short record of the error (its message and where in the app's code it happened) and the app's version, so the app can tell you about it the next time it opens and you can choose to send it to us. Nothing is sent unless you do.
- **A temporary copy of public lists:** governorates, districts and developers, so search screens open quickly; and the counts on Home with the first page of the job board and of the company directory, so the app opens on them at once, even on a slow connection, and refreshes them behind. None is kept longer than a day, and none holds anything from your account.

All of this is deleted when you delete the app from your phone. (An iPhone may keep the encryption key itself in the Keychain after the app is deleted, but with the session it protected gone, it unlocks nothing.)

## Why there is no consent banner

Cookie consent banners exist to ask before tracking, advertising and behaviour analysis. What we keep is needed for a service you asked for or remembers a choice you made, so it needs no question. If we ever add something that does need your consent, we will ask you first and update this page.

## Controlling them

- **Signing out** deletes the session cookies from your browser or phone, and any unfinished forms kept in your browser.
- You can clear cookies and local storage from your browser's settings at any time; you will then need to sign in again and choose your appearance again.
- You can block cookies in your browser's settings, but signing in to your account will not work without them.

## Contact

For any question about this page: **info@topsuite.net**.
