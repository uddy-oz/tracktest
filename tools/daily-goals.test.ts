import assert from "node:assert/strict";
import test from "node:test";
import { getDailyGoalPeriod, getDailyGoals, type DailyGoalResult } from "../src/lib/dailyGoals.ts";

const now = new Date("2026-11-16T12:00:00Z");
const solo: DailyGoalResult = {
  id: "solo", played_at: "2026-11-16T00:00:00Z",
  game_mode: "single_player", result_status: "completed",
  total_questions: 5, correct_answers: 5, arena_room_id: null,
  arena_round_number: null, competitive_progression_eligible: null,
};
const match: DailyGoalResult = {
  ...solo, id: "arena", game_mode: "duel", arena_room_id: "room",
  arena_round_number: 1, competitive_progression_eligible: true,
};

test("goals credit completed results only during the current UTC period", () => {
  assert.deepEqual(getDailyGoalPeriod(now), {
    start: "2026-11-16T00:00:00.000Z", end: "2026-11-17T00:00:00.000Z",
  });
  const rows = [
    solo, match,
    { ...solo, id: "yesterday", played_at: "2026-11-15T23:59:59Z" },
    { ...solo, id: "later", played_at: "2026-11-16T12:01:00Z" },
    { ...solo, id: "tomorrow", played_at: "2026-11-17T00:00:00Z" },
  ];
  assert.deepEqual(getDailyGoals(rows, now).map(g => g.progress), [1, 10, 1]);
  assert.deepEqual(getDailyGoals([solo, match], new Date("2026-11-17T00:00:00Z")).map(g => g.progress), [0, 0, 0]);
});

test("repeat delivery and same-match duplicates do not count; completed rematches do", () => {
  assert.deepEqual(getDailyGoals([match, match, { ...match, id: "duplicate" }], now).map(g => g.progress), [0, 5, 1]);
  assert.deepEqual(getDailyGoals([match, { ...match, id: "rematch", arena_round_number: 2 }], now).map(g => g.progress), [0, 10, 1]);
});

test("all released Arena modes qualify, but unsupported, invalid and forfeited results do not", () => {
  for (const mode of ["duel", "group_lobby", "party_mode"]) {
    assert.deepEqual(getDailyGoals([{ ...match, game_mode: mode, correct_answers: 0 }], now).map(g => g.progress), [0, 0, 1]);
  }
  for (const row of [
    { ...match, game_mode: "championship" },
    { ...match, competitive_progression_eligible: false },
    { ...match, arena_round_number: null },
    { ...match, result_status: "win_by_forfeit" },
    { ...match, result_status: "forfeit" },
    { ...match, result_status: "cancelled" },
    { ...solo, correct_answers: 6 },
    { ...solo, total_questions: 0 },
    { ...solo, played_at: "invalid" },
    { ...solo, id: "" },
  ]) assert.ok(getDailyGoals([row], now).every(g => !g.complete && g.progress === 0));
});
