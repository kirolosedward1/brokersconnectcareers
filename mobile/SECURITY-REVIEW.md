# Mobile security review — 2026-10-29

This review covers native session storage, app locking, sign-out cleanup, and
the mobile dependency tree. It is not a penetration test or a guarantee that
every app feature is secure.

## Changes

- Native session encryption keys stay in SecureStore. An unavailable or
  failing Keychain/Keystore never causes a plaintext key to be written to
  AsyncStorage. Legacy plaintext native keys are removed; affected sessions
  require a fresh sign-in. The browser fallback is unchanged and does not
  provide protection against scripts that can read browser storage.
- Session reads, writes, and removals run in order. Pending encryption or
  decryption cannot repopulate a session after its removal completes. Failed
  persistence does not populate the in-memory session cache.
- Unavailable device authentication cannot unlock the app or disable its
  lock. Unreadable or malformed settings require authentication before
  signed-in screens are revealed. Settings change in memory only after they
  are saved successfully. Retry and sign-out remain available.
- Personal-cache cleanup continues through the remaining picker folders
  and exported files when one deletion fails. Files the OS refuses to delete
  can still remain; this is best-effort cleanup, not guaranteed secure erasure.
- Updated transitive `fast-uri` from 3.1.8 to 3.1.9, removing four published
  scheme, host, and path-normalization advisories. Updated the lockfile and
  license inventory together.

## Remaining dependency findings

`pnpm audit --prod --json` reports three advisories after the patch:

| Package | Severity | Advisory | Follow-up |
| --- | --- | --- | --- |
| node-forge 1.4.0 | High | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo CLI dependency; no patched version reported. Track the upstream fix. |
| zod 3.25.76 | High | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Advisory lists 4.6.6 as fixed. Review removal or coordinate a major-version migration with shared website types and schemas. |
| deepmerge 4.3.1 | Low | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | Expo config dependency; no patched version reported. Track the upstream fix. |

The production-configured iOS export's source map contains 2,151 modules and
zero modules from these three packages. They remain installed dependencies;
their absence from this iOS bundle does not resolve tooling exposure or prove
anything about future bundles or the website's separate dependency tree.

## Validation and release limits

Regression coverage includes unavailable secure storage on iOS and Android,
storage failures, legacy-key removal, sign-out races, corrupted lock settings,
unavailable device authentication, and partial cache-cleanup failure.

Validation passed for these changes:

- `pnpm check`: TypeScript, lint, shared-module checks, 73 update-publishing
  checks, license inventory, and all 1,480 tests across 98 Jest suites.
- `pnpm export:ios --source-maps`: Metro and Hermes compiled the production
  configuration; maps were generated locally for dependency analysis.
- `pnpm release:check --bundle dist`: production configuration and bundle
  checks, including scans for Supabase secret keys, service-role tokens,
  private keys, and demo passwords.

Before shipping, test on physical devices: normal login and upload flows,
Keychain/Keystore access after restart, Face ID/passcode cancellation and
unavailability, background privacy cover, and sign-out with picked CVs and
data exports. Automated native API tests use mocks; they cannot establish
actual hardware behavior. No mobile OTA update or store build was published
as part of this review.
