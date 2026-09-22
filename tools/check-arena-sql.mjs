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

console.log("Arena SQL lifecycle guards passed (8 assertions).");
