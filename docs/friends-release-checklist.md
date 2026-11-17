# Friends production release checklist

Do not apply SQL or deploy until both are explicitly approved. The current
Vercel recovery reference is the approved Solo/Daily Goals release `b999ffc`;
reconfirm its Ready deployment, production domain and GitHub `main` before
cutover. Do not change Preview settings or reuse them for production.

## Migration inventory

`supabase/20261117_unified_friends_rooms.sql` (SHA256
`0aa5d6dee262211a1266dc104a606f03009512ec3caa3e8c0fc694c79cde6122`):

| Object | Change |
| --- | --- |
| `public.arena_rooms` | Adds `unified_friends boolean NOT NULL DEFAULT false`; no base row is explicitly updated by the migration. |
| `public.create_friends_room(text,text,text,text,boolean,text,text)` | New authenticated-only definer wrapper around existing atomic room creation. After creation, sets the new flag and requested privacy, retaining the allocated code. |
| `public.activate_friends_question_set(uuid,uuid,uuid[],text)` | New authenticated-only definer wrapper with a fixed empty search path. Locks room and trusted set; verifies caller, generation, album and roster; uses the existing trusted activation. Only at runtime, changes that room and trusted set to Duel for two participants. |
| `arena_private.reset_friends_waiting_format()` | Private trigger function, no direct client execution. The `reset_friends_waiting_format` trigger on room status/generation returns marked rooms to waiting Group format on rematch only. |
| `public.public_profile_recent_results` | Same columns/grants; uses the saved generation's result mode for Friends results. Legacy rooms retain their prior lookup behavior. |

No new tables, indexes, keys, check constraints, table grants, or RLS policies.
No DDL on `arena_private.question_sets`; only a protected runtime update for
the selected set. No migration writes to profiles, results, achievements, or
Daily Goals. The existing clock and scoring/award functions are unchanged.
The transaction bounds lock waits to three seconds and sends one PostgREST
schema reload notification on commit. It removes inherited execute grants
from `PUBLIC`, `anon` and `service_role` for the new functions; only
`authenticated` has a client grant on the two public wrappers.

## Before approval

### November 17 Fresh Backup Verification

Protected folder: `release-20261117-222903` outside Git. The archive is
1,853,147 bytes, matches its manifest SHA256, passes full decompression,
and includes a successful roles-without-passwords export. SHA256:
`0b54097805e8498cb7f57750335668e1549c245632acdad4bd16504ab45243a1`.

Restored actual `auth`, `public`, `arena_private` and any included
`supabase_migrations` objects/data into a new PostgreSQL 17 container with
network mode `none` and no published ports. Restored role names as local
NOLOGIN placeholders, not production cluster membership or credentials.
The original backup was mounted read-only. All 45 restored table fingerprints
matched before/after the exact Friends migration and its repeat application.
Recovered counts include 159 Auth users, 20 profiles, 307 quiz results,
128 permanent awards, 200 rooms, 438 memberships and 119 archived question
snapshots. Public history rows and RLS policies were unchanged. Private
answer keys, trusted achievement evidence and artist/album stats were included.

Compared the restored baseline against current production via read-only
catalog queries: normalized 384 columns, 92 constraints, 81 functions plus
execution grants and owners, 17 policies, 29 relations with effective grants,
ownership/RLS, 22 triggers and 11 views matched. Database-name metadata,
ACL ordering, and implicit versus explicit owner grants were normalized;
no production SQL writes were issued.

Database gate: GO for the exact reviewed checksum, subject to explicit
production execution approval and a final project/checksum/quiet-window
check. Physical multi-device audio/Realtime remains a manual release risk.
This is verified application/Auth recovery, not a claim of whole-platform
restoration: managed Storage/Realtime/Vault internals and production global
role memberships were not replayed. Storage object bytes need their own
backup if recovery of that resource is required. No such resources are
modified by this migration. The isolated restore container is stopped.

The rehearsal used schema/ACLs from the October 30 protected production
archive (no production player rows), local managed Auth, and the two
subsequently released achievement/clock migrations. Synthetic profiles,
completed Duel and Group results, awards and evidence were fingerprinted
before and after both the migration and its repeat apply. Their fingerprints,
the legacy history view output, the clock, RLS and existing constraint
definitions matched. The exact migration rejected a deliberately busy room
lock in about 3.5 seconds with no commit. This does not replace checking the
current production archive or running real-device Realtime/audio QA.

- [ ] Produce a fresh archive of `TrackTest Arena` (`lumpiczmiiikxsuqsvro`)
  using the protected AppData script and hidden local password prompt. Validate
  SHA256, archive TOC, decompression, and isolated application recovery.
  Include roles without passwords and note managed schema/Storage limitations.
- [ ] Confirm the fresh archive's app schema, view signature, owners and
  effective grants match the rehearsal. Rehearse the exact hash again if
  anything relevant differs. Do not transfer real player rows into the test
  fixture; use a separate restricted recovery check for any backup data.
- [ ] Run the preservation fingerprints, lock-timeout check, Friends suite,
  legacy lifecycle/maintenance suites, and frontend checks. Complete a
  real-device test of Realtime roster and audio behavior before GO.
- [ ] Freeze only the reviewed files in a clean release candidate. Confirm
  `git diff --check`, tests, `npm run lint`, `npm run build`, and no secrets,
  local QA artifacts, experimental Solo verifier or other migrations.

## Approved cutover order

1. Record the approved fresh backup and exact preceding Vercel deployment.
   Apply the database transaction **before** the matching frontend. The
   reviewed new frontend needs these two RPCs; do not deploy it first.
2. Use a quiet window; existing rooms need not be closed for additive DDL.
   In the authenticated release `psql` session for the verified StanZer
   project, use `\set ON_ERROR_STOP on`, verify
   the rehearsed checksum inside the actual container/mount, and execute only
   the checked migration with `\i`. The file already supplies `BEGIN` and
   `COMMIT`; do not add a nested transaction. Its timeout is transaction
   scoped. On an error, stop; issue
   `ROLLBACK` if the prompt is in an aborted open transaction. Do not retry
   repeatedly during traffic.
3. Verify new function grants, marker default, history view, PostgREST
   reload and unchanged legacy behavior before deploying `main`. No
   broad maintenance window is expected; if incompatible drift or recurring
   locks are found, halt and agree a short window instead of bypassing guards.
4. Deploy the exact matching frontend through the existing Vercel production
   project. Verify old links, new public/private codes, guest + registered
   entry, one lobby moving from two to three, one full match in each format,
   scored results, rematch, and existing histories and Daily Goals.

## Rollback

- Before SQL commit: abort or roll back the transaction; do not deploy.
- After SQL commit but before new Friends rooms: restore the former frontend
  if necessary, and leave the inactive additive database objects installed.
- After any Friends generation is played: with separate approval, disable
  new Friends room creation by revoking only authenticated execution of
  `public.create_friends_room(text,text,text,text,boolean,text,text)`. Drain
  active games using the matching app where possible, resolve waiting rooms
  through normal room controls, then restore the previous Ready Vercel
  deployment. For a critical frontend incident, restoring availability can
  take priority over draining; keep the database and records intact.
- Keep the marker and history view after real Friends results exist. Dropping
  them or restoring the old view can relabel a saved Duel as Group after a
  rematch. A frontend rollback does not undo newly earned scores or awards.
  Do not restore the full backup to revert this feature: it would also roll
  back legitimate player activity after the snapshot.
