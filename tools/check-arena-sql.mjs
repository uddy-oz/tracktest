import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/20260922_competitive_round_phase_race_fix.sql", import.meta.url),
  "utf8"
);
const authority = readFileSync(
  new URL("../supabase/20260916_competitive_round_authority.sql", import.meta.url),
  "utf8"
);
const lobbyAudioGate = readFileSync(
  new URL("../supabase/20260923_competitive_lobby_audio_gate.sql", import.meta.url),
  "utf8"
);
const lobbyStartReliability = readFileSync(
  new URL("../supabase/20260926_arena_lobby_start_reliability.sql", import.meta.url),
  "utf8"
);
const audioReservePipeline = readFileSync(
  new URL("../supabase/20260926_competitive_audio_reserve_pipeline.sql", import.meta.url),
  "utf8"
);
const audioFastFail = readFileSync(
  new URL("../supabase/20261005_competitive_audio_fast_fail.sql", import.meta.url),
  "utf8"
);
const lobbyReadinessAndPresence = readFileSync(
  new URL("../supabase/20261005_arena_lobby_readiness_and_presence.sql", import.meta.url),
  "utf8"
);
const readyAckReconciliation = readFileSync(
  new URL("../supabase/20261006_competitive_audio_ready_ack_reconciliation.sql", import.meta.url),
  "utf8"
);
const multiplayerProgression = readFileSync(
  new URL("../supabase/20261007_multiplayer_progression_and_leaderboards.sql", import.meta.url),
  "utf8"
);
const multiplayerAuthoritySecurity = readFileSync(
  new URL("../supabase/20261026_multiplayer_authority_and_atomic_membership.sql", import.meta.url),
  "utf8"
);
const arenaRoomsClient = readFileSync(
  new URL("../src/lib/arenaRooms.ts", import.meta.url),
  "utf8"
);
const arenaSecurityPermissionProbe = readFileSync(
  new URL("../supabase/tests/20261026_multiplayer_authority_permissions.sql", import.meta.url),
  "utf8"
);

assert.match(migration, /^begin;/i, "migration must begin transactionally");
assert.match(migration, /commit;\s*$/i, "migration must commit transactionally");
assert.match(
  migration,
  /competitive_round_phase <> 'preparing_audio'/,
  "global skips must close when preparation ends"
);
assert.match(audioReservePipeline, /^begin;/i, "reserve pipeline must begin transactionally");
assert.match(audioReservePipeline, /commit;\s*$/i, "reserve pipeline must commit transactionally");
assert.match(
  audioReservePipeline,
  /competitive_reserve_questions jsonb not null default '\[\]'::jsonb/,
  "reserve questions must be persisted separately from scored questions"
);
assert.match(
  audioReservePipeline,
  /quiz_questions = jsonb_set/,
  "candidate recovery must atomically promote a reserve"
);
assert.match(
  audioReservePipeline,
  /competitive_round_id = replacement_round_id/,
  "replacement candidates need a fresh immutable round token"
);
assert.match(
  audioReservePipeline,
  /competitive_round_phase <> 'preparing_audio'/,
  "replacement must close once countdown starts"
);
assert.match(
  audioReservePipeline,
  /if target_room\.status = 'starting' then\s+return false;/,
  "pre-game exhaustion must not create a scored skip"
);
assert.doesNotMatch(
  audioReservePipeline,
  /party_mode/,
  "Party Mode must remain on its host-only audio path"
);
assert.match(audioFastFail, /^begin;/i, "fast-fail migration must begin transactionally");
assert.match(audioFastFail, /commit;\s*$/i, "fast-fail migration must commit transactionally");
assert.match(
  audioFastFail,
  /maximum_deadline timestamptz := clock_timestamp\(\) \+ interval '4 seconds'/,
  "silent clients must not hold a later round for the legacy 12-second window"
);
assert.match(
  audioFastFail,
  /new\.mode in \('duel', 'group_lobby'\)/,
  "the deadline clamp must apply to competitive modes"
);
assert.doesNotMatch(
  audioFastFail,
  /party_mode/,
  "Party Mode must remain on its separate host-only timeline"
);
assert.match(
  audioFastFail,
  /drop trigger if exists clamp_competitive_audio_ready_deadline/,
  "the fast-fail trigger must be safe to rerun"
);
assert.doesNotMatch(
  migration,
  /competitive_round_phase not in\s*\(\s*'preparing_audio',\s*'countdown',\s*'answering'/,
  "countdown and answering must never be skippable by readiness"
);
assert.match(lobbyStartReliability, /^begin;/i, "lobby reliability migration must begin transactionally");
assert.match(lobbyStartReliability, /commit;\s*$/i, "lobby reliability migration must commit transactionally");
assert.doesNotMatch(
  lobbyStartReliability,
  /if target_room\.host_user_id = auth\.uid\(\) then\s+return target_room\.id/,
  "private-room hosts must reach the authoritative membership upsert"
);
assert.match(
  lobbyStartReliability,
  /user_id = auth\.uid\(\)/,
  "invite membership must remain bound to the authenticated user"
);
assert.match(
  migration,
  /'readinessClosed', true/,
  "late failure reports must be explicit no-ops"
);
assert.match(
  migration,
  /sync_competitive_arena_timeline_v2/,
  "stale timeline sync needs a non-throwing boundary"
);
assert.match(
  authority,
  /round_number = coalesce\(round_number, 1\) \+ 1/,
  "rematches must increment the match generation"
);
assert.match(
  authority,
  /competitive_round_id = null/,
  "rematches must clear the previous round token"
);
assert.match(lobbyAudioGate, /^begin;/i, "lobby audio gate must begin transactionally");
assert.match(lobbyAudioGate, /commit;\s*$/i, "lobby audio gate must commit transactionally");
assert.match(
  lobbyAudioGate,
  /status = 'starting'/,
  "round one must be staged before the room becomes active"
);
assert.match(
  lobbyAudioGate,
  /required_count < minimum_players or ready_count < required_count/,
  "the server must reject a start before every active player is ready"
);
assert.match(
  lobbyAudioGate,
  /server_starts_at := clock_timestamp\(\) \+ interval '3 seconds'/,
  "the shared countdown must be scheduled only after the gate opens"
);
assert.doesNotMatch(
  lobbyAudioGate,
  /party_mode/,
  "Party Mode must remain on its host-only audio timeline"
);

assert.match(
  lobbyReadinessAndPresence,
  /^begin;/i,
  "lobby lifecycle migration must begin transactionally"
);
assert.match(
  lobbyReadinessAndPresence,
  /commit;\s*$/i,
  "lobby lifecycle migration must commit transactionally"
);
assert.match(
  lobbyReadinessAndPresence,
  /lobby_ready boolean not null default false/,
  "lobby intent must remain separate from first-track audio acknowledgement"
);
assert.match(
  lobbyReadinessAndPresence,
  /ready_count <> required_count/,
  "the server must reject competitive starts until every member is ready"
);
assert.match(
  lobbyReadinessAndPresence,
  /connected_count <> required_count/,
  "the server must reject starts while a required player is reconnecting"
);
assert.match(
  lobbyReadinessAndPresence,
  /presence_updated_at <= server_now - interval '12 seconds'/,
  "short disconnects must enter a reconnecting grace state"
);
assert.match(
  lobbyReadinessAndPresence,
  /presence_updated_at <= server_now - interval '45 seconds'/,
  "expired disconnect grace must reconcile authoritative membership"
);
assert.doesNotMatch(
  lobbyReadinessAndPresence,
  /set\s+host_user_id/i,
  "room ownership must never migrate"
);
assert.match(
  lobbyReadinessAndPresence,
  /after update of round_number/,
  "a new match generation must clear old readiness"
);
assert.match(
  lobbyReadinessAndPresence,
  /close_reason = 'host_disconnected'/,
  "host disconnect expiry must leave an authoritative close reason"
);
assert.match(
  lobbyReadinessAndPresence,
  /create or replace function public\.end_arena_room/,
  "intentional host shutdown must use the same authoritative cleanup path"
);

assert.match(
  readyAckReconciliation,
  /^begin;/i,
  "readiness ACK reconciliation must begin transactionally"
);
assert.match(
  readyAckReconciliation,
  /commit;\s*$/i,
  "readiness ACK reconciliation must commit transactionally"
);
assert.match(
  readyAckReconciliation,
  /add column if not exists acknowledgement_count/,
  "readiness diagnostic columns must be safe to rerun"
);
assert.match(
  readyAckReconciliation,
  /'accepted', true,[\s\S]*'alreadyReady', already_ready/,
  "ACK responses must report accepted and idempotent readiness"
);
assert.match(
  readyAckReconciliation,
  /if not already_ready\s+and target_room\.competitive_round_phase <> 'preparing_audio'/,
  "an existing current-round ACK must remain successful after countdown starts"
);
assert.match(
  readyAckReconciliation,
  /coalesce\(target_room\.round_number, 1\) <> target_match_generation/,
  "ACKs must be bound to the current match generation"
);
assert.match(
  readyAckReconciliation,
  /on conflict \(room_id, room_round_number, round_id, user_id\)[\s\S]*readiness_status = 'ready'/,
  "ACK writes must be idempotent"
);
assert.match(
  readyAckReconciliation,
  /get_competitive_audio_readiness_state/,
  "development diagnostics need authoritative per-player readiness"
);
assert.doesNotMatch(
  readyAckReconciliation,
  /email/i,
  "readiness diagnostics must never expose email addresses"
);
assert.doesNotMatch(
  readyAckReconciliation,
  /party_mode/,
  "Party Mode must remain on its host-only audio path"
);

assert.match(
  multiplayerProgression,
  /^begin;/i,
  "multiplayer progression must begin transactionally"
);
assert.match(
  multiplayerProgression,
  /commit;\s*$/i,
  "multiplayer progression must commit transactionally"
);
assert.match(
  multiplayerProgression,
  /if not is_existing_result and target_room\.status <> 'finished'/,
  "new progression rows must require an authoritative finished room"
);
assert.doesNotMatch(
  multiplayerProgression,
  /where id = new\.arena_room_id\s+and status = 'finished'/,
  "a live rematch must not invalidate an older completed generation"
);
assert.match(
  multiplayerProgression,
  /coalesce\(registered_user\.is_anonymous, false\)/,
  "guest accounts must not qualify for permanent progression"
);
assert.match(
  multiplayerProgression,
  /new\.scoring_model <> 'round_points'/,
  "legacy Duel and Group points must not become round progression"
);
assert.match(
  multiplayerProgression,
  /new\.rounds_won := greatest\(coalesce\(target_player\.rounds_won, 0\), 0\)/,
  "career progression must overwrite browser claims with authoritative player results"
);
assert.match(
  multiplayerProgression,
  /new\.arena_round_number := old\.arena_round_number/,
  "historical backfills must preserve each saved rematch generation"
);
assert.match(
  multiplayerProgression,
  /new\.played_at := old\.played_at/,
  "historical backfills must preserve the original match timestamp"
);
assert.match(
  multiplayerProgression,
  /set competitive_progression_eligible = competitive_progression_eligible/,
  "historical backfill must touch a derived field instead of match identity"
);
assert.doesNotMatch(
  multiplayerProgression,
  /set played_at = played_at/,
  "historical backfill must not target an identity/result field"
);
const historicalReturnIndex = multiplayerProgression.indexOf(
  "    return new;\n  end if;\n\n  select * into target_player"
);
const currentGenerationRewriteIndex = multiplayerProgression.indexOf(
  "new.arena_round_number := coalesce(target_room.round_number, 1)"
);
assert.ok(
  historicalReturnIndex > 0 &&
    historicalReturnIndex < currentGenerationRewriteIndex,
  "historical rows must return before the current-generation authoritative rewrite"
);
const rematchKeys = [1, 2, 3].map(
  (generation) => `room-a:${generation}:user-a`
);
assert.equal(
  new Set(rematchKeys).size,
  3,
  "three rematch generations must remain distinct under the persistent identity key"
);
assert.match(
  multiplayerProgression,
  /new\.rounds_won > 0[\s\S]*opponent_wins = 0/,
  "Clean Sheets depend on scored opponent wins, not unclaimed rounds"
);
assert.match(
  authority,
  /unique index if not exists quiz_results_arena_round_user_unique_idx/,
  "existing authoritative persistence must remain rematch-idempotent"
);
assert.doesNotMatch(
  multiplayerProgression,
  /drop index[\s\S]*quiz_results_arena/i,
  "the progression migration must not weaken the deployed rematch identity"
);
assert.doesNotMatch(
  multiplayerProgression,
  /email/i,
  "public competitive rankings must never expose email addresses"
);

assert.match(
  multiplayerAuthoritySecurity,
  /^begin;/i,
  "authority hardening must run transactionally"
);
assert.match(
  multiplayerAuthoritySecurity,
  /commit;\s*$/i,
  "authority hardening must commit transactionally"
);
assert.match(
  multiplayerAuthoritySecurity,
  /revoke insert, update, delete, truncate on table public\.arena_rooms\s+from public, anon, authenticated/i,
  "clients must not mutate room rows directly"
);
assert.match(
  multiplayerAuthoritySecurity,
  /revoke insert, update, delete, truncate on table public\.arena_room_players\s+from public, anon, authenticated/i,
  "clients must not mutate player or score rows directly"
);
assert.match(
  multiplayerAuthoritySecurity,
  /revoke all \(%i\) on table %s from public, anon, authenticated/i,
  "historical column-level mutation grants must also be removed"
);
assert.match(
  multiplayerAuthoritySecurity,
  /create or replace function public\.create_arena_room[\s\S]*?insert into public\.arena_rooms[\s\S]*?insert into public\.arena_room_players/i,
  "room and host membership must be created in one server transaction"
);
assert.match(
  multiplayerAuthoritySecurity,
  /create or replace function public\.join_arena_room_internal[\s\S]*?pg_advisory_xact_lock[\s\S]*?for update[\s\S]*?active_count >= target_room\.max_players/i,
  "membership joins must serialize per user, lock the room, and enforce capacity"
);
assert.match(
  multiplayerAuthoritySecurity,
  /create or replace function public\.set_arena_guest_display_name[\s\S]*?caller_is_anonymous[\s\S]*?set display_name = clean_display_name/i,
  "guest display correction must be anonymous-only and isolated from gameplay columns"
);
assert.doesNotMatch(
  arenaRoomsClient,
  /\.from\("arena_(?:rooms|room_players)"\)\s*\.(?:insert|update|upsert|delete)\(/,
  "frontend must not directly mutate protected room tables"
);
assert.match(
  arenaRoomsClient,
  /rpc\(\s*"create_arena_room"/,
  "frontend creation must use the atomic server operation"
);
assert.match(
  arenaRoomsClient,
  /rpc\(\s*"join_public_arena_room"/,
  "public joins must use the atomic server operation"
);
assert.doesNotMatch(
  multiplayerAuthoritySecurity,
  /correct_answer|quiz_questions\s*=/i,
  "PR 1 must not alter the separately tracked shared-answer secrecy issue"
);
assert.match(
  arenaSecurityPermissionProbe,
  /has_table_privilege\('authenticated',[\s\S]*'UPDATE'\)/,
  "staging probe must verify effective authenticated table privileges"
);
assert.match(
  arenaSecurityPermissionProbe,
  /has_column_privilege\('authenticated',[\s\S]*'UPDATE'\)/,
  "staging probe must verify effective column-level privileges"
);
assert.match(
  arenaSecurityPermissionProbe,
  /pg_catalog\.pg_policies[\s\S]*p\.cmd in \('INSERT', 'UPDATE', 'ALL'\)/,
  "staging probe must detect any remaining mutating RLS policies"
);

console.log("Arena SQL lifecycle and authority guards passed.");
