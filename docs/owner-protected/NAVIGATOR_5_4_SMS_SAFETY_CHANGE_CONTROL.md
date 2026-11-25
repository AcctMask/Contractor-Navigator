# NAVIGATOR 5.4 — SMS Delivery Safety Change Control
Date: 2026-11-25
Authority: Chairman approval to FIX / TEST / DEPLOY / VERIFY on isolated branch.
Production baseline: `613ce7f1e74f4b1c745e9ca7d59660766afb4547`.
Pre-change recovery branch: `navigator-5.4-sms-prechange-hard-save-20261125`.
Engineering branch: `navigator-5.4-sms-safeguards`.

## Pre-existing owner-check failure (not caused by this change)
Prior to changing files, `npm run verify:owner-protected-followup`
failed: expected `93f53d2f30dc65710b3cb15303ba7cbe24b6814c32882e29db67e8d20522f3b7`,
observed `1a745777ae370a162bcde54acdc41d1c0745d58ac7f78751f3ca2c5c2ad3f64b`.
On 2026-10-23, commit `e116cde5d28d2db41878b5524b265a2f99b75565`
routed weather verification Leads through standard Lead follow-up timing.
That approved working change was made after the original 2026-10-05 checksum,
which was not refreshed. DO NOT revert it to satisfy the old checksum.

Chairman approved SMS safety modifications to AI Follow-Up on November 25.
Accordingly the owner-check checksum was refreshed for this branch only,
with preserved Lead timing, stage re-entry, EMS candidate selection,
quiet hours, and manual pause authority. New scheduler SHA-256:
`d7dddc4f9b9b293d97189237402a477e25fa31e49be508b5cca941ab35f61883`.

## Change boundaries
- Permanently halt Twilio errors 21211, 21265, 21266, 21268, **21610**;
  21610 persists tenant+phone DNC suppression.
- Stop DNC processing before AI outbound message generation; pause job.
- For Twilio transient failures only, cap consecutive attempts at three
  (initial + two retries with five- and fifteen-minute cooldown).
  Never cap successful workflow message count.
- Exclude bot-paused jobs before 500-job selection limit.
- Prevent overlapping passes within one scheduler process.
- Notify existing configured staff email on safety halts.
- OIM gets aggregate-only tenant-scoped SMS submission data via the
  existing service credential; queued is NOT delivered.
- No database schema changes or bulk updates.
- No changed Developer Settings message or timing configuration.
- Do not change Stripe, FOM, PashLoc IV, OIM accepted CRM funnel,
  Social, or inbound customer reply flows.

## Limits and deployment acceptance
The in-process scheduler overlap guard does not coordinate independent
Render instances; verify deployment topology before production rollout.
Provider delivery status callbacks must be verified separately before
reporting *delivered* status. Existing historical July/August failure
events remain in reporting but do not retroactively exhaust the new
policy's retry limits. No live customer messages are sent during smoke tests.

Require isolated TypeScript compile, owner-protected follow-up check,
candidate selection regression, SMS policy smoke, service-contract smoke,
and production deployment verification.
