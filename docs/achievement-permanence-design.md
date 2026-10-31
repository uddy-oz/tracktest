# Permanent achievements: isolated implementation and remaining decisions

This supplements the original 58-badge audit. Nothing here is deployed. The
20261101 migration is prepared and tested only in `stanz_badge_vault_v2`, an
isolated copy of the previously verified local production-equivalent schema.

## Implemented

### Award records and trust

`public.player_achievements` stores one record per (user_id, badge_id), version,
provenance and award timestamp. Clients cannot insert/update/delete or execute
private awarding helpers. Public reads return only badge IDs, provenance and dates,
never emails, answer keys or private room identifiers. New verified records use
the database clock at the time the award is first recorded, not a guessed earlier
quiz date. Legacy dates remain null. A verified award can upgrade an unverified
legacy record once; repeated evaluation cannot overwrite its verified timestamp.

Award merging is an OR with current progress: a record cannot relock when a
streak ends, a history window shortens or statistics drop. All 58 IDs and tier
weights survive. Current-form / active-streak chips remain live statuses rather
than permanent awards. No rank formula or score/result/featured column is changed.
Permanent earned badges can retain tier contribution after a streak ends; this is
intentional preservation, not a new reward multiplier or duplicate-ID payout.

### Evidence and Party Starter

New qualifying result inserts capture private, immutable evidence with unique
result identity AND (user, room, rematch generation). Guest, incomplete, cancelled,
forfeited and invalid/non-authoritative result paths do not qualify. Multiplayer
thresholds use this evidence, not browser-supplied counters. Server-observed UTC
participation days support permanent attendance milestones. No broad historical
Solo/multiplayer event backfill is attempted.

Party host completion is an additive room-status observer. It requires an active
Party reaching the final question and finished phase, a registered host, and at
least one actual nondeparted participant answer in that generation. Opening a
room, cancelling, leaving, or an entirely skipped/no-answer party is insufficient.
It awards the host without fabricating a scored host result. Room Controller keeps
its existing participant-count predicate; its description now accurately excludes
the host. No audio, readiness, timer or score functions were modified.

Post-result triggers award immediately. An own-user reconciliation RPC (no badge,
score or target identity parameters) safely recomputes from evidence on profile
refresh/reconnect and serializes simultaneous refreshes. Duplicate delivery and
20 concurrent REST reconciliations were tested without duplicate awards or date
changes. Award mutations remain server-only.

### Preservation without fabricated history

The initial migration preserves existing featured badge references as explicit
`legacy_preserved` claims, with unknown dates, once only. It does not treat those
claims as verified evidence and does not rewrite the featured array. Unknown IDs
are not imported. The client also retains previously observed earned IDs in a
separate per-registered-user browser cache. That cache cannot label itself verified
or submit awards to the server. Public profiles read the cloud award ledger;
owners use the same ledger plus honestly labeled device-local legacy observations.

### Daily goals

Goals use [00:00 UTC, next 00:00 UTC), with IDs deduplicated and invalid, future,
zero-question and unfinished results excluded. Five Perfect Albums requires five
distinct artist/album keys today. Fast Perfect requires a valid perfect Solo run
today. Beat Your Best compares a today's run against earlier observed scores, not
timesPlayed. Arena wins require eligible completed Duel/Group results today.
Championship goals remain Coming Soon. UTC midnight and returning from a sleeping
tab refresh the goals. These calculations display progress; they award no badges,
currency or rank changes, and are not a replacement for verified Solo telemetry.

### Achievable completion

The three Championship badges say Coming Soon and are excluded from the collection
percentage and per-tier denominators, including when a legacy claim exists. Such
claims remain visible/owned. Party Starter is available only when the new ledger
RPC is present. With that migration installed there are 55 currently achievable
definitions and 58 catalogued definitions. Missing migration degrades safely to
54 achievable, without making a database or gameplay request fail.

## Duplicate consolidation proposal (NOT applied)

| Existing IDs | Proposal | Compatibility rule |
|---|---|---|
| discography-demon / five-artist-club | One five-artist milestone with two legacy editions | Keep both IDs, tiers and existing tier score; do not silently subtract rewards |
| hot-hand / three-peat | One three-win milestone family | Keep two legacy records and featured references; future catalog alias only after approval |
| on-fire-multiplayer / arena-dynasty | One five-win milestone family | Same preservation rule; no reward recalculation in this branch |
| perfect-run / flawless-album | Distinguish run perfection vs durable album mastery in a future version | Current predicates stay intact; new version needs approval and migration policy |
| photo-finish / close-call | Separate general one-round win vs Duel specialist | Preserve legacy scoring-era <=500-point definition; do not reinterpret old rows |

## NOT fully resolved / do not claim otherwise

1. Solo is client-reported. It is not safe to mint newly verified Solo achievements
   from those rows. A trusted Solo completion protocol or explicit acceptance of
   unverified Solo awards is a separate product/security decision.
2. There was no durable historical unlock ledger. Unfeatured achievements that
   already vanished before this checkpoint cannot be reconstructed universally.
   Local observations are preserved on that device; they are NOT automatically
   imported as new cloud awards. Cross-device permanence is proven for cloud records,
   not for every old device-only observation. A reviewed legacy reconciliation
   policy is required before promising universal historical recovery.
3. Verified counters begin with post-install evidence. Existing raw progress is
   still shown and preserved, but historical thresholds cannot all be promoted to
   verified dates/awards without an evidence-quality review. No dates were invented.
4. Public profile/history APIs and the existing own-history query can be capped by
   PostgREST. Beat-best explicitly says available history. Full-history pagination
   and stable catalog IDs are needed for a complete personal-best verification claim.
5. Duplicate badge rewards are retained, not removed. Consolidation is a proposal.
6. The event observers currently share the result transaction: SQL suite passed,
   but additional hosted/real-device QA and performance testing are required before
   production approval. No claim of real mobile/Auth UI testing in this pass.
7. Server-verified does not mean collusion-proof. Distinct legitimate rematches
   still count under existing rules; win-trading/rate-limiting policies need product
   approval. Duplicate delivery of the same match does not create new evidence.

## Current frontend verification and preview

Build/TypeScript and all 18 existing non-database regression commands passed,
along with 6 vault and 5 permanence/calendar tests. ESLint: zero errors, 35 existing
gameplay hook warnings. Chromium checked 360, 390, 430, 768 and 1440px in both
themes; dialog keyboard containment, tracking reload, empty/filter states, contrast
base surfaces and no horizontal overflow passed. Local preview remains at
http://127.0.0.1:4182/tools/badge-vault-preview.html (explicit sample data, no production
Supabase). Simulate streak reset demonstrates preserved legacy badges; real verified
records/dates were tested through the separate isolated REST service, not fabricated
in the preview. Updated screenshots are outside Git in
`%LOCALAPPDATA%/StanZer/ui-qa/badge-vault-v2/permanence/`.

## Tests actually executed

- Transactional migration installation and rerun both COMMIT on the isolated clone.
- Profiles, quiz_results, artist_stats, album_stats, arena_rooms, arena_room_players
  and archived historical questions matched the untouched clone before fixtures.
- Six PostgreSQL suites: existing authority, answer secrecy, disconnect/reconnect,
  RPC privileges, membership/rematches and new achievements: PASS, rolled back.
- Real PostgreSQL result triggers generated a Duel award and Party host award from
  privileged canonical fixtures. Those fixtures do not claim a real browser game.
- Separate loopback-only PostgREST connected only to the clone: independent signed
  test sessions read the same records; 20 parallel own-user reconciliations passed;
  direct forged award writes and anonymous-user awards rejected; duplicate result
  synchronization retained original timestamps. Tokens were test-signed with the
  existing LOCAL stack key, not obtained via a real login UI. Test REST was stopped
  and temporary credential file removed afterward. No production keys were used.
  The REST test commits disposable fixtures only to this clone to test persistence
  across connections; the six SQL suites roll their own fixtures back.
- Unit tests: permanence after reset/reconnect/serialization; guest/identity
  separation; malformed records; exact UTC boundaries; unique albums; duplicate
  results; real score improvement; Coming Soon denominator; legacy featured IDs.
- Full frontend/regression/build results are in the handoff report. Pending staging
  approval is not an instruction to apply this migration to production.

## Rollout and rollback planning (not authorization)

Review the legacy policy and Solo scope first. Rehearse on a fresh isolated clone,
then obtain approval for deployment. Migration is additive and rerunnable, with
BEGIN/COMMIT. Existing data is not rewritten. A frontend rollback can ignore the
ledger but would lose its permanence UI, so retain the records. If an observer
needs disabling, an approved follow-up can remove just the two new observers while
keeping the tables/awards. Do not delete award history to roll back.

## Follow-up validation

See [the final security and real-account review](badge-vault-final-security-review.md)
for completed historical pagination, genuine local GoTrue Auth/browser testing,
the server-defined daily clock, and the default-off secure Solo backend pilot.
That report supersedes the earlier pagination and simulated-auth limitations in
this document. Solo frontend integration remains explicitly incomplete.
