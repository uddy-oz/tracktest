# Solo Shareable Challenges

## What the link contains

A completed Solo run can publish a seven-day bearer link. Its random UUID identifies
the challenge, not the creator or an answer key. Anyone with the link can read
the album, displayed creator name, target score, answer count, and expiration.
The invitation does not include media URLs, answer choices, or private IDs.
Guests use the existing anonymous Supabase login and chosen display name.
Seven days gives friends time to respond without making the invitation permanent.
Use **Create New Link** while the results are still open to publish a fresh
invitation, including after the old one expires. This does not extend or
revoke the old link. After leaving results, finish a new run to share again.

Solo history stores scores and summaries, not question order, choices, or
clip offsets. Only a new, completed run with a full in-memory snapshot can be
shared. Runs with skipped clips cannot be published. The snapshot uses the
questions that were actually played, including any pre-playback replacement.

## Replay and trust

The existing Solo engine runs the replay with the recorded question order, choice
order, preview URL, and intended seek offset. Answer time is taken before
requesting the reveal so reveal latency cannot change a player's earned points.
An unplayable challenge clip ends the attempt without declaring a winner.
Replaying the album as ordinary Solo starts a new randomized run instead.

The server stores immutable snapshots outside the exposed API schema. Its
authenticated RPCs bind attempts to the caller, restrict reads to the current
question, and release only that answer after the question has been opened and
the minimum preparation window has elapsed. They do not verify when browser
playback actually starts or prove that a human submitted an answer. A
determined player can inspect a preview URL, submit an early reveal request
after the server window, or replay a challenge and memorize it.

The target is browser-reported, and replay scores are computed in the browser.
Neither is represented as independently verified. Replay comparison results
are not written to quiz history, Daily Goals, leaderboards, badge evidence, or
achievements. Standard Solo scoring and saves are not changed.

## Local Testing And Release

Apply only `supabase/20261123_solo_shareable_challenges.sql` to an isolated
StanZer Supabase database with the existing `auth.users` and `public.profiles`.
The migration adds a private schema, two RLS-enabled tables and five RPCs;
it does not alter existing result or progression tables. The migration is
transactional, but not intended to be reapplied after success.

Run `npm run test:solo-challenges-integration` with `LOCAL_URL`, `LOCAL_ANON`,
`LOCAL_SERVICE` and `CHALLENGE_LOCAL_CONTAINER` pointing to the loopback test
stack. The service key is test-runner only and must not be in Vite settings.

The server limits sharing to 10 challenges per identity per day and playback
to 30 attempts per identity per day. Attempts are playable for up to one hour.
These are per-account limits, not protection against automated creation of many
guest identities. Expiration blocks access, but does not automatically delete
records. The first release deliberately defers automatic cleanup: no records
are deleted at expiry. Snapshots, display names and attempt records remain in
the private database and backups, so monitor storage growth and revisit
retention and abuse controls after launch.

## Physical Phone QA

The local QA preview uses generated clips and disposable local accounts.
It is not a public staging site. On Android, connect USB to the trusted Windows
laptop and follow [Chrome's USB debugging setup](https://developer.chrome.com/docs/devtools/remote-debugging).
In desktop Chrome's `chrome://inspect/#devices` port forwarding dialog, set
`4188` to `127.0.0.1:4188` and `54321` to `127.0.0.1:54321`.
Open `http://127.0.0.1:4188/play` in Android Chrome while connected.
Finish the StanZer Phone QA album, create an invite, and use Copy Link and
Share Challenge. Send it to yourself in WhatsApp and another messenger.
Open it on the USB-forwarded phone in Chrome, try an independent guest
session, and verify audible playback, comparison and readability. Test opening
inside the messaging app separately; if it blocks loopback, use Open in Chrome.
These links cannot reach another phone without its own forwarding setup.
Use a separately approved isolated HTTPS preview for cross-device or iOS
testing; never expose the local database, admin services, or production data.
Disable USB forwarding and debugging when finished.

## Disabled Production Release

Ship the prepared frontend with `VITE_ENABLE_SOLO_CHALLENGES=false` (the
default if unset). Do not apply the challenge migration in this release.
The flag hides creation and shows an unavailable screen at direct invitation
URLs without requesting challenge metadata. It is not an API security control.
The database control is that neither the private schema nor the five RPCs
are installed. Staging and local QA may apply the unchanged migration and
build with the flag set to `true` for generated or authorized audio only.

Before deploying, confirm on the correct production project that
`to_regnamespace('solo_challenge_private')` is NULL and that all five RPC
signatures in the reviewed migration are absent. Stop if anything is already
installed; inspect its privileges rather than assuming the flag blocks access.
Record the current Ready deployment. Deploy the disabled build, confirm ordinary
Solo and multiplayer still load, and check that a direct challenge URL shows
the unavailable state without making a challenge RPC call. Check a bare
authenticated API request is not routable without creating a challenge.
Check existing public history, leaderboards and the Daily Goals clock before
and after. Roll back this frontend-only release to the recorded deployment;
there is no SQL rollback. Do not change production credentials or data.

If an activated release later needs to close access, use
`supabase/operations/disable_solo_challenges.sql` with separate authorization.
It revokes execution on only the five challenge RPCs without deleting records.
Verify denial via direct unauthenticated and authenticated requests, then
redeploy with the flag off or restore the recorded frontend. An older frontend
or a stale browser bundle cannot reopen access on its own.

## Activation Checklist

1. Resolve the [separate music rights release gate](./challenge-preview-rights.md).
   Test playback, clipboard, native sharing, and direct links on physical
   iOS and Android devices, including a messaging app's embedded browser.
2. Take a fresh protected backup for the verified StanZer production project
   using the hidden local password prompt. Verify the archive checksum, roles
   export and full decompression; rehearse the exact migration on a
   network-isolated restore. Compare counts and fingerprints on existing
   Auth, public, and Arena tables and confirm the Daily Goals clock and legacy
   policies and grants are unchanged.
   Verified backup: `release-20261123-214248`, archive SHA-256
   `10958fdc226879500dda62255c93c13acd89aed6a830c45112291ae806de1c71`.
   The isolated restore matched 45 existing table fingerprints.
3. With separate activation approval, confirm baseline and migration checksum
   `6920f9ecddfdd2b2a6d658e48c6f22e0bb200721d9962b17a8f7dacd58cd14f8`,
   record the current Ready Vercel deployment, and apply only the reviewed
   challenge transaction. Verify both private tables are empty and RLS-enabled,
   all five functions have a fixed search path, and only the invitation lookup
   is executable by the unauthenticated role. Confirm the old frontend still
   loads. No multiplayer maintenance window should be needed for additive DDL
   if the migration can acquire its locks promptly; stop on contention.
4. Deploy the matching frontend with `VITE_ENABLE_SOLO_CHALLENGES=true`.
   The exact reviewed migration grants client API access on commit; do not
   apply it during the disabled release or before audio rights clearance.
   Smoke-test the deep link, a registered creator,
   guest replay, share/copy, and unchanged standard Solo saves and multiplayer
   access. Use approved disposable identities only.
5. To roll back, restore the preceding frontend and keep existing challenge
   records intact. The preceding frontend does not depend on the new objects.
   For a security incident, also revoke execute on the five new RPCs from
   their granted client roles in a reviewed transaction; verify existing
   functions retain their grants. Avoid dropping tables or restoring the
   entire production database to reverse this feature.
