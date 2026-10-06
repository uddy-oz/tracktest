import assert from "node:assert/strict";
import { buildArenaProgress, type QuizResult } from "../src/lib/stats.ts";

function result(overrides: Partial<QuizResult>): QuizResult {
  return {
    id: crypto.randomUUID(),
    albumName: "Test Album",
    artistName: "Test Artist",
    totalQuestions: 7,
    correctAnswers: 0,
    accuracyPercentage: 0,
    finalPoints: 0,
    averageAnswerTime: 0,
    datePlayed: new Date().toISOString(),
    gameMode: "duel",
    isWinner: false,
    scoringModel: "round_points",
    roundsWon: 0,
    roundsPlayed: 7,
    competitiveProgressionEligible: true,
    multiplayerOutcome: "loss",
    ...overrides,
  };
}

const skippedRoundCleanSheet = buildArenaProgress([
  result({
    isWinner: true,
    multiplayerOutcome: "win",
    roundsWon: 5,
    roundsPlayed: 7,
    opponentRoundWins: 0,
    cleanSheet: true,
  }),
]);

assert.equal(skippedRoundCleanSheet.roundWins, 5);
assert.equal(
  skippedRoundCleanSheet.roundLosses,
  0,
  "unclaimed/audio-skipped rounds never become round losses"
);
assert.equal(skippedRoundCleanSheet.cleanSheets, 1);

const guestOrLegacyResult = buildArenaProgress([
  result({
    competitiveProgressionEligible: false,
    isWinner: true,
    multiplayerOutcome: "win",
    roundsWon: 7,
  }),
]);
assert.equal(
  guestOrLegacyResult.gamesPlayed,
  0,
  "ineligible guest and legacy point-model rows never enter permanent progress"
);

const streakStats = buildArenaProgress([
  result({
    datePlayed: "2026-10-06T12:00:00Z",
    isWinner: true,
    multiplayerOutcome: "win",
  }),
  result({
    datePlayed: "2026-10-05T12:00:00Z",
    isWinner: true,
    multiplayerOutcome: "win",
  }),
  result({
    datePlayed: "2026-10-04T12:00:00Z",
    multiplayerOutcome: "draw",
  }),
  result({
    datePlayed: "2026-10-03T12:00:00Z",
    isWinner: true,
    multiplayerOutcome: "win",
  }),
  result({
    datePlayed: "2026-10-02T12:00:00Z",
    isWinner: true,
    multiplayerOutcome: "win",
  }),
  result({
    datePlayed: "2026-10-01T12:00:00Z",
    isWinner: true,
    multiplayerOutcome: "win",
  }),
]);
assert.equal(streakStats.currentWinStreak, 2);
assert.equal(streakStats.bestWinStreak, 3);
assert.equal(streakStats.draws, 1);

const responseStats = buildArenaProgress([
  result({
    isWinner: true,
    multiplayerOutcome: "win",
    roundsWon: 2,
    averageWinningResponseTime: 1.5,
    fastestWinningResponseTime: 0.8,
    cleanSheet: true,
    comebackWin: true,
    dominantWin: true,
    opponentsDefeated: 1,
    scoreMargin: 1,
  }),
]);
assert.equal(responseStats.averageWinningResponseTime, 1.5);
assert.equal(responseStats.fastestWinningResponseTime, 0.8);
assert.equal(responseStats.quickDraws, 1);
assert.equal(responseStats.lightningWins, 1);
assert.equal(responseStats.comebackWins, 1);
assert.equal(responseStats.dominantWins, 1);
assert.equal(responseStats.photoFinishWins, 1);

console.log("Multiplayer progression tests passed (16 assertions). ");
