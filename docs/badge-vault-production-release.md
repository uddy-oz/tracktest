# Badge Vault 2.0 production release

## Scope

The approved Neon Glass Vault, 58 existing badge IDs, five tiers, details,
filters/sorting, local tracking, public/featured collections, queued reveals,
permanent multiplayer records, complete history pagination, and UTC daily goals.
No new achievements or gameplay/audio changes.

The experimental Solo API, its combined migration/tests, and experimental local
Auth services are excluded from this release commit and deployment. Their local
work is retained separately. Existing Solo scores and legacy badge display remain
unchanged and unverified; no new verified Solo awards are minted.

## Database: already applied, DO NOT rerun during frontend deployment

1. `20261101_persistent_achievements.sql`
2. `20261102_daily_challenge_clock.sql`
3. Protected administrator-only legacy checkpoint (outside Git).

Owner-confirmed production checks: all 40 original table fingerprints unchanged;
117 distinct historical unlocks preserved, dates unknown/null; existing awards
unchanged; permissions, RLS, private helpers, triggers and UTC clock verified.
Private checkpoint SHA256:
`dc83fd472c9125bdc7a86c4e16c8e0de53cb6405a4cac1ee769abfd911b1285b`.

Public badge-display fields are intentionally cross-player readable. Anonymous
and authenticated role probes denied internal timestamps, private evidence and
client award mutations. The owner explicitly retained public collections.

Protected backup: `release-20261030-225730/stanzer-fresh.dump`, outside Git.
SHA256: `1dd079bf5ce7ed41090735c9f4d2335b4be14bebc000597379b14c20d3a41a24`.
Fresh isolated restore, seven SQL suites and legacy reconciliation passed.

## Controlled frontend deployment

Keep the existing database maintenance gate enabled. Review/stage only approved
files, test the exact staged tree, commit on `codex/badge-vault-v2`, recheck main
for drift, push branch, and integrate into main without force pushing. Vercel's
existing production-only build rule and Standard Protection remain unchanged.

Rollback reference: Vercel deployment `BAP4JQ9tqv2WRvPzEte1TUTe4iPZ`, main
`81e10d763e8d49e8c5c7cfcda4005e961881eb58`. An old frontend ignores the additive
ledger; it cannot roll back database changes. Never drop awards or restore old
player data merely to undo a UI deployment.

Verify Ready commit, public profile collections, 117 public awards, secure API,
UTC clock, anonymous/registered sessions, desktop/mobile themes and Vault controls.
No reopening until the owner reviews the production verification report.

## Limitations

Tracking is device-local; cloud awards and featured selections persist across
devices. Unknown historical dates are not fabricated. No speculative historical
verified awards. Physical-device and live multiplayer testing remain distinct
from browser viewport tests. The 16 future proposals and Music Missions remain
proposals only in `badge-vault-proposals.md`.

Earlier audit/RC documents describe intermediate development states; this release
manifest supersedes their references to shipping a dormant Solo endpoint.
