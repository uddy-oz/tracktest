import assert from "node:assert/strict";
import {
  canReportCompetitiveAudioFailure,
  getCompetitiveRoundKey,
  isOlderCompetitiveSnapshot,
  isSameCompetitiveRound,
  type CompetitiveRoundSnapshot,
} from "../src/lib/arenaRoundLifecycle.ts";

const base: CompetitiveRoundSnapshot = {
  roomId: "room-a",
  matchGeneration: 2,
  roundId: "round-b-1",
  questionIndex: 0,
  mode: "duel",
  status: "active",
  phase: "preparing_audio",
};

const expected = {
  roomId: base.roomId,
  matchGeneration: base.matchGeneration,
  roundId: base.roundId,
  questionIndex: base.questionIndex,
};

assert.equal(canReportCompetitiveAudioFailure(base, expected), true);
assert.equal(
  canReportCompetitiveAudioFailure({ ...base, phase: "countdown" }, expected),
  false,
  "a stale failure cannot skip a countdown"
);
assert.equal(
  canReportCompetitiveAudioFailure({ ...base, phase: "answering" }, expected),
  false,
  "a stale failure cannot skip active playback"
);
assert.equal(
  canReportCompetitiveAudioFailure(base, { ...expected, roundId: "round-a-10" }),
  false,
  "a delayed failure from the previous round is ignored"
);
assert.equal(
  canReportCompetitiveAudioFailure(base, {
    ...expected,
    matchGeneration: 1,
    roundId: "match-a-round-10",
    questionIndex: 9,
  }),
  false,
  "Match A round 10 cannot affect Match B round 1"
);
assert.equal(
  canReportCompetitiveAudioFailure({ ...base, mode: "group_lobby" }, expected),
  true,
  "Group Lobby uses the same readiness rules"
);
assert.equal(
  canReportCompetitiveAudioFailure(base, expected),
  true,
  "a client may retry preparation three times for the same immutable round"
);
assert.equal(
  isOlderCompetitiveSnapshot(base, base),
  false,
  "reconnecting during preparation can reconcile the current snapshot"
);
assert.equal(
  isOlderCompetitiveSnapshot(
    { ...base, phase: "answering" },
    { ...base, phase: "answering" }
  ),
  false,
  "reconnecting during playback can reconcile the current snapshot"
);
assert.equal(
  canReportCompetitiveAudioFailure(
    { ...base, status: "finished", phase: "finished" },
    expected
  ),
  false,
  "a finished client cannot mutate the round"
);
assert.equal(
  canReportCompetitiveAudioFailure({ ...base, mode: "party_mode" }, expected),
  false,
  "Party Mode stays on its host-only audio path"
);
assert.equal(isSameCompetitiveRound(base, expected), true);
assert.equal(
  getCompetitiveRoundKey(expected),
  "room-a:2:round-b-1:0"
);
assert.equal(
  isOlderCompetitiveSnapshot(
    { ...base, matchGeneration: 1, roundId: "old", questionIndex: 9 },
    base
  ),
  true,
  "old rematch snapshots are rejected"
);
assert.equal(
  isOlderCompetitiveSnapshot(
    { ...base, questionIndex: 1, roundId: "round-b-2" },
    base
  ),
  false,
  "the next round may advance"
);
assert.equal(
  isOlderCompetitiveSnapshot(
    { ...base, phase: "preparing_audio" },
    { ...base, phase: "answering" }
  ),
  true,
  "out-of-order phase snapshots cannot move the client backwards"
);
assert.equal(
  isOlderCompetitiveSnapshot(
    { ...base, phase: "answering" },
    { ...base, phase: "answering" }
  ),
  false,
  "duplicate Realtime events are idempotent"
);

console.log("Arena round lifecycle race tests passed (17 assertions). ");
