# Public request and private route hardening

This review covers the website's public POST body handling and the shared cookie/bearer authentication gate. It is a targeted source review, not a certification of the production deployment.

## Changes

- Email and payment webhooks now accept at most 256 KiB; attribution and unsubscribe POSTs accept at most 8 KiB. The limits count streamed bytes even when Content-Length is absent or understates the size. Oversized bodies receive 413, interrupted reads receive 400, and neither reaches application writes. Webhooks reject missing configuration before reading the body. Email signature verification still uses the original text, including whitespace.
- The cookie authentication gate for CV downloads and account export now refuses requests when authentication or MFA verification fails. Previously it treated exceptions as “no second factor required” and continued into the handler, whose separate authentication attempt could succeed. Auth service failures now return 503, missing/invalid sessions 401, and an outstanding MFA challenge 403. These refusals are not cacheable.
- `pnpm test:security-routes` executes real route handlers with external auth/database calls replaced for deterministic failure tests; it is included in `pnpm check`.

## Validation and limits

Type checking and targeted security, authentication, mobile API, attribution, email and payment HMAC suites passed. Regression cases cover oversized declared/chunked/dishonestly declared bodies, interrupted streams, a valid signed email callback, missing webhook configuration, normal small inputs, and authentication/MFA failures before a private handler runs.

Subsequent feature verification resolved font access and local Supabase startup. Production build, authenticated API journeys, file uploads, browser journeys and admin MFA checks passed against the local stack; see `../testing/2026-10-29-feature-verification.md`. No production deployment or production database configuration was changed.

## Production verification still required

Verify the current settings in `SUPABASE_SETTINGS.md`, `EDGE_WAF.md`, and `RUNBOOKS.md` against the actual deployment: Turnstile enforcement in Supabase Auth, password and session policies, admin MFA enrollment/enforcement, firewall rules, backups and restore tests. Existing documentation is not evidence those settings are active. The application still has no malware scanning for otherwise valid uploaded documents, and the server rate limiter intentionally fails open on store failures. Those risks require separate implementation/operational decisions.
