import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canPreparePartyHostAudio,
  canStartPartyHostPlayback,
  getPartyAudioRoundKey,
  type PartyAudioRoundIdentity,
} from "../src/lib/partyAudioLifecycle.ts";

const migration = readFileSync(
  new URL(
    "../supabase/20261014_party_host_audio_readiness_gate.sql",
    import.meta.url
  ),
  "utf8"
);

function identity(
  matchGeneration: number,
  questionIndex: number
): PartyAudioRoundIdentity {
  return { roomId: "party-room", matchGeneration, questionIndex };
}

test("Party audio preparation is bound to room generation and question", () => {
  const expected = identity(3, 4);
  const snapshot = {
    ...expected,
    mode: "party_mode" as const,
    status: "active",
    phase: "preparing_audio",
    clipStartsAt: null,
  };

  assert.equal(canPreparePartyHostAudio(snapshot, expected), true);
  assert.equal(
    canPreparePartyHostAudio(snapshot, identity(2, 4)),
    false,
    "a delayed rematch preparation must not enter the current generation"
  );
  assert.equal(
    canPreparePartyHostAudio(snapshot, identity(3, 5)),
    false,
    "a delayed previous-question callback must not start the next question"
  );
});

test("playback starts only after the prepared countdown has a server timestamp", () => {
  const expected = identity(1, 0);

  assert.equal(
    canStartPartyHostPlayback(
      {
        ...expected,
        mode: "party_mode",
        status: "active",
        phase: "preparing_audio",
        clipStartsAt: null,
      },
      expected
    ),
    false
  );
  assert.equal(
    canStartPartyHostPlayback(
      {
        ...expected,
        mode: "party_mode",
        status: "active",
        phase: "countdown",
        clipStartsAt: "2026-10-14T12:00:03.000Z",
      },
      expected
    ),
    true
  );
});

test("twelve rounds and a rematch keep immutable Party audio keys", () => {
  const firstMatch = Array.from({ length: 12 }, (_, questionIndex) =>
    getPartyAudioRoundKey(identity(1, questionIndex))
  );
  const rematch = Array.from({ length: 12 }, (_, questionIndex) =>
    getPartyAudioRoundKey(identity(2, questionIndex))
  );

  assert.equal(new Set(firstMatch).size, 12);
  assert.equal(new Set(rematch).size, 12);
  assert.equal(
    firstMatch.some((key) => rematch.includes(key)),
    false,
    "old rematch callbacks must not share an audio identity with the new game"
  );
});

test("Party readiness migration is transactional, bounded, and host-only", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.match(migration, /party_question_phase = 'preparing_audio'/);
  assert.match(
    migration,
    /create or replace function public\.start_prepared_party_question/
  );
  assert.match(
    migration,
    /target_room\.host_user_id <> auth\.uid\(\)/,
    "only the Party host may open the prepared countdown"
  );
  assert.match(
    migration,
    /party_audio_ready_deadline_at = preparation_deadline/,
    "host preparation must have a server deadline"
  );
  assert.match(
    migration,
    /return public\._skip_party_question_internal/,
    "a missing host must resolve to a shared server skip"
  );
  assert.match(
    migration,
    /target_round_number[\s\S]*target_question_index/,
    "skip and start RPCs must reject stale match generations and questions"
  );
  assert.match(
    migration,
    /party_question_phase not in \('countdown', 'awaiting_audio', 'answering'\)/,
    "late playback acknowledgements must not write into reveal or finished phases"
  );
  assert.doesNotMatch(migration, /email/i);
});
