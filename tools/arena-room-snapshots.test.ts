import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isOlderArenaRoomSnapshot,
  type ArenaRoomSnapshot,
} from "../src/lib/arenaRoomSnapshots.ts";

test("waiting lobby accepts a newer rejoin but rejects the delayed departure", () => {
  const left = snapshot({status: "waiting", players: [{userId: "p", resultStatus: "left", leftAt: "2026-10-29T10:00:00Z"}]});
  const rejoined = snapshot({status: "waiting", players: [{userId: "p", resultStatus: "active", leftAt: null, presenceUpdatedAt: "2026-10-29T10:00:01Z"}]});
  assert.equal(isOlderArenaRoomSnapshot(rejoined, left), false);
  assert.equal(isOlderArenaRoomSnapshot(left, rejoined), true);
  assert.equal(isOlderArenaRoomSnapshot({...rejoined, roundNumber: 1}, left), true);
});

function snapshot(changes: Partial<ArenaRoomSnapshot> = {}): ArenaRoomSnapshot {
  return {
    id: "room-1",
    roundNumber: 2,
    status: "active",
    mode: "duel",
    competitiveQuestionIndex: 3,
    competitiveRoundPhase: "answering",
    partyQuestionIndex: 3,
    partyQuestionPhase: "answering",
    players: [
      {
        userId: "player-1",
        currentScore: 2,
        currentCorrectAnswers: 2,
        currentQuestionIndex: 3,
        roundPoints: 2,
        roundsWon: 2,
        roundsPlayed: 3,
        resultStatus: "active",
        finishedAt: null,
        leftAt: null,
      },
    ],
    ...changes,
  };
}

test("a delayed same-question event cannot roll back scores or progress", () => {
  const current = snapshot();
  const delayed = snapshot({
    players: [{ ...current.players[0], currentScore: 1, roundsWon: 1 }],
  });
  assert.equal(isOlderArenaRoomSnapshot(delayed, current), true);
});

test("terminal player state cannot be undone by a delayed room snapshot", () => {
  const current = snapshot({
    players: [{ ...snapshot().players[0], resultStatus: "forfeit", finishedAt: "now", leftAt: "now" }],
  });
  assert.equal(isOlderArenaRoomSnapshot(snapshot(), current), true);
});

test("completed results cannot be rewritten as a later forfeit snapshot", () => {
  const player = snapshot().players[0];
  const current = snapshot({
    players: [{ ...player, resultStatus: "completed", finishedAt: "now" }],
  });
  const delayed = snapshot({
    players: [{ ...player, resultStatus: "forfeit", finishedAt: "later" }],
  });
  assert.equal(isOlderArenaRoomSnapshot(delayed, current), true);
});

test("reconnect status and monotonic progress updates remain accepted", () => {
  const current = snapshot({
    players: [{ ...snapshot().players[0], currentScore: 1, resultStatus: "active" }],
  });
  const newer = snapshot({
    players: [{ ...snapshot().players[0], currentScore: 2, resultStatus: "active" }],
  });
  assert.equal(isOlderArenaRoomSnapshot(newer, current), false);
});

test("a current refresh may omit a departed member without being rejected", () => {
  const current = snapshot({ players: [snapshot().players[0], { ...snapshot().players[0], userId: "player-2" }] });
  assert.equal(isOlderArenaRoomSnapshot(snapshot(), current), false);
});
