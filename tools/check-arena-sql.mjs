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

assert.match(migration, /^begin;/i, "migration must begin transactionally");
assert.match(migration, /commit;\s*$/i, "migration must commit transactionally");
assert.match(
  migration,
  /competitive_round_phase <> 'preparing_audio'/,
  "global skips must close when preparation ends"
);
assert.doesNotMatch(
  migration,
  /competitive_round_phase not in\s*\(\s*'preparing_audio',\s*'countdown',\s*'answering'/,
  "countdown and answering must never be skippable by readiness"
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

console.log("Arena SQL lifecycle guards passed (14 assertions).");
