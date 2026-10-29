# Multiplayer lifecycle, sound, and search review

Branch: `codex/multiplayer-lifecycle-audio-search`, based on production main
`d233d33`. Implementation and local validation are complete. The user has approved
a direct release, conditional on a fresh verified backup and maintenance checks.

## Confirmed causes and changes

- `arenaRoomSnapshots.ts` treated LEFT as irreversible in a waiting lobby.
  Waiting membership now uses server join/presence/departure timestamps. Match
  generations, phases, completed results, and live scores retain their guards.
- The waiting UI deliberately reused the last departed player in the rival card.
  Only present members occupy slots now. Departure notices appear before lobby
  content rather than below it.
- `forfeit_arena_room` delegated to `leave_arena_room`, setting `left_at` and
  excluding the forfeiter (including the host) from rematches. The new forfeit
  operation locks the room, derives scores from stored counters, resolves only
  the match, and retains membership and host ownership. Explicit Leave/End remain
  separate. Repeated forfeits do not duplicate results.
- Leaving an already-finished room previously returned without updating
  membership. It now records departure without rewriting result fields.
- Hosts could change albums only through the finished-rematch UI. A waiting-only,
  host-authorized RPC now resets readiness and advances the match generation,
  invalidating old prepared sets. The existing album picker checks at least five
  previews before submission; the trusted question API validates the catalog
  again before activation. No client answer keys are accepted.
- A regression test exposed the anonymous progression trigger checking the
  caller's anonymous JWT for *every* result in a trusted completion transaction.
  A guest forfeiter could therefore suppress the registered opponent's result.
  The guard now checks result ownership; guest rows remain excluded and existing
  RLS/authoritative result validation remain in force.
- GO depended on observing countdown zero, which can be bypassed by the phase
  transition. GO now follows authoritative answering activation. Countdown and
  result cues use a per-match/question ledger. Old finished rooms are silent;
  duplicate events do not replay sounds. Muting and genuine gesture priming remain.
- Search removed accented letters instead of folding them. NFKD normalization
  now folds combining marks for comparisons/cache keys, preserves displayed
  catalog names and IDs, and retries the original accented query once on an
  uncached empty result.

## Sound assets

Reviewed [soundcn](https://github.com/kapishdima/soundcn). Its README distinguishes
mostly CC0 sources from the non-freely-licensed World of Warcraft collection.
No sounds or implementation code were copied, and no dependency was installed.
Victory, defeat, and draw use StanZer's existing oscillator-based Web Audio
system. Resume rejections are caught and available through `sounds.getDiagnostics()`.
Music previews, readiness deadlines, synchronized clocks, and scoring are unchanged.

## Database review

Proposed migration: `supabase/20261031_arena_membership_and_match_lifecycle.sql`.
It is transactional and rerunnable. It replaces three lifecycle/guard functions
and adds the narrow waiting-album RPC. It does not rewrite existing results or
delete questions, alter RLS policies, or grant table writes. The new RPC denies
`anon`, grants `authenticated`, and validates ownership/status inside the function.
All changed functions use an empty search path and qualified application objects.

Applied only to isolated local Supabase and a new local clone of the previously
verified production-backup rehearsal. The production maintenance migration was
also installed on that clone to reproduce all six release migrations.

The proposed migration committed and reran successfully. Hashes of every row in
ten application/history tables match the source clone: 16 profiles, 223 results,
32 artist records, 40 album records, 159 rooms, 340 player rows, 2,394 competitive
answers, 119 archived snapshots, and the two empty private question tables.
Historical badge inputs and featured profile selections are included in these
unchanged records. No production connection was used.

This is not a newly captured production backup. Before production approval,
capture a current protected backup and compare deployed function definitions with
the reviewed baseline. Do not run this migration in production yet. A rollback
must restore the previous function definitions from that backup; rolling back
the frontend alone does not reverse a database migration.

## Verification

- Eleven real local Supabase Auth/RPC integration tests cover repeated guest
  rejoin/readiness, host and guest forfeits, retained rematch membership,
  exactly-once registered results, immutable prior-generation results, guest
  progression exclusion, host-only waiting album changes, active-game rejection,
  Group ownership, Party ownership, disconnect grace, and explicit departures.
- Two independent headless Chromium guest sessions exercised the real local app,
  Auth, room APIs, and subscriptions/polling. Three leave/rejoin cycles passed on
  the host without page reload: manual refresh, automatic updates, and temporary
  host offline/recovery. The rival card returns to Waiting for rival and the
  departure notice appears.
- Five existing PostgreSQL security/regression scripts and the new transactional
  lifecycle script passed on the backup-derived clone. The new script verifies
  forfeit during maintenance, anonymous mutation denial, no direct score writes,
  protected answer keys, guest exclusion, preserved history, and rematches.
- Browser Web Audio reached `running` after a genuine click and scheduled 13
  oscillator nodes. Muted cues scheduled none. This is not physical listening.
- Live read-only catalog searches found GIVĒON, Beyoncé, ROSALÍA, and Sigur Rós
  from unaccented queries. Automated tests cover display preservation, equivalent
  comparisons, one alternate query pass, and shared cache keys.
- Existing 18 non-database test commands, additional snapshot/sound tests,
  TypeScript, production build, and lint were run. Lint retains the existing
  35 warnings; no errors were introduced.

Physical phones, audible speaker output, a complete new music match/rematch on
multiple devices, and every mobile browser's autoplay behavior still need manual
validation. Local SQL activation fixtures are synthetic and are not evidence of
end-to-end catalog/audio gameplay.

No historical backfill was performed for registered results previously suppressed
by a guest caller. Do not manufacture old results from a room's latest rematch
state; any recovery needs a separately reviewed, same-generation authority source.

## Local manual review

Open `http://127.0.0.1:4178/multiplayer`. The frontend, question API, and Supabase
use loopback only. Use separate browser profiles or an Incognito session for
independent identities. Mobile emulation is available; physical phones cannot
reach this localhost-only configuration.

1. Host a Duel; join, ready, leave, and rejoin the rival three times.
2. Confirm automatic READY updates, the departure notice, and Waiting for rival.
3. Repeat with host/guest identities reversed and a brief network interruption.
4. Change the waiting album; verify both clients update and readiness clears.
5. Play, forfeit as each role, view results, and open same/new-album rematches.
6. Leave after results; confirm the host can open a new lobby without that player.
7. Repeat lifecycle actions in Group and Party; Party music remains host-only.
8. Listen for 3/2/1, GO, and victory/defeat/draw; test mute, reconnect, and old results.
9. Test the four accented artist pairs from Solo and multiplayer album pickers.

## Changed application files

- `ArenaPage.tsx`: membership slots/notices, waiting album control, cue dispatch.
- `arenaRoomSnapshots.ts`: waiting membership ordering.
- `arenaRooms.ts`: narrow album RPC client.
- `arenaSoundCues.ts`: presentation cue deduplication ledger.
- `sounds.ts`: synthesized outcomes, resume diagnostics.
- `spotifyApi.ts`: Unicode comparisons/cache keys and alternate queries.
- `gameplay.css`: consistent host/player label spacing.
- SQL migration and transactional SQL regression file.
- Lifecycle integration, room snapshot, music search, and sound regression tests.

## Review decision

Ready for the approved release preparation. Do not publish or apply SQL remotely
until the fresh production backup, recovery verification, and maintenance gates
pass. Production actions must use only the reviewed migration.
