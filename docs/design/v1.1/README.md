# Brokers Connect iOS · v1.1 design boards

Exported from the design canvas «Brokers Connect iOS Redesign» (claude.ai/artifact/78M8D9URo2avJxKt6szUrP).
Each board is its HTML source under `boards/`, named after the board; `canvas.json` is the canvas index (layout, titles and notes).
They are the source of truth for presentation in the v1.1 work: where a board and the code disagree on behaviour, the behaviour stays and the presentation changes.

## Notes on the canvas

- Scope: Every shipped feature is kept. Presentation changed: pay first on every card, one next action on Home, pinned Apply bar, one card and chip language across roles.
- RTL: Root dir=rtl lang=ar on every board. Numbers in .num: ltr, isolated, tabular, right aligned when on their own line. Charts dir=ltr. Onward chevron points left, back points right.
- Measure before judging: link → listing → apply; sign up → profile 60%; employer post → first applicant opened; reveal → WhatsApp tap

## Candidate · browse, apply, track, save

- [Home · candidate](boards/Main.dc.html)
- [Jobs board](boards/Jobs.dc.html)
- [Listing](boards/JobDetail.dc.html)
- [Apply with CV](boards/Apply.dc.html)
- [My applications](boards/Applications.dc.html)
- [Saved · notes, reminders, compare](boards/Saved.dc.html)
- [Account](boards/Account.dc.html)

## Candidate · profile, timeline, compare, alerts, filters · dark

- [Directory profile & CV](boards/Profile.dc.html)
- [Notifications](boards/Notifications.dc.html)
- [Application timeline & withdraw](boards/ApplicationDetail.dc.html)
- [Compare saved listings](boards/Compare.dc.html)
- [Saved searches & follows](boards/Alerts.dc.html)
- [Filters sheet](boards/FilterSheet.dc.html)
- [Home · dark](boards/HomeDark.dc.html)
- [Listing · dark](boards/JobDetailDark.dc.html)

## Entry · public directories

- [Welcome](boards/Welcome.dc.html)
- [Sign in](boards/SignIn.dc.html)
- [Sign up · role](boards/SignUp.dc.html)
- [Two-factor code](boards/MFA.dc.html)
- [Companies directory](boards/Companies.dc.html)
- [Company page](boards/Company.dc.html)
- [Consultant directory](boards/Agents.dc.html)
- [Consultant profile](boards/Agent.dc.html)

## Employer

- [Employer · overview](boards/EmployerHome.dc.html)
- [Employer · listings](boards/EmployerListings.dc.html)
- [Employer · listing wizard](boards/ListingWizard.dc.html)
- [Employer · applicant pipeline](boards/Applicants.dc.html)
- [Employer · applicant review](boards/ApplicantReview.dc.html)
- [Employer · company, verification, team](boards/CompanySettings.dc.html)
- [Employer · billing (read-only)](boards/Billing.dc.html)

## Auth recovery · gates · system states

- [Forgot password](boards/Forgot.dc.html)
- [New password](boards/NewPassword.dc.html)
- [Email confirm](boards/Confirm.dc.html)
- [2FA enrolment](boards/MfaEnrol.dc.html)
- [Signed-out gate](boards/SignedOut.dc.html)
- [Update gate](boards/UpdateGate.dc.html)
- [App lock](boards/AppLock.dc.html)
- [Not found](boards/NotFound.dc.html)

## Account sub-pages · overlays and sheets

- [Profile preview (as companies see it)](boards/ProfilePreview.dc.html)
- [Email settings](boards/Emails.dc.html)
- [Security](boards/Security.dc.html)
- [Hidden jobs & companies](boards/Hidden.dc.html)
- [Legal & licences](boards/Licenses.dc.html)
- [Delete account](boards/DeleteAccount.dc.html)
- [Action sheet & toast](boards/Overlays.dc.html)
- [Note, sort, CV entry sheets](boards/Sheets.dc.html)
- [Push prompt, share card, crash notice](boards/Prompts.dc.html)

## Employer extras · landings · empty states

- [Employer · edit listing](boards/EditListing.dc.html)
- [Employer · shortlist](boards/Talent.dc.html)
- [Track-in-district landing](boards/Landing.dc.html)
- [Empty & loading states](boards/EmptyStates.dc.html)

## Admin · records

- [Admin console](boards/Admin.dc.html)
- [Admin · listings](boards/AdminJobs.dc.html)
- [Admin · listing review](boards/AdminReview.dc.html)
- [Admin · companies](boards/AdminCompanies.dc.html)
- [Admin · company](boards/AdminCompany.dc.html)
- [Admin · users](boards/AdminUsers.dc.html)
- [Admin · user](boards/AdminUser.dc.html)
- [Admin · applications](boards/AdminApplications.dc.html)
- [Admin · application](boards/AdminApplication.dc.html)

## Admin · moderation, operations, levers

- [Admin · consultants](boards/AdminAgents.dc.html)
- [Admin · consultant](boards/AdminAgent.dc.html)
- [Admin · reports](boards/AdminReports.dc.html)
- [Admin · appeals](boards/AdminAppeals.dc.html)
- [Admin · audit log](boards/AdminAudit.dc.html)
- [Admin · email](boards/AdminEmail.dc.html)
- [Admin · operations](boards/AdminOperations.dc.html)
- [Admin · security](boards/AdminSecurity.dc.html)
- [Admin · taxonomy](boards/AdminTaxonomy.dc.html)
- [Admin · search](boards/AdminSearch.dc.html)
- [Admin · decision sheet](boards/AdminDecision.dc.html)
- [Admin · door states](boards/AdminDoor.dc.html)

## Design system

- [Components & tokens](boards/Components.dc.html)

## Onboarding · candidates and companies

- [Onboarding · candidate 1 of 3](boards/Onboarding.dc.html)
- [Onboarding · candidate 2 of 3](boards/OnbCandidate2.dc.html)
- [Onboarding · candidate 3 of 3](boards/OnbCandidate3.dc.html)
- [Onboarding · company 1 of 3](boards/OnbCompany1.dc.html)
- [Onboarding · company 2 of 3](boards/OnbCompany2.dc.html)
- [Onboarding · company 3 of 3](boards/OnbCompany3.dc.html)

## Employer · proposed features (7–10)

- [Employer · bulk actions in pipeline](boards/PipelineBulk.dc.html)
- [Employer · listing performance & repost](boards/ListingStats.dc.html)
- [Employer · team roles & permissions](boards/TeamRoles.dc.html)
- [Employer · shared candidate history & notes](boards/CandidateHistory.dc.html)

## Employer · plans, subscription, promoted listings, checkout

- [Employer · packs & balance](boards/Plans.dc.html)
- [Employer · monthly subscription (proposed)](boards/Subscription.dc.html)
- [Employer · promote a listing](boards/PromoteListing.dc.html)
- [Employer · checkout (Paymob)](boards/Checkout.dc.html)
- [Employer · orders, invoices, success](boards/Orders.dc.html)

## Account · controls and preferences

- [Account · notification preferences](boards/NotificationPrefs.dc.html)
- [Employer · notification preferences](boards/EmployerNotifPrefs.dc.html)
- [Account · privacy, visibility, data](boards/Privacy.dc.html)
- [Account · job-seeking status](boards/Availability.dc.html)
- [Account · appearance & language](boards/Appearance.dc.html)
- [Account · help & support](boards/Support.dc.html)

## UX pass · apply without friction, search, trust, resilience

- [Apply · sign up inside the sheet](boards/ApplyGuest.dc.html)
- [Search · recent, suggestions, no results](boards/Search.dc.html)
- [Employer · reveal confirmation](boards/RevealConfirm.dc.html)
- [Offline, queued apply, skeleton, error](boards/Network.dc.html)

## Employer · team and account control

- [Employer · invite a member](boards/TeamInvite.dc.html)
- [Employer · member detail, limits, security](boards/MemberDetail.dc.html)
- [Employer · team activity log](boards/TeamActivity.dc.html)
- [Employer · approvals, spending limits, enforced 2FA](boards/ApprovalsLimits.dc.html)
- [Employer · saved replies](boards/SavedReplies.dc.html)
- [Employer · company account & ownership](boards/CompanyAccount.dc.html)
