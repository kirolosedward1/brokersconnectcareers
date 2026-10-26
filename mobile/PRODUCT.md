# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

## Users

- **Candidates** (primary): real-estate sales consultants and brokers in Egypt, Cairo first — primary sales, resale, leasing and commercial — looking for their next role, often on the phone between site visits. They browse and filter listings, apply with a CV, follow where each application stands, save listings, and keep a directory profile and CV that companies can find.
- **Employers**: brokerages and developers that post listings, review and move applicants through stages, and (once approved) search the consultant directory and shortlist people.
- **Admins** moderate from the app's Admin tab — the website's admin console for the phone: reports and appeals, companies and their verification, listings, users, applications and consultants — and from the website, which keeps the rest of the console.

## Product Purpose

A vertical job board and consultant directory for the Egyptian real-estate market: one place where a consultant sees what a role really pays and a company finds people who have actually sold. Success is applications that lead to hires, and companies that come back to post again.

## Positioning

Every listing states its basic salary and its commission as numbers, and who brings the clients (the company or the consultant) — not "an attractive salary" or "tempting commissions". Searching and applying are free for job seekers. Companies carry a verified mark only after the team has checked their commercial register and tax card.

## Operating Context

- Arabic first and right to left everywhere, in plain Egyptian Arabic; English exists behind a flag. Light and dark, following the iPhone's own setting unless the person picks one in Account.
- The iOS app (Expo / React Native, in `mobile/`) shares the website's database, permissions and logic; every write goes through the website's own actions, so emails, upload checks and limits behave the same.
- The owner tries each change in Expo Go on an iPhone; App Store release is being prepared.

## Capabilities and Constraints

- Candidates: the board with every website filter, track-in-district pages, apply with CV, application timeline and withdraw, saved listings with notes, reminders and comparing, saved searches and follows with alerts, directory profile and CV sections, notifications and push.
- Employers: overview, listings and a step-by-step listing wizard, applicant inbox and per-listing pipeline, private notes, WhatsApp replies, consultant directory (approved employers only), company profile, verification documents and team.
- Billing is shown read-only in the app; nothing is bought in it (App Store rule).
- Words come from the shared message catalogue; numbers inside Arabic text are isolated left to right.

## Brand Commitments

- Name: Brokers Connect · بروكرز كونكت, with the website's official logo.
- Tagline: «سوق الوظائف المتخصص في العقارات المصرية».
- Voice: concrete and plain — figures rather than adjectives, no hype, no promises the product cannot keep.

## Evidence on Hand

- Real listings and demo jobs on production for browsing; the official logo, and the 1024 px App Store icon made from it (`assets/images/icon.png`).
- Privacy, terms, cookies, refunds and deletion pages exist on the website.
- No testimonials, customer counts, press or case studies exist: none may be invented.

## Product Principles

1. Numbers, not adjectives: pay, commission and who brings the clients, stated plainly.
2. Free and fair for job seekers: no fees, no dark patterns, nothing hidden.
3. Arabic first, right to left, in every screen and every gesture.
4. One truth with the website: the same data, rules and words.
5. Trust is shown, not claimed: verified companies, reporting and hiding are always at hand.

## Accessibility & Inclusion

Arabic VoiceOver labels on everything, Dynamic Type up to the accessibility sizes, 44-point touch targets, reduced motion respected, and WCAG AA contrast in light and dark.
