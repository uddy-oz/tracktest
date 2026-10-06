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

console.log("Arena SQL lifecycle guards passed (53 assertions).");
